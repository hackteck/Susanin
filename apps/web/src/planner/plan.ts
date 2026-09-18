import type { Direction } from '../api/types.ts'
import { metresBetween, type LatLon } from './geo.ts'
import { canAlight, canBoard, type Pattern, type PlannerNetwork } from './network.ts'
import { walkingMetres, walkingMinutes } from './walking.ts'

/**
 * Journeys by where the lines go, not by when the timetable says they leave.
 *
 * Batumi's published departures are not what a rider can plan by: seven
 * directions publish none at all though their buses run, ten publish running
 * times no bus could keep, and the buses come often enough that the question at
 * a kerb is which line and which stop, not which minute. So an option here is a
 * sequence of lines, each ridden between two of its stops, timed by distance at
 * the network's measured speed — and when the next bus actually comes is the
 * live feed's to say, beside the option, not a timetable's.
 */

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
 * How a rider weighs an option, in minutes. Every bus costs a wait nobody can
 * know in advance — five minutes, about half the gap between buses on a busy
 * line — and a change costs five more for the chance of missing the connection
 * and the effort; a minute on foot counts as a minute and a half, since it is
 * the part of the trip that is uphill, in the rain, and with shopping. These
 * decide the order of options that are all genuinely possible, never whether
 * one is, and none of them is ever shown as a time.
 */
const WAIT_PER_BUS = 5
const TRANSFER_PENALTY = 5
const WALK_RELUCTANCE = 0.5

const MAX_OPTIONS = 5
/** An option this much worse than the best is noise, however different it is. */
const WORSE_FACTOR = 1.5
const WORSE_ALLOWANCE = 10

export interface PlanQuery {
  from: LatLon
  to: LatLon
}

/** A stop reachable on foot from one end of the journey. */
export interface Access {
  stop: number
  minutes: number
  metres: number
}

export interface WalkLeg {
  kind: 'walk'
  /** Null is the journey's own start or end, which is not a stop. */
  fromStopId: string | null
  toStopId: string | null
  /** Street metres, estimated from the straight line — see walking.ts. */
  metres: number
  minutes: number
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
  /** Road metres ridden, and the minutes they take at the network's speed. */
  metres: number
  minutes: number
  /** Other lines that make this same ride, stop for stop at both ends: take whichever comes first. */
  also?: { routeId: string; direction: Direction }[]
  /** The terminal the bus turns at on the way, for a ride that stays on through it. */
  turnsAtStopId?: string
  /**
   * The direction whose terminal the ride is heading for — the other one, for a
   * bus boarded at the terminal it turns at. `direction` stays the one it is
   * boarded on, because that is how the live feed knows it at that stop.
   */
  heading: Direction
}

export type JourneyLeg = WalkLeg | RideLeg

export interface Journey {
  kind: 'transit' | 'walk'
  legs: JourneyLeg[]
  /** Walking and riding. The wait for each bus is not in it — nobody knows it in advance. */
  minutes: number
  rides: number
  walkMetres: number
  walkMinutes: number
  /** The lines ridden, in order. Two options on the same lines are one option. */
  key: string
}

