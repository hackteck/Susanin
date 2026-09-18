import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Direction, Stop, TimetablePattern } from '../api/types.ts'
import { metresBetween } from './geo.ts'
import { BUS_METRES_PER_MINUTE, ROUTE_CIRCUITY, buildPlannerNetwork } from './network.ts'
import { nearbyStops, planJourneys, type Journey, type RideLeg, type WalkLeg } from './plan.ts'
import { walkingMinutes } from './walking.ts'

/**
 * A made-up town small enough to check by hand. At 41.64°N a hundredth of a
 * degree is about 830 m east–west and 1.1 km north–south.
 *
 *   A runs east; B runs north from beside A's last stop.
 *   C publishes no timetable at all — and is planned like any other line.
 *   T turns at its terminal: its second direction starts 150 m from where the
 *     first one ends, and the bus drives on round.
 *   E and F make the same ride between the same two poles.
 */
const stop = (id: string, lat: number, lon: number): Stop => ({
  id,
  code: 0,
  name: { ka: id, en: id, ru: id },
  lat,
  lon,
  routeIds: [],
})

const stops = [
  stop('a0', 41.64, 41.6),
  stop('a1', 41.64, 41.61),
  stop('a2', 41.64, 41.62),
  stop('a3', 41.64, 41.63),
  stop('a4', 41.64, 41.64),
  stop('b0', 41.6405, 41.6405),
  stop('b1', 41.65, 41.6405),
  stop('b2', 41.66, 41.6405),
  stop('b3', 41.67, 41.6405),
  stop('c0', 41.6, 41.6),
  stop('c1', 41.6, 41.62),
  stop('c2', 41.6, 41.64),
  stop('t0', 41.7, 41.6),
  stop('t1', 41.7, 41.61),
  stop('t2', 41.7, 41.62),
  stop('t3', 41.7013, 41.62),
  stop('t4', 41.72, 41.62),
  stop('t5', 41.72, 41.6),
  stop('e0', 41.56, 41.6),
  stop('e1', 41.56, 41.61),
  stop('e2', 41.56, 41.62),
  stop('f1', 41.5605, 41.61),
]

const pattern = (routeId: string, direction: Direction, stopIds: string[], departures: number[] = [480]): TimetablePattern => ({
  routeId,
  direction,
  stopIds,
  // The planner reads neither of these: the chains are what it plans on.
  offsets: stopIds.map((_, index) => index * 3),
  departures,
  estimated: stopIds.map(() => false),
})

const timetable = [
  pattern('A', 1, ['a0', 'a1', 'a2', 'a3', 'a4']),
  // The same direction listed twice, as the API lists one per running-time pattern.
  pattern('A', 1, ['a0', 'a1', 'a2', 'a3', 'a4'], [900]),
  pattern('B', 1, ['b0', 'b1', 'b2', 'b3']),
  pattern('C', 1, ['c0', 'c1', 'c2'], []),
  pattern('T', 1, ['t0', 't1', 't2']),
  pattern('T', 2, ['t3', 't4', 't5']),
  pattern('E', 1, ['e0', 'e1', 'e2']),
  pattern('F', 1, ['e0', 'f1', 'e2']),
]

const network = buildPlannerNetwork(stops, timetable)

const near = (id: string) => {
  const found = stops.find((candidate) => candidate.id === id)!
  // A few metres off the pole, as a real tap or fix would be.
  return { lat: found.lat + 0.0001, lon: found.lon + 0.0001 }
}

const plan = (from: string, to: string) => planJourneys(network, { from: near(from), to: near(to) })
const rides = (journey: Journey) => journey.legs.filter((leg): leg is RideLeg => leg.kind === 'ride')
const transit = (journeys: Journey[]) => journeys.filter((journey) => journey.kind === 'transit')

test('a direct ride is offered, and timed by the distance the bus drives', () => {
  const [best] = transit(plan('a0', 'a3').journeys)

  assert.ok(best)
  const [ride] = rides(best)
  assert.deepEqual([ride!.routeId, ride!.fromStopId, ride!.toStopId], ['A', 'a0', 'a3'])

  const hops = [0, 1, 2].reduce((sum, at) => sum + metresBetween(stops[at]!, stops[at + 1]!), 0)
  assert.ok(Math.abs(ride!.metres - hops * ROUTE_CIRCUITY) < 1e-6)
  assert.ok(Math.abs(ride!.minutes - ride!.metres / BUS_METRES_PER_MINUTE) < 1e-9)
})

test('when a bus is scheduled plays no part — a line with no timetable is planned like any other', () => {
  const [best] = transit(plan('c0', 'c2').journeys)

  assert.ok(best, 'no option on the line that publishes no departures')
  assert.deepEqual(rides(best).map((leg) => leg.routeId), ['C'])
})

test('a change of bus is found where no one line goes all the way', () => {
  const best = transit(plan('a0', 'b3').journeys).find((journey) => journey.rides === 2)

  assert.ok(best)
  const [first, second] = rides(best)
  assert.deepEqual([first!.routeId, second!.routeId], ['A', 'B'])
  const change = best.legs.find((leg): leg is WalkLeg => leg.kind === 'walk' && !!leg.fromStopId && !!leg.toStopId)
  assert.ok(change, 'no walk between the two poles')
  assert.deepEqual([change.fromStopId, change.toStopId], ['a4', 'b0'])
})

test('the legs of a journey join up, and a ride only goes forward', () => {
  for (const journey of plan('a0', 'b3').journeys) {
    for (const leg of rides(journey)) {
      assert.ok(leg.board < leg.alight, `${journey.key}: rides backwards`)
      assert.equal(leg.stopIds[0], leg.fromStopId)
      assert.equal(leg.stopIds.at(-1), leg.toStopId)
    }
    const total = journey.legs.reduce((sum, leg) => sum + leg.minutes, 0)
    assert.ok(Math.abs(total - journey.minutes) < 1e-9)
  }
})

