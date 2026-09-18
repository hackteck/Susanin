import type { Direction } from '../api/types.ts'
import { metresBetween, type LatLon } from './geo.ts'
import { tripTime, type PlannerNetwork } from './network.ts'
import { BOARDING_SLACK, rodeTo, search, trace, type Access, type RawLeg } from './raptor.ts'
import { walkingMetres, walkingMinutes } from './walking.ts'

/** The same "nearby" the rest of the app means — see useNearestStops. */
export const ACCESS_MAX_METRES = 1200
/**
 * Somewhere with no stop that close at all still gets its nearest few, from
 * this far. Only then: offered beside a stop that *is* close, a stop 2.6 km
 * away turned a trip to Sarpi into a bus ride and a 44-minute walk.
 */
const ACCESS_FALLBACK_METRES = 3000
const ACCESS_FALLBACK_COUNT = 3
/** Up to three buses. Batumi is small enough that a fourth is never the answer. */
export const MAX_RIDES = 3
/** Past an hour on foot it is not a way to get there, it is a hike. */
const WALK_ONLY_MAX_MINUTES = 60
/** Closer than this there is nothing to plan: the answer is to walk. */
const JUST_WALK_METRES = 250

/**
 * How a rider weighs an option, in minutes. A change of bus costs five on top
 * of its own waiting — the chance of missing the connection, and the effort —
 * and a minute on foot counts as a minute and a half, since it is the part of
 * the trip that is uphill, in the rain, and with shopping. Both are the usual
 * transit-planner defaults rather than anything measured here; what they decide
 * is the order of options that are all genuinely possible, never whether one is.
 */
const TRANSFER_PENALTY = 5
const WALK_RELUCTANCE = 0.5

const MAX_OPTIONS = 5
/** An option this much worse than the best is noise, however different it is. */
const WORSE_FACTOR = 1.5
const WORSE_ALLOWANCE = 10

/** How many further searches look for options leaving later than the first ones. */
const LATER_RUNS = 3
/** How far back an arrive-by search looks for a departure. */
const ARRIVE_BY_WINDOW = 240

export interface PlanQuery {
  from: LatLon
  to: LatLon
  /** Minutes after Batumi midnight today; past 1440 is tomorrow. */
  at: number
  /** Leave no earlier than `at`, or be there no later than it. */
  mode: 'depart' | 'arrive'
}

export interface WalkLeg {
  kind: 'walk'
  /** Null is the journey's own start or end, which is not a stop. */
  fromStopId: string | null
  toStopId: string | null
  /** Street metres, estimated from the straight line — see walking.ts. */
  metres: number
  minutes: number
  depart: number
  arrive: number
}

export interface RideLeg {
  kind: 'ride'
  routeId: string
  direction: Direction
  fromStopId: string
  toStopId: string
  /** Every stop from boarding to alighting, both included. */
  stopIds: string[]
  /** Positions along the direction, for cutting its line on the map. */
  board: number
  alight: number
  depart: number
  arrive: number
  /** Either end's time is our repair of an impossible published one. */
  estimated: boolean
  /** The next few departures of the same line from the same stop. */
  later: number[]
}

export type JourneyLeg = WalkLeg | RideLeg

export interface Journey {
  kind: 'transit' | 'walk'
  legs: JourneyLeg[]
  /** When to set off from the start — not when the first bus comes. */
  depart: number
  arrive: number
  rides: number
  walkMetres: number
  walkMinutes: number
  estimated: boolean
  /** The lines ridden, in order. Two options on the same lines are one option. */
  key: string
}

/**
 * A direct ride on a line that publishes no timetable. How long the ride takes
 * can be estimated from distance; when a bus comes cannot, so these are offered
 * apart from the timed journeys and never ranked against them.
 */
export interface UntimedOption {
  routeId: string
  direction: Direction
  walkIn: WalkLeg
  ride: Omit<RideLeg, 'depart' | 'arrive' | 'later'> & { minutes: number }
  walkOut: WalkLeg
  /** Walking plus riding; the wait is unknown and not in it. */
  minutes: number
}

