import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Stop, TimetablePattern } from '../api/types.ts'
import { buildPlannerNetwork } from './network.ts'
import { nearbyStops, planJourneys, type Journey, type PlanQuery, type RideLeg, type WalkLeg } from './plan.ts'
import { BOARDING_SLACK, TRANSFER_SLACK, search, trace } from './raptor.ts'
import { walkingMinutes } from './walking.ts'
import { metresBetween } from './geo.ts'

/**
 * A made-up town small enough to check by hand. At 41.64°N a hundredth of a
 * degree is about 830 m east–west and 1.1 km north–south.
 *
 *   B runs north from beside A's last stop; A runs east.
 *   D is a slow direct line covering both A and B in one go.
 *   C publishes no timetable, off to the south where nothing else goes.
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
  stop('d0', 41.6395, 41.6005),
  stop('d1', 41.655, 41.62),
  stop('d2', 41.6705, 41.641),
  stop('c0', 41.6, 41.6),
  stop('c1', 41.6, 41.62),
  stop('c2', 41.6, 41.64),
]

const every = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step)

const pattern = (routeId: string, stopIds: string[], offsets: number[], departures: number[]): TimetablePattern => ({
  routeId,
  direction: 1,
  stopIds,
  offsets,
  departures,
  estimated: stopIds.map(() => !departures.length),
})

const timetable = [
  // Every ten minutes, 07:00 to 21:00.
  pattern('A', ['a0', 'a1', 'a2', 'a3', 'a4'], [0, 3, 6, 9, 12], every(420, 1260, 10)),
  // Every fifteen minutes, 07:00 to 21:00.
  pattern('B', ['b0', 'b1', 'b2', 'b3'], [0, 4, 8, 12], every(420, 1260, 15)),
  // Once, at 08:30, and slower than changing — but not absurdly so.
  pattern('D', ['d0', 'd1', 'd2'], [0, 15, 35], [510]),
  pattern('C', ['c0', 'c1', 'c2'], [0, 5, 10], []),
]

const network = buildPlannerNetwork(stops, timetable)

const near = (id: string) => {
  const found = stops.find((candidate) => candidate.id === id)!
  // A few metres off the pole, as a real tap or fix would be.
  return { lat: found.lat + 0.0001, lon: found.lon + 0.0001 }
}

const plan = (from: string, to: string, at: number, mode: PlanQuery['mode'] = 'depart') =>
  planJourneys(network, { from: near(from), to: near(to), at, mode })

const rides = (journey: Journey) => journey.legs.filter((leg): leg is RideLeg => leg.kind === 'ride')

test('a direct ride takes the first bus it can actually make', () => {
  const [best] = plan('a0', 'a3', 480).journeys

  assert.ok(best)
  assert.deepEqual(rides(best).map((leg) => leg.routeId), ['A'])
  // The 08:00 is due the moment the search starts, and nobody can be at the
  // pole with a minute to spare at the moment they start walking.
  assert.equal(rides(best)[0]!.depart, 490)
  assert.equal(rides(best)[0]!.arrive, 499)
})

test('setting off is timed to the bus, not to the moment of asking', () => {
  const [best] = plan('a0', 'a3', 480).journeys
  const walk = best!.legs[0]!

  assert.equal(walk.kind, 'walk')
  assert.ok(Math.abs(best!.depart - (490 - BOARDING_SLACK - walk.minutes)) < 1e-9)
})

test('a change of bus leaves time to walk across and be there first', () => {
  const [best] = plan('a0', 'b3', 480).journeys
  const [first, second] = rides(best!)

  assert.deepEqual([first!.routeId, second!.routeId], ['A', 'B'])
  // A reaches a4 at 08:22; the B at 08:25 would need no walk and no slack.
  assert.equal(first!.arrive, 502)
  assert.equal(second!.depart, 510)

  const transfer = best!.legs.find((leg): leg is WalkLeg => leg.kind === 'walk' && !!leg.fromStopId && !!leg.toStopId)
  assert.ok(transfer, 'no walk between the two stops')
  assert.ok(first!.arrive + transfer.minutes + TRANSFER_SLACK <= second!.depart)
})

test('the legs of a journey follow one another in time', () => {
  for (const journey of plan('a0', 'b3', 480).journeys) {
    for (let index = 1; index < journey.legs.length; index++) {
      const before = journey.legs[index - 1]!
      const after = journey.legs[index]!
      assert.ok(before.arrive <= after.depart + 1e-9, `${journey.key}: leg ${index} starts before the last one ends`)
    }
    assert.equal(journey.depart, journey.legs[0]!.depart)
    assert.equal(journey.arrive, journey.legs.at(-1)!.arrive)
  }
})

test('a somewhat slower direct line is offered beside a faster change', () => {
  const { journeys } = plan('a0', 'b3', 480)

  assert.equal(journeys[0]!.key, 'A:1>B:1', 'the change is quicker by twenty minutes')
  assert.ok(
    journeys.some((journey) => journey.key === 'D:1'),
    'the one-bus alternative is worth showing',
  )
})

test('no two options ride the same lines', () => {
  const { journeys } = plan('a0', 'b3', 480)
  assert.equal(new Set(journeys.map((journey) => journey.key)).size, journeys.length)
})

test('after the last bus, the plan is for the first one tomorrow', () => {
  const [best] = plan('a0', 'a3', 23 * 60 + 30).journeys.filter((journey) => journey.kind === 'transit')

  assert.ok(best)
  assert.equal(rides(best)[0]!.depart, 1440 + 420)
})

test('arrive-by leaves as late as still gets there in time', () => {
  const { journeys } = plan('a0', 'a3', 540, 'arrive')
  const best = journeys.find((journey) => journey.kind === 'transit')

  assert.ok(best)
  assert.ok(best.arrive <= 540, `arrives at ${best.arrive}`)
  // The 08:50 reaches a3 at 08:59; the 09:00 would be nine minutes late.
  assert.equal(rides(best)[0]!.depart, 530)
})

test('a destination a few steps away is a walk, and nothing else', () => {
  const from = near('a0')
  const to = { lat: from.lat + 0.001, lon: from.lon }
  const { journeys } = planJourneys(network, { from, to, at: 480, mode: 'depart' })

  assert.deepEqual(
    journeys.map((journey) => journey.kind),
    ['walk'],
  )
})

test('walking is offered when it is a real alternative', () => {
  const { journeys } = plan('a0', 'a1', 480)

  assert.ok(journeys.some((journey) => journey.kind === 'walk'))
  assert.ok(journeys.some((journey) => journey.kind === 'transit'))
})

test('a line with no timetable is offered apart, with a ride time and no departure', () => {
  const result = plan('c0', 'c2', 480)

  assert.equal(result.journeys.filter((journey) => journey.kind === 'transit').length, 0)
  assert.equal(result.untimed.length, 1)
  assert.equal(result.untimed[0]!.routeId, 'C')
  assert.equal(result.untimed[0]!.ride.minutes, 10)
  assert.ok(result.untimed[0]!.ride.estimated)
})

test('somewhere with no stop close by still gets its nearest few', () => {
  const nowhere = { lat: 41.62, lon: 41.6 }
  const access = nearbyStops(network, nowhere)

  assert.equal(access.length, 3)
  const nearest = Math.min(...stops.map((candidate) => metresBetween(nowhere, candidate)))
  assert.ok(Math.abs(Math.min(...access.map((entry) => entry.minutes)) - walkingMinutes(nearest)) < 1e-9)
})

test('an end with no stop within reach is named, not silently empty', () => {
  const result = planJourneys(network, { from: near('a0'), to: { lat: 41.9, lon: 41.9 }, at: 480, mode: 'depart' })

  assert.equal(result.noStopsNear, 'to')
  assert.deepEqual(result.journeys, [])
})

test('an option far worse than the best is not offered at all', () => {
  const slow = buildPlannerNetwork(stops, [
    ...timetable.filter((entry) => entry.routeId !== 'D'),
    // Ninety minutes for what A and B do in forty.
    pattern('D', ['d0', 'd1', 'd2'], [0, 30, 90], [510]),
  ])
  const { journeys } = planJourneys(slow, { from: near('a0'), to: near('b3'), at: 480, mode: 'depart' })

  assert.ok(!journeys.some((journey) => journey.key === 'D:1'))
})

test('standing at the pole as the bus is due is not catching it', () => {
  // No walk at all, so only the boarding slack stands between 08:00 and 08:10.
  const at = stops.find((candidate) => candidate.id === 'a0')!
  const { journeys } = planJourneys(network, { from: at, to: near('a3'), at: 480, mode: 'depart' })

  assert.equal(rides(journeys.find((journey) => journey.kind === 'transit')!)[0]!.depart, 490)
})

test('a connection two minutes after arriving is not one to plan on', () => {
  // P reaches the shared stop at 08:20; Q leaves it at 08:22 and again at 08:32.
  const tight = buildPlannerNetwork(
    [stop('p0', 41.64, 41.6), stop('x', 41.64, 41.62), stop('q1', 41.66, 41.62)],
    [pattern('P', ['p0', 'x'], [0, 20], [480]), pattern('Q', ['x', 'q1'], [0, 10], [502, 512])],
  )
  const [best] = planJourneys(tight, {
    from: { lat: 41.64, lon: 41.6 },
    to: { lat: 41.66, lon: 41.62 },
    at: 470,
    mode: 'depart',
  }).journeys.filter((journey) => journey.kind === 'transit')

  assert.deepEqual(rides(best!).map((leg) => leg.depart), [480, 512])
})

test('one search boards a bus where the walk to it is shortest, not where the scan met it', () => {
  // The origin is beside p1; p0 is 400 m back up the line and the same bus is
  // still catchable there. Asked of a single search, not of a whole plan: the
  // later searches a plan runs can stumble on the better stop by luck, and did
  // here while the real network went on sending people the long way round.
  const line = buildPlannerNetwork(
    [stop('p0', 41.64, 41.6), stop('p1', 41.64, 41.605), stop('p2', 41.64, 41.65)],
    [pattern('P', ['p0', 'p1', 'p2'], [0, 2, 20], [480])],
  )
  const access = nearbyStops(line, { lat: 41.6401, lon: 41.6049 })
  const labels = search(line, access, 470, 1)
  const legs = trace(line, labels, 1, line.index.get('p2')!)
  const ride = legs?.find((leg) => leg.kind === 'ride')

  assert.equal(ride?.kind === 'ride' ? ride.board : -1, 1)
})