test('no two options ride the same lines', () => {
  const { journeys } = plan('a0', 'b3')
  assert.equal(new Set(journeys.map((journey) => journey.key)).size, journeys.length)
})

test('a bus that turns at its terminal can be ridden through it', () => {
  // t1 is on the first direction and t4, two kilometres north, on the second:
  // only the bus that turns at t2 and carries on joins them.
  const [best] = transit(plan('t1', 't4').journeys)

  assert.ok(best, 'the bus drives on round, and the plan does not know it')
  const [ride] = rides(best)
  assert.equal(best.rides, 1)
  assert.deepEqual([ride!.routeId, ride!.fromStopId, ride!.toStopId], ['T', 't1', 't4'])
  assert.equal(ride!.turnsAtStopId, 't2')
  assert.equal(ride!.direction, 1, 'boarded on the direction it is on at that stop')
  assert.equal(ride!.heading, 1)
})

test('a direction does not run on into one that starts somewhere else', () => {
  // A ends at a4; its "other direction" does not exist, and B is another line.
  assert.ok(network.patterns.every((pattern) => pattern.routeId !== 'A' || pattern.turnsAt === undefined))
  assert.equal(network.patterns.filter((pattern) => pattern.routeId === 'A').length, 1, 'one direction listed twice is one line')
})

test('lines that make the same ride are one option with a choice of bus', () => {
  const options = transit(plan('e0', 'e2').journeys)

  assert.equal(options.length, 1, options.map((journey) => journey.key).join(' | '))
  const [ride] = rides(options[0]!)
  const lines = [ride!.routeId, ...(ride!.also ?? []).map((line) => line.routeId)].sort()
  assert.deepEqual(lines, ['E', 'F'])
})

test('an option only a little slower is still offered', () => {
  // Two lines side by side, one about a minute slower by the arithmetic.
  const pair = buildPlannerNetwork(
    [stop('p0', 41.64, 41.6), stop('p1', 41.64, 41.63), stop('q0', 41.6402, 41.6), stop('q1', 41.6402, 41.6305)],
    [pattern('P', 1, ['p0', 'p1']), pattern('Q', 1, ['q0', 'q1'])],
  )
  const { journeys } = planJourneys(pair, { from: { lat: 41.6401, lon: 41.6 }, to: { lat: 41.6401, lon: 41.6302 } })
  const lines = transit(journeys).map((journey) => rides(journey)[0]!.routeId).sort()

  assert.deepEqual(lines, ['P', 'Q'], 'a second a minute slower by the arithmetic was cut')
})

test('an option far worse than the best is not offered at all', () => {
  const slow = buildPlannerNetwork(
    [...stops, stop('z0', 41.66, 41.6), stop('z1', 41.66, 41.7)],
    [
      ...timetable,
      // From beside a0 out east for seven kilometres and back to beside a3.
      pattern('Z', 1, ['a0', 'z0', 'z1', 'a3']),
    ],
  )
  const { journeys } = planJourneys(slow, { from: near('a0'), to: near('a3') })

  assert.ok(!journeys.some((journey) => rides(journey).some((leg) => leg.routeId === 'Z')))
})

test('a bus is boarded where the walk to it is shortest, not where the line begins', () => {
  // The start is beside a2; a0 is 1.6 km back up the same line.
  const [best] = transit(plan('a2', 'a4').journeys)
  assert.equal(rides(best!)[0]!.fromStopId, 'a2')
})

test('three buses when fewer will not do', () => {
  const chain = buildPlannerNetwork(
    [
      stop('x0', 41.64, 41.6),
      stop('x1', 41.64, 41.62),
      stop('y0', 41.6405, 41.6205),
      stop('y1', 41.66, 41.6205),
      stop('w0', 41.6605, 41.621),
      stop('w1', 41.66, 41.65),
    ],
    [pattern('X', 1, ['x0', 'x1']), pattern('Y', 1, ['y0', 'y1']), pattern('W', 1, ['w0', 'w1'])],
  )
  const [best] = transit(planJourneys(chain, { from: { lat: 41.6401, lon: 41.6 }, to: { lat: 41.6601, lon: 41.65 } }).journeys)

  assert.ok(best)
  assert.deepEqual(rides(best).map((leg) => leg.routeId), ['X', 'Y', 'W'])
})

test('a destination a few steps away is a walk, and nothing else', () => {
  const from = near('a0')
  const to = { lat: from.lat + 0.001, lon: from.lon }
  const { journeys } = planJourneys(network, { from, to })

  assert.deepEqual(
    journeys.map((journey) => journey.kind),
    ['walk'],
  )
})

test('walking is offered when it is a real alternative', () => {
  const { journeys } = plan('a0', 'a1')

  assert.ok(journeys.some((journey) => journey.kind === 'walk'))
  assert.ok(journeys.some((journey) => journey.kind === 'transit'))
})

test('somewhere with no stop close by still gets its nearest few', () => {
  const nowhere = { lat: 41.62, lon: 41.6 }
  const access = nearbyStops(network, nowhere)

  assert.equal(access.length, 3)
  const nearest = Math.min(...stops.map((candidate) => metresBetween(nowhere, candidate)))
  assert.ok(Math.abs(Math.min(...access.map((entry) => entry.minutes)) - walkingMinutes(nearest)) < 1e-9)
})

test('an end with no stop within reach is named, not silently empty', () => {
  const result = planJourneys(network, { from: near('a0'), to: { lat: 41.9, lon: 41.9 } })

  assert.equal(result.noStopsNear, 'to')
  assert.deepEqual(result.journeys, [])
})
