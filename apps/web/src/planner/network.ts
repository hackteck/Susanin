import type { Direction, Stop, TimetablePattern } from '../api/types.ts'
import { metresBetween } from './geo.ts'
import { walkingMetres, walkingMinutes } from './walking.ts'

/**
 * Past this a change of bus is not a change any more, it is a walk somewhere
 * else. 400 m straight is about seven minutes on foot at the measured pace.
 */
export const TRANSFER_MAX_METRES = 400

/**
 * How much further a bus drives between two stops than the straight line
 * between them. Measured, not assumed: across the 53 directions whose stops
 * match their route's shape, the distance along the shape came out a median
 * 1.08× the sum of straight stop-to-stop hops (median hop 293 m).
 */
export const ROUTE_CIRCUITY = 1.08

/**
 * A bus's average speed, stops and traffic included: the network's own median
 * end-to-end speed, 19.6 km/h, measured by the API off every running-time
 * pattern that fits its shape (see the API's schedule.ts). It is the one number
 * here that comes from the timetable, and it is a speed, not a departure.
 */
export const BUS_METRES_PER_MINUTE = (19.6 * 1000) / 60

/**
 * A direction runs on into the other one when the bus can be seen to: its last
 * stop and the other's first within this of each other. Measured across the
 * network, the two ends of a route sit 9 m to 531 m apart — line 7's loop
 * closes over 426 m — and nothing further than that is the same bus turning.
 */
export const THROUGH_MAX_METRES = 600

/** One line in one direction: the stops it calls at, and how far and how long between them. */
export interface Pattern {
  routeId: string
  direction: Direction
  /** Stop indices, in travel order. */
  stops: number[]
  /** Road metres from the first stop, one per stop. */
  metres: number[]
  /** Riding minutes from the first stop, one per stop. */
  minutes: number[]
  /**
   * Set on a direction that runs on into the other one: the position of the
   * terminal it turns at. Such a pattern is only ever boarded at or before the
   * turn and left after it — anything else is one of the two directions on its
   * own, which are listed as themselves.
   */
  turnsAt?: number
}

/** Where a pattern can be boarded, and where left. */
export const canBoard = (pattern: Pattern, position: number) =>
  pattern.turnsAt === undefined || position <= pattern.turnsAt
export const canAlight = (pattern: Pattern, position: number) =>
  pattern.turnsAt === undefined || position > pattern.turnsAt

export interface Footpath {
  stop: number
  /** Street metres, estimated — see walking.ts. */
  metres: number
  minutes: number
}

export interface PlannerNetwork {
  stops: Stop[]
  index: Map<string, number>
  patterns: Pattern[]
  /** Stop → every pattern through it, with where in the pattern it sits. */
  servedBy: { pattern: number; position: number }[][]
  /** Stop → the stops a change of bus can walk to. */
  footpaths: Footpath[][]
}

/**
 * Everything the search reads, indexed once. The stop chains come from the
 * API's timetable, which is the one place every direction's chain is listed —
 * but only the chains: when a bus is scheduled plays no part. A direction the
 * timetable lists several times (one per running-time pattern) is one line.
 */
export function buildPlannerNetwork(stops: Stop[], timetable: TimetablePattern[]): PlannerNetwork {
  const index = new Map(stops.map((stop, position) => [stop.id, position]))
  const servedBy: PlannerNetwork['servedBy'] = stops.map(() => [])
  const patterns: Pattern[] = []
  const seen = new Set<string>()

  for (const source of timetable) {
    const key = `${source.routeId}:${source.direction}`
    if (seen.has(key)) continue
    // A pattern naming a stop the stop list does not have would board a bus
    // at a place the map cannot draw; it is dropped whole rather than cut short.
    const stopIndices = source.stopIds.map((id) => index.get(id))
    if (stopIndices.some((value) => value === undefined) || stopIndices.length < 2) continue
    seen.add(key)

    const chain = stopIndices as number[]
    const metres = [0]
    for (let at = 1; at < chain.length; at++) {
      metres.push(metres[at - 1]! + metresBetween(stops[chain[at - 1]!]!, stops[chain[at]!]!) * ROUTE_CIRCUITY)
    }

    const pattern: Pattern = {
      routeId: source.routeId,
      direction: source.direction,
      stops: chain,
      metres,
      minutes: metres.map((distance) => distance / BUS_METRES_PER_MINUTE),
    }
    const position = patterns.push(pattern) - 1
    pattern.stops.forEach((stop, at) => servedBy[stop]!.push({ pattern: position, position: at }))
  }

  // A bus does not stop being the same bus at the end of a direction: it turns
  // and drives back, and on a loop like line 7 it drives on round. The feed
  // splits every route in two at an arbitrary stop, and read literally that
  // split stranded riders — School №13 is the first stop of line 7's short
  // inbound leg, and nothing on that leg met the line that goes on to Horizon;
  // the bus itself does, three stops after its "terminal". So each direction
  // also runs on into the other, when the other starts where it ends.
  const directions = [...patterns]
  for (const leg of directions) {
    const next = directions.find((other) => other.routeId === leg.routeId && other.direction !== leg.direction)
    if (!next) continue
    const end = stops[leg.stops.at(-1)!]!
    const start = stops[next.stops[0]!]!
    const gap = metresBetween(end, start)
    if (gap > THROUGH_MAX_METRES) continue

    // The shared terminal pole appears once, not twice.
    const skip = next.stops[0] === leg.stops.at(-1) ? 1 : 0
    const offset = leg.metres.at(-1)! + gap * ROUTE_CIRCUITY
    const metres = [...leg.metres, ...next.metres.slice(skip).map((distance) => distance + offset)]
    const through: Pattern = {
      routeId: leg.routeId,
      direction: leg.direction,
      stops: [...leg.stops, ...next.stops.slice(skip)],
      metres,
      minutes: metres.map((distance) => distance / BUS_METRES_PER_MINUTE),
      turnsAt: leg.stops.length - 1,
    }
    const position = patterns.push(through) - 1
    through.stops.forEach((stop, at) => {
      if (canBoard(through, at)) servedBy[stop]!.push({ pattern: position, position: at })
    })
  }

  const footpaths: Footpath[][] = stops.map(() => [])
  for (let a = 0; a < stops.length; a++) {
    for (let b = a + 1; b < stops.length; b++) {
      const straight = metresBetween(stops[a]!, stops[b]!)
      if (straight > TRANSFER_MAX_METRES) continue
      const path = { metres: walkingMetres(straight), minutes: walkingMinutes(straight) }
      footpaths[a]!.push({ stop: b, ...path })
      footpaths[b]!.push({ stop: a, ...path })
    }
  }

  return { stops, index, patterns, servedBy, footpaths }
}
