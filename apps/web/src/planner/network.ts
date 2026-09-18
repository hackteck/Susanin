import type { Direction, Stop, TimetablePattern } from '../api/types.ts'
import { metresBetween } from './geo.ts'
import { walkingMetres, walkingMinutes } from './walking.ts'

/**
 * Past this a change of bus is not a change any more, it is a walk somewhere
 * else. 400 m straight is about seven minutes on foot at the measured pace.
 */
export const TRANSFER_MAX_METRES = 400

export interface Pattern {
  routeId: string
  direction: Direction
  /** Stop indices, in travel order. */
  stops: number[]
  offsets: number[]
  estimated: boolean[]
  /**
   * Departures from the first stop for yesterday, today and tomorrow, as one
   * ascending list of minutes relative to today's midnight. One timetable
   * serves every day, so tomorrow's first bus is today's plus 1440 — which is
   * what lets a search started at 23:40 find the 06:30, and one started at
   * 00:05 still catch a bus that left before midnight.
   */
  departures: number[]
  /** A line with no published timetable: its ride times are known, its departures are not. */
  timed: boolean
}

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
 * Everything the search reads, indexed once. The timetable changes about once a
 * year and the stop list with it, so this is built when the data arrives, not
 * per query.
 */
export function buildPlannerNetwork(stops: Stop[], timetable: TimetablePattern[]): PlannerNetwork {
  const index = new Map(stops.map((stop, position) => [stop.id, position]))
  const servedBy: PlannerNetwork['servedBy'] = stops.map(() => [])
  const patterns: Pattern[] = []

  for (const source of timetable) {
    // A pattern naming a stop the stop list does not have would board a bus
    // at a place the map cannot draw; it is dropped whole rather than cut short.
    const stopIndices = source.stopIds.map((id) => index.get(id))
    if (stopIndices.some((value) => value === undefined) || stopIndices.length < 2) continue

    const today = [...source.departures].sort((a, b) => a - b)
    const pattern: Pattern = {
      routeId: source.routeId,
      direction: source.direction,
      stops: stopIndices as number[],
      offsets: source.offsets,
      estimated: source.estimated,
      departures: [...today.map((minute) => minute - 1440), ...today, ...today.map((minute) => minute + 1440)],
      timed: today.length > 0,
    }

    const position = patterns.push(pattern) - 1
    pattern.stops.forEach((stop, at) => servedBy[stop]!.push({ pattern: position, position: at }))
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

/**
 * The first trip of a pattern that is at `position` no earlier than `minute`,
 * as an index into `departures`, or -1. Every trip of a pattern keeps the same
 * running times, so trips never overtake one another and a binary search over
 * the first stop's departures is exact.
 */
export function firstTripFrom(pattern: Pattern, position: number, minute: number): number {
  const target = minute - pattern.offsets[position]!
  let low = 0
  let high = pattern.departures.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (pattern.departures[middle]! < target) low = middle + 1
    else high = middle
  }
  return low < pattern.departures.length ? low : -1
}

/** When a trip is at a position along its pattern. */
export const tripTime = (pattern: Pattern, trip: number, position: number) =>
  pattern.departures[trip]! + pattern.offsets[position]!
