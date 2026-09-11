import { projectOntoShape } from './geo.ts'
import { getNetwork, type Network } from './network.ts'
import { getVehicles } from './vehicles.ts'
import type { Arrival, ArrivalEstimate, Direction } from './model.ts'

/**
 * Used when a vehicle has no measured speed yet — a Batumi city bus averages
 * roughly this once stops and lights are counted in.
 */
const FALLBACK_KMH = 18
/**
 * A measured speed is clamped rather than trusted outright: a bus sampled
 * across a red light reads as walking pace, and extrapolating that over the
 * next kilometre turns one traffic light into ten minutes of waiting.
 */
const MIN_KMH = 10
const MAX_KMH = 45
const MAX_ESTIMATE_MINUTES = 60

const batumiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tbilisi',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Minutes since midnight in Batumi — the timetable's own frame of reference. */
export function minutesNowInBatumi(now = new Date()): number {
  const [hours, minutes] = batumiTime.format(now).split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

/** The next departure at or after `nowMinutes`, wrapping to tomorrow's first. */
function nextScheduled(times: string[], nowMinutes: number) {
  if (!times.length) return { time: null, minutes: null }

  for (const time of times) {
    const at = toMinutes(time)
    if (at >= nowMinutes) return { time, minutes: at - nowMinutes }
  }

  const first = times[0]!
  return { time: first, minutes: 1440 - nowMinutes + toMinutes(first) }
}

/** A vehicle further off the line than this is running something else, or parked. */
const MAX_VEHICLE_OFFSET_M = 250
/** How far outside its direction's stretch a vehicle may still be matched. */
const BAND_SLACK_M = 400
/**
 * Above this, the shape and the stop chain disagree too much to measure along.
 * The real network sits at 5 m typical and 12 m at worst, so this is a wide
 * margin around "the line genuinely describes where the buses drive".
 */
const MAX_FIT_M = 120
/** Standing this long is a traffic light; the estimate absorbs it silently. */
const STALL_IGNORE_S = 45
/** Standing this long and the number is a guess we should mark as one. */
const STALL_SOFT_S = 150
/** Standing this long and there is no honest number left to give. */
const STALL_GIVE_UP_S = 300
/** A bus at the kerb may match a few metres past the stop; that is still arriving. */
const PASSED_TOLERANCE_M = 40

/**
 * How the published number moves when a fresh calculation disagrees with it.
 * Downward corrections land immediately — being told a bus is closer than you
 * thought is never what makes someone miss it. Upward ones are eased in, so a
 * countdown drifts rather than jumping back up in the reader's face.
 */
const RATCHET_ALPHA = 0.25
const RATCHET_DEADBAND_MS = 20_000

interface Published {
  arrivesAt: number
  at: number
}

const published = new Map<string, Published>()

const prunePublished = (now: number) => {
  for (const [key, entry] of published) {
    if (now - entry.at > 15 * 60_000) published.delete(key)
  }
}

/**
 * A countdown that goes up is the single thing riders complain about most, so
 * the published instant is held steady against small upward revisions and only
 * eased toward genuinely worse news.
 */
export function ratchet(key: string, rawArrivesAt: number, now: number): number {
  const previous = published.get(key)

  if (!previous) {
    published.set(key, { arrivesAt: rawArrivesAt, at: now })
    return rawArrivesAt
  }

  // Sooner lands at once; a little later is held where it was; a lot later is
  // eased in. The deadband used to be the other way round — a small upward
  // revision was adopted raw — so the countdown ticked *up* by as much as
  // nineteen seconds a poll, which is the one thing rule 1 says never happens.
  // Holding is self-correcting: a bus that really is slower drifts past the
  // deadband on the next poll and is eased from there.
  const drift = rawArrivesAt - previous.arrivesAt
  const next =
    drift <= 0
      ? rawArrivesAt
      : drift < RATCHET_DEADBAND_MS
        ? previous.arrivesAt
        : previous.arrivesAt + RATCHET_ALPHA * drift

  published.set(key, { arrivesAt: next, at: now })
  return next
}

function estimateFor(
  network: Network,
  routeId: string,
  stopId: string,
  direction: Direction,
  vehicles: Awaited<ReturnType<typeof getVehicles>>,
  now: number,
): ArrivalEstimate | null {
  const shape = network.shapes.get(routeId)
  // Where the stop sits on the line was matched once, when the network was
  // built — chain order is what disambiguates the two directions, and it is
  // not information a single stop's coordinates carry.
  const stopOnRoute = network.stopsOnRoute
    .get(routeId)
    ?.find((entry) => entry.stopId === stopId && entry.direction === direction)
  if (!shape || !stopOnRoute) return null

  const band = network.bands.get(routeId)?.get(direction)
  // Where the line and the stop chain disagree, distance along the line is not
  // a quantity worth dividing by a speed. Those legs get the timetable only.
  if (band && band.fitMeters > MAX_FIT_M) return null

  const range = band ? { min: band.min - BAND_SLACK_M, max: band.max + BAND_SLACK_M } : undefined

  let best: { estimate: ArrivalEstimate; distance: number } | null = null

  for (const vehicle of vehicles) {
    if (vehicle.routeId !== routeId || vehicle.direction !== direction) continue
    // A bus parked overnight in the depot is not an arrival, however close it is.
    if (!vehicle.inService || vehicle.standingSeconds > STALL_GIVE_UP_S) continue

    const vehicleAt = projectOntoShape(shape, vehicle, { range })
    if (!vehicleAt || vehicleAt.offset > MAX_VEHICLE_OFFSET_M) continue

    // Deliberately NOT the wrapping distance. Batumi's routes are there-and-back,
    // not loops, and letting the measurement run off the end of the shape and
    // back round turns "this bus left your stop a minute ago" into "arriving in
    // 40 minutes" — technically the same vehicle on its next run, and not what
    // anyone standing at the pole is asking. Past the stop is no arrival.
    const distance = stopOnRoute.along - vehicleAt.along
    if (distance < -PASSED_TOLERANCE_M) continue
    const speed = Math.min(MAX_KMH, Math.max(MIN_KMH, vehicle.speedKmh ?? FALLBACK_KMH))

    // Stops between here and there are where the time actually goes: a bus
    // covering 2 km through eight stops is not doing 20 km/h for 6 minutes.
    const stopsBetween = countStopsBetween(network, routeId, direction, vehicleAt.along, stopOnRoute.along)

    // The speed floor would otherwise insist a stationary bus is still covering
    // 167 m every minute, so time already spent standing is added back rather
    // than modelled away.
    const stall = Math.max(0, vehicle.standingSeconds - STALL_IGNORE_S)
    const runMetres = Math.max(0, distance)
    const seconds = (runMetres / 1000 / speed) * 3600 + stopsBetween * DWELL_SECONDS + stall
    if (seconds / 60 > MAX_ESTIMATE_MINUTES) continue

    if (best && distance >= best.distance) continue

    const arrivesAt = ratchet(`${stopId}|${routeId}|${direction}|${vehicle.id}`, now + seconds * 1000, now)

    best = {
      distance,
      estimate: {
        minutes: Math.max(0, Math.round((arrivesAt - now) / 60_000)),
        arrivesAt: new Date(arrivesAt).toISOString(),
        // Soft for two different reasons, both honest: a bus we can see but
        // that is barely moving, and a bus we have not yet watched long enough
        // to time at all. The second is why a freshly started process marks
        // everything soft and settles as it observes movement — measured, 20%
        // of estimates carry the mark once the tracker is warm, against all of
        // them in the first seconds.
        confidence:
          vehicle.standingSeconds > STALL_SOFT_S || vehicle.speedKmh === null || vehicle.speedKmh < MIN_KMH
            ? 'slow'
            : 'live',
        vehicleId: vehicle.id,
        distanceMeters: Math.round(runMetres),
        stopsAway: stopsBetween,
      },
    }
  }

  return best?.estimate ?? null
}

/** How long a bus loses at a stop it has to serve on the way. */
const DWELL_SECONDS = 15

function countStopsBetween(
  network: Network,
  routeId: string,
  direction: Direction,
  from: number,
  to: number,
): number {
  const chain = network.stopsOnRoute.get(routeId)
  if (!chain) return 0

  // Only the ones genuinely ahead of the bus and behind the target; the wrap
  // case is already excluded by the distance cap above.
  return chain.filter((stop) => stop.direction === direction && stop.along > from && stop.along < to).length
}

/**
 * What is coming to one stop. The scheduled column is upstream's; the estimate
 * column is ours — there are no published predictions for Batumi at all, so a
 * caller must present it as a derivation, not as a promise.
 */
export async function getArrivals(stopId: string): Promise<Arrival[] | null> {
  const network = await getNetwork()
  const stop = network.stops.get(stopId)
  if (!stop) return null

  const now = Date.now()
  prunePublished(now)
  const nowMinutes = minutesNowInBatumi(new Date(now))
  const routeIds = [...new Set(stop.schedules.map((schedule) => schedule.routeId))]
  const vehicles = await getVehicles(routeIds)

  return stop.schedules
    .map((schedule): Arrival => {
      const scheduled = nextScheduled(schedule.times, nowMinutes)
      return {
        routeId: schedule.routeId,
        shortName: schedule.shortName,
        hue: schedule.hue,
        direction: schedule.direction,
        headsign: schedule.headsign,
        scheduledTime: scheduled.time,
        scheduledMinutes: scheduled.minutes,
        // Derived from the same `now` rather than parsed back out of "HH:MM",
        // so it needs no timezone arithmetic and no assumption that Georgia
        // will never adopt DST.
        scheduledAt: scheduled.minutes === null ? null : new Date(now + scheduled.minutes * 60_000).toISOString(),
        estimate: estimateFor(network, schedule.routeId, stopId, schedule.direction, vehicles, now),
      }
    })
    .sort((a, b) => {
      // Whatever is actually coming first goes first; a live estimate outranks
      // a timetable entry, and a route with neither sinks to the bottom.
      const aKey = a.estimate?.minutes ?? a.scheduledMinutes ?? Infinity
      const bKey = b.estimate?.minutes ?? b.scheduledMinutes ?? Infinity
      return aKey - bKey
    })
}