export interface PlanResult {
  journeys: Journey[]
  untimed: UntimedOption[]
  /** Which end has no stop within reach, so the reader is told which. */
  noStopsNear: 'from' | 'to' | null
}

export function nearbyStops(network: PlannerNetwork, point: LatLon): Access[] {
  const all = network.stops
    .map((stop, index) => ({ index, straight: metresBetween(point, stop) }))
    .sort((a, b) => a.straight - b.straight)

  const close = all.filter((entry) => entry.straight <= ACCESS_MAX_METRES)
  const chosen = close.length
    ? close
    : all.slice(0, ACCESS_FALLBACK_COUNT).filter((entry) => entry.straight <= ACCESS_FALLBACK_METRES)

  return chosen.map(({ index, straight }) => ({
    stop: index,
    minutes: walkingMinutes(straight),
    metres: walkingMetres(straight),
  }))
}

export function planJourneys(network: PlannerNetwork, query: PlanQuery): PlanResult {
  const access = nearbyStops(network, query.from)
  const egress = nearbyStops(network, query.to)
  const straight = metresBetween(query.from, query.to)

  const walk = walkOnly(query, straight)
  if (straight <= JUST_WALK_METRES) return { journeys: [walk], untimed: [], noStopsNear: null }

  if (!access.length || !egress.length) {
    return {
      journeys: walk.walkMinutes <= WALK_ONLY_MAX_MINUTES ? [walk] : [],
      untimed: [],
      noStopsNear: access.length ? 'to' : 'from',
    }
  }

  const candidates = query.mode === 'arrive' ? arriveBy(network, query, access, egress) : departAt(network, query, access, egress)
  if (walk.walkMinutes <= WALK_ONLY_MAX_MINUTES && (query.mode === 'depart' || walk.arrive <= query.at)) {
    candidates.push(walk)
  }

  const journeys = rank(candidates, query)
  const bestTimed = journeys.find((journey) => journey.kind === 'transit')
  const untimed = untimedOptions(network, access, egress).filter(
    (option) => !bestTimed || option.minutes < bestTimed.arrive - bestTimed.depart,
  )

  return { journeys, untimed, noStopsNear: null }
}

function walkOnly(query: PlanQuery, straight: number): Journey {
  const minutes = walkingMinutes(straight)
  const depart = query.mode === 'arrive' ? query.at - minutes : query.at
  const leg: WalkLeg = {
    kind: 'walk',
    fromStopId: null,
    toStopId: null,
    metres: walkingMetres(straight),
    minutes,
    depart,
    arrive: depart + minutes,
  }
  return {
    kind: 'walk',
    legs: [leg],
    depart,
    arrive: leg.arrive,
    rides: 0,
    walkMetres: leg.metres,
    walkMinutes: minutes,
    estimated: false,
    key: 'walk',
  }
}

/** Every journey one search found, one per stop it could get off at. */
function harvest(network: PlannerNetwork, access: Access[], egress: Access[], at: number): Journey[] {
  const labels = search(network, access, at, MAX_RIDES)
  const found: Journey[] = []

  for (let round = 1; round <= MAX_RIDES; round++) {
    for (const exit of egress) {
      // Only arrivals by bus: a stop reached by walking from another one and
      // then walked away from again is two walks where one would do.
      if (!rodeTo(labels, round, exit.stop)) continue
      const raw = trace(network, labels, round, exit.stop)
      if (raw) found.push(assemble(network, raw, exit))
    }
  }

  return found
}

function departAt(network: PlannerNetwork, query: PlanQuery, access: Access[], egress: Access[]): Journey[] {
  const found: Journey[] = []
  let at = query.at

  // The first search finds the soonest ways to arrive; each further one starts
  // just after the soonest of those leaves, which is what turns "the next bus"
  // into a few real choices without searching every minute of the day.
  for (let run = 0; run <= LATER_RUNS; run++) {
    const batch = harvest(network, access, egress, at)
    if (!batch.length) break
    found.push(...batch)
    at = Math.min(...batch.map((journey) => journey.depart)) + 1
    if (at > query.at + 1440) break
  }

  return found
}