export interface PlanResult {
  journeys: Journey[]
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

/** A walk as the ranking feels it. */
const walkCost = (minutes: number) => minutes * (1 + WALK_RELUCTANCE)

/** One ride of a candidate: which line, from which position to which. */
interface Ride {
  pattern: number
  board: number
  alight: number
}

/** A candidate before it is spelled out as legs: its rides and the walks between them. */
interface Candidate {
  access: Access
  rides: Ride[]
  /** The walk before each ride after the first — zero minutes when it is the same pole. */
  transfers: { minutes: number; metres: number }[]
  egress: Access
}

export function planJourneys(network: PlannerNetwork, query: PlanQuery): PlanResult {
  const straight = metresBetween(query.from, query.to)
  const walk = walkOnly(straight)
  if (straight <= JUST_WALK_METRES) return { journeys: [walk], noStopsNear: null }

  const access = nearbyStops(network, query.from)
  const egress = nearbyStops(network, query.to)
  if (!access.length || !egress.length) {
    return {
      journeys: walk.walkMinutes <= WALK_ONLY_MAX_MINUTES ? [walk] : [],
      noStopsNear: access.length ? 'to' : 'from',
    }
  }

  const found = [...direct(network, access, egress), ...withOneChange(network, access, egress)]
  // Three buses only when fewer will not do: across a city this size a third
  // is a detour, not an option, and searching every triple of lines for one
  // would be work spent on answers nobody should take.
  if (!found.length) {
    const longest = withTwoChanges(network, access, egress)
    if (longest) found.push(longest)
  }

  // Thousands of pairs of lines get somewhere; a handful are worth spelling
  // out. Cut by cost first, which is cheap, so that only those are assembled.
  const priced = found.map((candidate) => ({ candidate, cost: candidateCost(network, candidate) }))
  const cheapest = Math.min(...priced.map(({ cost }) => cost), walk.walkMinutes <= WALK_ONLY_MAX_MINUTES ? journeyCost(walk) : Infinity)
  const ceiling = cheapest * WORSE_FACTOR + WORSE_ALLOWANCE
  const cheapestTransit = Math.min(...priced.map(({ cost }) => cost))
  const journeys: Journey[] = priced
    .filter(({ cost }) => cost <= ceiling || cost === cheapestTransit)
    .map(({ candidate }) => assemble(network, candidate))
  if (walk.walkMinutes <= WALK_ONLY_MAX_MINUTES) journeys.push(walk)

  return { journeys: rank(mergeAlternatives(journeys)), noStopsNear: null }
}

function walkOnly(straight: number): Journey {
  const leg: WalkLeg = {
    kind: 'walk',
    fromStopId: null,
    toStopId: null,
    metres: walkingMetres(straight),
    minutes: walkingMinutes(straight),
  }
  return { kind: 'walk', legs: [leg], minutes: leg.minutes, rides: 0, walkMetres: leg.metres, walkMinutes: leg.minutes, key: 'walk' }
}

/**
 * For every position of a pattern, the cheapest way to have got on it at or
 * before there — walking in from the start — as the cost of the walk less the
 * minutes the bus has already run by the boarding stop, so the cost of riding
 * on to any later stop is this plus that stop's minutes.
 */
function boardings(pattern: Pattern, walkIn: Map<number, Access>) {
  const best = new Array<number>(pattern.stops.length).fill(Infinity)
  const from = new Array<number>(pattern.stops.length).fill(-1)
  let value = Infinity
  let at = -1
  pattern.stops.forEach((stop, position) => {
    const into = canBoard(pattern, position) ? walkIn.get(stop) : undefined
    if (into) {
      const candidate = walkCost(into.minutes) - pattern.minutes[position]!
      if (candidate < value) {
        value = candidate
        at = position
      }
    }
    best[position] = value
    from[position] = at
  })
  return { best, from }
}

/**
 * The mirror of `boardings`: for every position, the cheapest way to get off at
 * a later stop and walk to the end, less the minutes run by this position.
 */
function alightings(pattern: Pattern, walkOut: Map<number, Access>) {
  const best = new Array<number>(pattern.stops.length).fill(Infinity)
  const to = new Array<number>(pattern.stops.length).fill(-1)
  let value = Infinity
  let at = -1
  for (let position = pattern.stops.length - 1; position >= 0; position--) {
    best[position] = value - pattern.minutes[position]!
    to[position] = at
    const out = canAlight(pattern, position) ? walkOut.get(pattern.stops[position]!) : undefined
    if (out) {
      const candidate = pattern.minutes[position]! + walkCost(out.minutes)
      if (candidate < value) {
        value = candidate
        at = position
      }
    }
  }
  return { best, to }
}

/** The best direct ride on each line that serves both ends. */
function direct(network: PlannerNetwork, access: Access[], egress: Access[]): Candidate[] {
  const walkIn = new Map(access.map((entry) => [entry.stop, entry]))
  const walkOut = new Map(egress.map((entry) => [entry.stop, entry]))
  const found: Candidate[] = []

  network.patterns.forEach((pattern, index) => {
    const on = boardings(pattern, walkIn)
    let best = Infinity
    let ride: Ride | null = null
    // Boarding strictly before alighting: `boardings` at a position includes
    // that position, so the one before is what a ride to here can have used.
    for (let position = 1; position < pattern.stops.length; position++) {
      if (!canAlight(pattern, position) || !walkOut.has(pattern.stops[position]!)) continue
      const cost = on.best[position - 1]! + pattern.minutes[position]! + walkCost(walkOut.get(pattern.stops[position]!)!.minutes)
      if (cost < best) {
        best = cost
        ride = { pattern: index, board: on.from[position - 1]!, alight: position }
      }
    }
    if (ride) {
      found.push({
        access: walkIn.get(pattern.stops[ride.board]!)!,
        rides: [ride],
        transfers: [],
        egress: walkOut.get(pattern.stops[ride.alight]!)!,
      })
    }
  })

  return found
}

/**
 * The best journey for each pair of lines with one change between them: off
 * the first at some stop, on foot to the second's stop if it is not the same
 * pole, and on to the end. Every pair, rather than the single best, because the
 * options are one per sequence of lines — the reader chooses between lines.
 */
function withOneChange(network: PlannerNetwork, access: Access[], egress: Access[]): Candidate[] {
  const walkIn = new Map(access.map((entry) => [entry.stop, entry]))
  const walkOut = new Map(egress.map((entry) => [entry.stop, entry]))
  const on = network.patterns.map((pattern) => boardings(pattern, walkIn))
  const off = network.patterns.map((pattern) => alightings(pattern, walkOut))

  // The best per pair of lines, kept in flat arrays: this is the inner loop of
  // every plan, and a keyed object per step of it was most of the time a plan took.
  const count = network.patterns.length
  const cost = new Float64Array(count * count).fill(Infinity)
  const offAt = new Int32Array(count * count)
  const onAt = new Int32Array(count * count)
  const walkMetres = new Float64Array(count * count)
  const walkMinutes = new Float64Array(count * count)

  network.patterns.forEach((first, firstIndex) => {
    for (let position = 1; position < first.stops.length; position++) {
      if (!canAlight(first, position)) continue
      const boardValue = on[firstIndex]!.best[position - 1]!
      if (boardValue === Infinity) continue
      const arrived = boardValue + first.minutes[position]!
      const stop = first.stops[position]!

      const change = (to: number, metres: number, minutes: number) => {
        for (const { pattern: secondIndex, position: boardAt } of network.servedBy[to]!) {
          // Changing to the same line — its other direction, or itself — is
          // never a change worth making.
          if (network.patterns[secondIndex]!.routeId === first.routeId) continue
          const onward = off[secondIndex]!.best[boardAt]!
          if (onward === Infinity) continue
          const total = arrived + walkCost(minutes) + onward
          const key = firstIndex * count + secondIndex
          if (cost[key]! <= total) continue
          cost[key] = total
          offAt[key] = position
          onAt[key] = boardAt
          walkMetres[key] = metres
          walkMinutes[key] = minutes
        }
      }
      change(stop, 0, 0)
      for (const path of network.footpaths[stop]!) change(path.stop, path.metres, path.minutes)
    }
  })

  const found: Candidate[] = []
  for (let key = 0; key < cost.length; key++) {
    if (cost[key] === Infinity) continue
    const firstIndex = Math.floor(key / count)
    const secondIndex = key % count
    const first = network.patterns[firstIndex]!
    const second = network.patterns[secondIndex]!
    const alightFirst = offAt[key]!
    const boardSecond = onAt[key]!
    const board = on[firstIndex]!.from[alightFirst - 1]!
    const alight = off[secondIndex]!.to[boardSecond]!
    found.push({
      access: walkIn.get(first.stops[board]!)!,
      rides: [
        { pattern: firstIndex, board, alight: alightFirst },
        { pattern: secondIndex, board: boardSecond, alight },
      ],
      transfers: [{ metres: walkMetres[key]!, minutes: walkMinutes[key]! }],
      egress: walkOut.get(second.stops[alight]!)!,
    })
  }
  return found
}

/**
 * The single best journey on three buses, round by round: the cheapest way to
 * be standing at each stop after one bus, then after two, then on to the end.
 */
function withTwoChanges(network: PlannerNetwork, access: Access[], egress: Access[]): Candidate | null {
  const count = network.stops.length
  const walkOut = new Map(egress.map((entry) => [entry.stop, entry]))

  interface Label {
    cost: number
    /** How this stop was reached: a ride, and the walk after it. */
    ride: Ride | null
    walkFrom: number
    walk: { minutes: number; metres: number }
    previous: Label | null
    access: Access | null
  }

  // Ready to board at a stop, round 0: walked there from the start.
  let ready: (Label | null)[] = new Array(count).fill(null)
  for (const entry of access) {
    ready[entry.stop] = { cost: walkCost(entry.minutes), ride: null, walkFrom: -1, walk: { minutes: 0, metres: 0 }, previous: null, access: entry }
  }

  for (let round = 1; round <= MAX_RIDES; round++) {
    const arrived: (Label | null)[] = new Array(count).fill(null)
    network.patterns.forEach((pattern, index) => {
      let boardedAt = -1
      let value = Infinity
      pattern.stops.forEach((stop, position) => {
        if (boardedAt >= 0 && canAlight(pattern, position)) {
          const cost = value + pattern.minutes[position]!
          if (cost < (arrived[stop]?.cost ?? Infinity)) {
            arrived[stop] = {
              cost,
              ride: { pattern: index, board: boardedAt, alight: position },
              walkFrom: -1,
              walk: { minutes: 0, metres: 0 },
              previous: ready[pattern.stops[boardedAt]!]!,
              access: null,
            }
          }
        }
        const label = canBoard(pattern, position) ? ready[stop] : null
        if (label && label.cost - pattern.minutes[position]! < value) {
          value = label.cost - pattern.minutes[position]!
          boardedAt = position
        }
      })
    })

    if (round === MAX_RIDES) {
      let best: Label | null = null
      let bestCost = Infinity
      for (const entry of egress) {
        const label = arrived[entry.stop]
        if (label && label.cost + walkCost(entry.minutes) < bestCost) {
          best = label
          bestCost = label.cost + walkCost(entry.minutes)
        }
      }
      if (!best) return null

      const rides: Ride[] = []
      const transfers: { minutes: number; metres: number }[] = []
      let label: Label | null = best
      let start: Access | null = null
      while (label) {
        if (label.ride) rides.unshift(label.ride)
        if (label.walkFrom >= 0) transfers.unshift(label.walk)
        if (label.access) start = label.access
        label = label.previous
      }
      const last = rides.at(-1)!
      return {
        access: start!,
        rides,
        transfers,
        egress: walkOut.get(network.patterns[last.pattern]!.stops[last.alight]!)!,
      }
    }

    // Ready for the next bus: where it got off, or a short walk from there.
    const next: (Label | null)[] = new Array(count).fill(null)
    arrived.forEach((label, stop) => {
      if (!label) return
      const cost = label.cost + TRANSFER_PENALTY
      for (const path of [{ stop, metres: 0, minutes: 0 }, ...network.footpaths[stop]!]) {
        const total = cost + walkCost(path.minutes)
        if (total < (next[path.stop]?.cost ?? Infinity)) {
          next[path.stop] = {
            cost: total,
            ride: null,
            walkFrom: stop,
            walk: { minutes: path.minutes, metres: path.metres },
            previous: label,
            access: null,
          }
        }
      }
    })
    ready = next
  }

  return null
}

/** What `journeyCost` would say of a candidate, without spelling it out first. */
function candidateCost(network: PlannerNetwork, candidate: Candidate): number {
  const walking = candidate.access.minutes + candidate.egress.minutes + candidate.transfers.reduce((sum, walk) => sum + walk.minutes, 0)
  const riding = candidate.rides.reduce((sum, ride) => {
    const pattern = network.patterns[ride.pattern]!
    return sum + pattern.minutes[ride.alight]! - pattern.minutes[ride.board]!
  }, 0)
  const rides = candidate.rides.length
  return walking + riding + WALK_RELUCTANCE * walking + WAIT_PER_BUS * rides + TRANSFER_PENALTY * Math.max(0, rides - 1)
}

function assemble(network: PlannerNetwork, candidate: Candidate): Journey {
  const stopId = (index: number) => network.stops[index]!.id
  const legs: JourneyLeg[] = []

  candidate.rides.forEach((ride, index) => {
    const pattern = network.patterns[ride.pattern]!
    const boardStop = stopId(pattern.stops[ride.board]!)
    if (index === 0) {
      legs.push({ kind: 'walk', fromStopId: null, toStopId: boardStop, metres: candidate.access.metres, minutes: candidate.access.minutes })
    } else {
      const previous = legs.at(-1) as RideLeg
      const change = candidate.transfers[index - 1]!
      legs.push({ kind: 'walk', fromStopId: previous.toStopId, toStopId: boardStop, metres: change.metres, minutes: change.minutes })
    }
    legs.push({
      kind: 'ride',
      routeId: pattern.routeId,
      direction: pattern.direction,
      fromStopId: boardStop,
      toStopId: stopId(pattern.stops[ride.alight]!),
      stopIds: pattern.stops.slice(ride.board, ride.alight + 1).map(stopId),
      board: ride.board,
      alight: ride.alight,
      metres: pattern.metres[ride.alight]! - pattern.metres[ride.board]!,
      minutes: pattern.minutes[ride.alight]! - pattern.minutes[ride.board]!,
      ...(pattern.turnsAt !== undefined && ride.board < pattern.turnsAt
        ? { turnsAtStopId: stopId(pattern.stops[pattern.turnsAt]!) }
        : {}),
      heading: pattern.turnsAt === ride.board ? (pattern.direction === 1 ? 2 : 1) : pattern.direction,
    })
  })

  const last = legs.at(-1) as RideLeg
  legs.push({ kind: 'walk', fromStopId: last.toStopId, toStopId: null, metres: candidate.egress.metres, minutes: candidate.egress.minutes })

  const rides = legs.filter((leg): leg is RideLeg => leg.kind === 'ride')
  const walks = legs.filter((leg): leg is WalkLeg => leg.kind === 'walk')

  return {
    kind: 'transit',
    // A zero-length walk is a stop that was the start or the end itself, or a
    // change at the same pole.
    legs: legs.filter((leg) => leg.kind === 'ride' || leg.metres > 1),
    minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
    rides: rides.length,
    walkMetres: walks.reduce((sum, leg) => sum + leg.metres, 0),
    walkMinutes: walks.reduce((sum, leg) => sum + leg.minutes, 0),
    key: rides.map((leg) => `${leg.routeId}:${leg.direction}`).join('>'),
  }
}

/** How a rider weighs a journey: the time it takes, a wait for every bus, and the changes and the walking felt. */
export const journeyCost = (journey: Journey) =>
  journey.minutes +
  WALK_RELUCTANCE * journey.walkMinutes +
  WAIT_PER_BUS * journey.rides +
  TRANSFER_PENALTY * Math.max(0, journey.rides - 1)

/**
 * Minutes that do not separate two options. The times are distance at an
 * average speed, good to a few minutes either way, and an option cut because
 * another was six seconds quicker by that arithmetic is a line the reader
 * would have taken and was never shown — which is how 7A-then-10 went missing.
 */
const CLEARLY = 2

const dominates = (a: Journey, b: Journey) =>
  a.minutes <= b.minutes &&
  a.rides <= b.rides &&
  a.walkMinutes <= b.walkMinutes &&
  (a.minutes < b.minutes - CLEARLY || a.rides < b.rides || a.walkMinutes < b.walkMinutes - CLEARLY)

/**
 * Lines that make the same ride — on at the same pole, off at the same pole —
 * are one option with a choice of bus, not two options: «10 or 10A», whichever
 * comes first. Only when the rides take about as long; a line that gets there
 * by a much longer way round is a different option.
 */
function mergeAlternatives(journeys: Journey[]): Journey[] {
  const shape = (journey: Journey) =>
    journey.legs.map((leg) => (leg.kind === 'ride' ? `${leg.fromStopId}>${leg.toStopId}` : '~')).join('|')
  const groups = new Map<string, Journey[]>()
  for (const journey of journeys) {
    if (journey.kind !== 'transit') continue
    const list = groups.get(shape(journey)) ?? []
    list.push(journey)
    groups.set(shape(journey), list)
  }

  const merged: Journey[] = journeys.filter((journey) => journey.kind !== 'transit')
  for (const list of groups.values()) {
    list.sort((a, b) => journeyCost(a) - journeyCost(b))
    const [best, ...rest] = list
    const alike = rest.filter((other) => other.minutes - best!.minutes <= CLEARLY)
    const legs = best!.legs.map((leg, index) => {
      if (leg.kind !== 'ride') return leg
      const also = alike
        .map((other) => other.legs[index] as RideLeg)
        .filter((other) => other.routeId !== leg.routeId)
        .map(({ routeId, direction }) => ({ routeId, direction }))
      const unique = also.filter((line, at) => also.findIndex((other) => other.routeId === line.routeId) === at)
      return unique.length ? { ...leg, also: unique } : leg
    })
    merged.push({ ...best!, legs }, ...rest.filter((other) => !alike.includes(other)))
  }
  return merged
}

/**
 * From every journey found to the few worth showing: nothing another option
 * beats on every count, one per set of lines, best first — and nothing so much
 * worse than the best that listing it would only be noise.
 */
function rank(candidates: Journey[]): Journey[] {
  const useful = candidates.filter((journey) => !candidates.some((other) => dominates(other, journey)))
  const sorted = useful.sort((a, b) => journeyCost(a) - journeyCost(b) || a.minutes - b.minutes)

  const seen = new Set<string>()
  const chosen: Journey[] = []
  const ceiling = sorted.length ? journeyCost(sorted[0]!) * WORSE_FACTOR + WORSE_ALLOWANCE : 0
  // The best way by bus survives the ceiling whatever it costs: a forty-minute
  // walk may beat it and says so by coming first, but someone who asked how to
  // get there by bus is owed the bus too.
  const bestTransit = sorted.find((journey) => journey.kind === 'transit')

  for (const journey of sorted) {
    if (seen.has(journey.key)) continue
    if (journey !== bestTransit && journeyCost(journey) > ceiling) continue
    seen.add(journey.key)
    chosen.push(journey)
    if (chosen.length === MAX_OPTIONS) break
  }

  return chosen
}
