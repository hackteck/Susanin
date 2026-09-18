/**
 * The timetable as trips rather than as per-stop lists, and the one correction
 * it needs before anything can be planned on it.
 *
 * Upstream publishes each stop's departures as a bare list of "HH:MM" and says
 * nothing about which time at one stop belongs to which time at the next. It
 * does not have to: measured across the whole network, every stop of a
 * direction carries the same number of times, the k-th time at each stop always
 * increases along the chain, and every trip of a direction keeps exactly the
 * same running times. So the k-th entries *are* the k-th trip, and a direction
 * is one set of offsets plus a list of departures from its first stop.
 */

export const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** Minutes after midnight back to "HH:MM", wrapping past midnight. */
export const formatMinutes = (minutes: number) => {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

export interface TripPattern {
  /** Minutes after the trip leaves the first stop, one per stop. */
  offsets: number[]
  /** When each trip leaves the first stop, minutes after midnight, ascending. */
  departures: number[]
}

/** Longer than any Batumi line takes end to end, with room to spare. */
const MAX_TRIP_MINUTES = 180

/**
 * Rebuild trips from per-stop time lists given in travel order. Null when the
 * lists do not line up into trips — different counts, or a trip that would run
 * backwards — which is a change upstream has not made yet and which a caller
 * has to hear about rather than have papered over.
 */
export function inferTrips(timesPerStop: string[][]): TripPattern[] | null {
  const count = timesPerStop[0]?.length ?? 0
  if (!count || timesPerStop.some((times) => times.length !== count)) return null

  const minutes = timesPerStop.map((times) => times.map(toMinutes).sort((a, b) => a - b))
  const patterns = new Map<string, TripPattern>()

  for (let trip = 0; trip < count; trip++) {
    const start = minutes[0]![trip]!
    const offsets = minutes.map((times) => times[trip]! - start)

    for (let stop = 1; stop < offsets.length; stop++) {
      if (offsets[stop]! < offsets[stop - 1]!) return null
    }
    if (offsets.at(-1)! > MAX_TRIP_MINUTES) return null

    const key = offsets.join(',')
    const pattern = patterns.get(key) ?? { offsets, departures: [] }
    pattern.departures.push(start)
    patterns.set(key, pattern)
  }

  return [...patterns.values()]
}

/**
 * No Batumi bus averages more than this over a whole direction, stops included
 * — the same ceiling `arrivals.ts` clamps a measured speed to. A published
 * pattern faster than this end to end is not a fast bus but a timetable whose
 * intermediate times were never filled in: route 8 inbound runs 38 stops and
 * 13.8 km in three minutes, route 12 outbound 34 stops in eight.
 */
export const MAX_AVERAGE_KMH = 45

/**
 * Nor does it cover the gap between two stops faster than this. Generous on
 * purpose — the suburban lines do run on highway — so that it only catches what
 * no bus could do: route 6 publishes 8.6 km in four minutes, 10A 9 km.
 */
export const MAX_HOP_KMH = 60

/**
 * The published times are whole minutes at both ends of a hop, so a hop can
 * read up to two minutes shorter than it ran without anyone having got anything
 * wrong. Less slack than this and seven directions pick up a one-minute
 * "correction" that is only rounding.
 */
const ROUNDING_SLACK_MINUTES = 2

const metresPerMinute = (kmh: number) => (kmh * 1000) / 60

export interface RunningTimes {
  offsets: number[]
  /** Per stop: true where the time is ours rather than upstream's. */
  estimated: boolean[]
}

/**
 * Running times that could physically happen, changed as little as possible.
 *
 * `along` is each stop's distance along the route shape. Two repairs, for two
 * different faults:
 *
 * - A whole pattern faster than `MAX_AVERAGE_KMH` has no usable intermediate
 *   times at all, so they are re-derived from distance at `typicalKmh` — the
 *   network's own median scheduled speed, measured when the network is built.
 * - Otherwise a hop is only ever made *later*, and only by what it takes to get
 *   under `MAX_HOP_KMH`: the times upstream got right stay exactly as published.
 *
 * The first stop is never touched. Its departures are the ones the rest of the
 * data agrees with — each direction's first bus leaves in time for the other
 * direction's first return.
 */
export function repairRunningTimes(offsets: number[], along: number[], typicalKmh: number): RunningTimes {
  const origin = along[0] ?? 0
  const distance = Math.max(0, (along.at(-1) ?? 0) - origin)
  const total = offsets.at(-1) ?? 0

  if (distance > 0 && (total <= 0 || distance / total > metresPerMinute(MAX_AVERAGE_KMH))) {
    return { offsets: fromDistance(along, typicalKmh), estimated: along.map((_, index) => index > 0) }
  }

  const repaired: number[] = []
  for (let stop = 0; stop < offsets.length; stop++) {
    // Against every earlier stop, not just the previous one: a run of
    // zero-minute hops is each fine on its own and impossible together.
    let earliest = -Infinity
    for (let before = 0; before < stop; before++) {
      const metres = Math.max(0, along[stop]! - along[before]!)
      earliest = Math.max(earliest, repaired[before]! + metres / metresPerMinute(MAX_HOP_KMH))
    }
    repaired.push(Math.max(offsets[stop]!, Math.ceil(earliest - ROUNDING_SLACK_MINUTES)))
  }

  return { offsets: repaired, estimated: repaired.map((value, index) => value !== offsets[index]) }
}

/**
 * Running times for a direction that publishes no timetable at all. There is no
 * departure to anchor them to, so they can never say *when* — only how long the
 * ride takes once you are on, which is still worth knowing.
 */
export function estimateRunningTimes(along: number[], typicalKmh: number): RunningTimes {
  return { offsets: fromDistance(along, typicalKmh), estimated: along.map(() => true) }
}

function fromDistance(along: number[], kmh: number): number[] {
  const origin = along[0] ?? 0
  return along.map((metres) => Math.round(Math.max(0, metres - origin) / metresPerMinute(kmh)))
}

/** Median whole-direction speed of the patterns that pass `MAX_AVERAGE_KMH`. */
export function typicalSpeedKmh(samples: { offsets: number[]; along: number[] }[]): number {
  const speeds = samples
    .map(({ offsets, along }) => {
      const minutes = offsets.at(-1) ?? 0
      const metres = (along.at(-1) ?? 0) - (along[0] ?? 0)
      return minutes > 0 ? metres / 1000 / (minutes / 60) : Infinity
    })
    .filter((kmh) => kmh > 0 && kmh <= MAX_AVERAGE_KMH)
    .sort((a, b) => a - b)

  // A Batumi city bus with stops and lights counted in; only ever used if the
  // network somehow has no plausible pattern to measure at all.
  return speeds.length ? speeds[Math.floor(speeds.length / 2)]! : 18
}