/**
 * The latest departure that still arrives in time, found by bisection. Earliest
 * arrival never gets earlier as the departure gets later, so it is monotone and
 * a binary search over the window is exact to the minute.
 */
function arriveBy(network: PlannerNetwork, query: PlanQuery, access: Access[], egress: Access[]): Journey[] {
  const deadline = query.at
  const found: Journey[] = []

  const probe = (at: number) => {
    const batch = harvest(network, access, egress, at).filter((journey) => journey.arrive <= deadline)
    found.push(...batch)
    return batch.length > 0
  }

  let low = deadline - ARRIVE_BY_WINDOW
  let high = deadline
  if (!probe(low)) return found

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (probe(middle)) low = middle
    else high = middle
  }

  // A couple of earlier starts, so the latest option is not the only one.
  probe(low - 10)
  probe(low - 20)
  return found
}

function assemble(network: PlannerNetwork, raw: RawLeg[], exit: Access): Journey {
  const legs: JourneyLeg[] = []
  const stopId = (index: number) => network.stops[index]!.id

  const firstRide = raw.find((leg) => leg.kind === 'ride')
  const access = raw[0]
  let clock = 0

  if (firstRide?.kind === 'ride' && access?.kind === 'access') {
    const pattern = network.patterns[firstRide.pattern]!
    // Leave as late as still makes the bus, not at the moment the search began.
    clock = tripTime(pattern, firstRide.trip, firstRide.board) - BOARDING_SLACK - access.minutes
  }

  for (const leg of raw) {
    if (leg.kind === 'access') {
      legs.push({
        kind: 'walk',
        fromStopId: null,
        toStopId: stopId(leg.stop),
        metres: leg.metres,
        minutes: leg.minutes,
        depart: clock,
        arrive: clock + leg.minutes,
      })
      clock += leg.minutes
    } else if (leg.kind === 'transfer') {
      legs.push({
        kind: 'walk',
        fromStopId: stopId(leg.from),
        toStopId: stopId(leg.to),
        metres: leg.metres,
        minutes: leg.minutes,
        depart: clock,
        arrive: clock + leg.minutes,
      })
      clock += leg.minutes
    } else {
      const pattern = network.patterns[leg.pattern]!
      const depart = tripTime(pattern, leg.trip, leg.board)
      const arrive = tripTime(pattern, leg.trip, leg.alight)
      const later: number[] = []
      for (let next = leg.trip + 1; next < pattern.departures.length && later.length < 3; next++) {
        later.push(tripTime(pattern, next, leg.board))
      }
      legs.push({
        kind: 'ride',
        routeId: pattern.routeId,
        direction: pattern.direction,
        fromStopId: stopId(pattern.stops[leg.board]!),
        toStopId: stopId(pattern.stops[leg.alight]!),
        stopIds: pattern.stops.slice(leg.board, leg.alight + 1).map(stopId),
        board: leg.board,
        alight: leg.alight,
        depart,
        arrive,
        estimated: !!(pattern.estimated[leg.board] || pattern.estimated[leg.alight]),
        later,
      })
      clock = arrive
    }
  }

  legs.push({
    kind: 'walk',
    fromStopId: stopId(exit.stop),
    toStopId: null,
    metres: exit.metres,
    minutes: exit.minutes,
    depart: clock,
    arrive: clock + exit.minutes,
  })

  const rides = legs.filter((leg): leg is RideLeg => leg.kind === 'ride')
  const walks = legs.filter((leg): leg is WalkLeg => leg.kind === 'walk')

  return {
    kind: 'transit',
    // A zero-length walk is a stop that was the start or the end itself.
    legs: legs.filter((leg) => leg.kind === 'ride' || leg.metres > 1),
    depart: legs[0]!.depart,
    arrive: legs.at(-1)!.arrive,
    rides: rides.length,
    walkMetres: walks.reduce((sum, leg) => sum + leg.metres, 0),
    walkMinutes: walks.reduce((sum, leg) => sum + leg.minutes, 0),
    estimated: rides.some((leg) => leg.estimated),
    key: rides.map((leg) => `${leg.routeId}:${leg.direction}`).join('>'),
  }
}

const cost = (journey: Journey, query: PlanQuery) => {
  // Depart-at weighs how soon it gets you there; arrive-by, how late it lets
  // you leave. Either way the time in between is the time the trip takes.
  const elapsed = query.mode === 'arrive' ? query.at - journey.depart : journey.arrive - query.at
  return elapsed + TRANSFER_PENALTY * Math.max(0, journey.rides - 1) + WALK_RELUCTANCE * journey.walkMinutes
}

const dominates = (a: Journey, b: Journey) =>
  a.depart >= b.depart &&
  a.arrive <= b.arrive &&
  a.rides <= b.rides &&
  a.walkMinutes <= b.walkMinutes &&
  (a.depart > b.depart || a.arrive < b.arrive || a.rides < b.rides || a.walkMinutes < b.walkMinutes)

/**
 * From every journey found to the few worth showing: nothing another option
 * beats on every count, one per set of lines, best first — and nothing so much
 * worse than the best that listing it would only be noise.
 */
function rank(candidates: Journey[], query: PlanQuery): Journey[] {
  const useful = candidates.filter((journey) => !candidates.some((other) => dominates(other, journey)))
  const sorted = useful.sort((a, b) => cost(a, query) - cost(b, query) || a.arrive - b.arrive)

  const seen = new Set<string>()
  const chosen: Journey[] = []
  const ceiling = sorted.length ? cost(sorted[0]!, query) * WORSE_FACTOR + WORSE_ALLOWANCE : 0
  // The best way by bus survives the ceiling whatever it costs. At 23:30 a
  // forty-minute walk beats waiting for the 07:00, and says so by coming first
  // — but someone who asked how to get there by bus is owed the 07:00 too.
  const bestTransit = sorted.find((journey) => journey.kind === 'transit')

  for (const journey of sorted) {
    if (seen.has(journey.key)) continue
    if (journey !== bestTransit && cost(journey, query) > ceiling) continue
    seen.add(journey.key)
    chosen.push(journey)
    if (chosen.length === MAX_OPTIONS) break
  }

  return chosen
}

/** The best direct ride on each untimed line that serves both ends. */
function untimedOptions(network: PlannerNetwork, access: Access[], egress: Access[]): UntimedOption[] {
  const walkIn = new Map(access.map((entry) => [entry.stop, entry]))
  const walkOut = new Map(egress.map((entry) => [entry.stop, entry]))
  const options: UntimedOption[] = []

  network.patterns.forEach((pattern) => {
    if (pattern.timed) return
    let best: UntimedOption | null = null

    pattern.stops.forEach((boardStop, board) => {
      const into = walkIn.get(boardStop)
      if (!into) return
      for (let alight = board + 1; alight < pattern.stops.length; alight++) {
        const out = walkOut.get(pattern.stops[alight]!)
        if (!out) continue
        const riding = pattern.offsets[alight]! - pattern.offsets[board]!
        const minutes = into.minutes + riding + out.minutes
        if (best && best.minutes <= minutes) continue

        const stopIds = pattern.stops.slice(board, alight + 1).map((index) => network.stops[index]!.id)
        best = {
          routeId: pattern.routeId,
          direction: pattern.direction,
          walkIn: { kind: 'walk', fromStopId: null, toStopId: stopIds[0]!, metres: into.metres, minutes: into.minutes, depart: 0, arrive: into.minutes },
          ride: {
            kind: 'ride',
            routeId: pattern.routeId,
            direction: pattern.direction,
            fromStopId: stopIds[0]!,
            toStopId: stopIds.at(-1)!,
            stopIds,
            board,
            alight,
            estimated: true,
            minutes: riding,
          },
          walkOut: { kind: 'walk', fromStopId: stopIds.at(-1)!, toStopId: null, metres: out.metres, minutes: out.minutes, depart: 0, arrive: out.minutes },
          minutes,
        }
      }
    })

    if (best) options.push(best)
  })

  return options.sort((a, b) => a.minutes - b.minutes).slice(0, 2)
}
