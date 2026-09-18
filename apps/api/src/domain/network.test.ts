import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchDataset } from '../upstream/thetamaps.ts'
import { getNetwork, MAX_FIT_M } from './network.ts'
import { MAX_HOP_KMH } from './schedule.ts'

/**
 * The map-matching quality guard, over the real network.
 *
 * Every arrival estimate is "distance still to run along the line", which is
 * only meaningful if a route's shape genuinely describes where its buses drive.
 * Some of these polylines are drawn against the direction of travel and some
 * start halfway round the cycle; `alignToChain` is what detects and corrects
 * both. Removing either correction fails the fit test below, by name.
 *
 * The metric here is the *fit* — how far stops sit from the line they matched
 * to — and it is deliberately not a count of out-of-order stops. That was the
 * first thing tried and it is inert: `matchChain` walks forward only, so it
 * cannot produce an out-of-order result no matter how badly the shape fits.
 * Disabling the orientation fix on purpose left that count at zero while this
 * number went to infinity on two routes, which is how the metric was chosen.
 */

/** Measured across the real network: 5 m typical, 12 m on the worst route. */
const EXPECTED_TYPICAL_FIT_M = 40

const network = await (async () => {
  try {
    return await getNetwork()
  } catch {
    return null
  }
})()

const live = network ? {} : { skip: 'upstream unreachable — see UPSTREAM_BASE in .env.example' }

test('every route has a shape and a stop chain to match against it', live, () => {
  assert.ok(network)

  for (const route of network.routes.values()) {
    assert.ok(network.shapes.has(route.id), `route ${route.shortName} has no measured shape`)
    assert.ok(network.stopsOnRoute.get(route.id)?.length, `route ${route.shortName} has no stops`)
  }
})

test('every route shape actually describes where its buses drive', live, () => {
  assert.ok(network)

  const fits: number[] = []
  const bad: string[] = []

  for (const route of network.routes.values()) {
    for (const [direction, band] of network.bands.get(route.id) ?? []) {
      fits.push(band.fitMeters)
      if (!(band.fitMeters <= MAX_FIT_M)) {
        bad.push(`route ${route.shortName} direction ${direction}: ${Math.round(band.fitMeters)} m off the line`)
      }
    }
  }

  assert.ok(fits.length > 0, 'no direction legs to check')
  // Above the threshold the estimator silently stops offering that leg a live
  // time, so it is worth failing loudly here instead of shipping a quiet gap.
  assert.deepEqual(bad, [], `legs the estimator would give up on:\n  ${bad.join('\n  ')}`)

  const typical = fits.sort((a, b) => a - b)[Math.floor(fits.length / 2)]!
  assert.ok(
    typical <= EXPECTED_TYPICAL_FIT_M,
    `typical fit is ${Math.round(typical)} m — matching has regressed`,
  )
})

test('each direction occupies its own stretch of the round trip', live, () => {
  assert.ok(network)

  for (const route of network.routes.values()) {
    const bands = network.bands.get(route.id)
    const outbound = bands?.get(1)
    const inbound = bands?.get(2)
    if (!outbound || !inbound) continue

    // The two legs are what let a bus be told apart from one going the other
    // way down the same street. Overlapping bands would make that impossible.
    assert.ok(
      outbound.min < inbound.max,
      `route ${route.shortName}: directions are inverted along the shape`,
    )
  }
})

test('every stop sits inside the band of the direction that serves it', live, () => {
  assert.ok(network)

  for (const route of network.routes.values()) {
    const bands = network.bands.get(route.id)
    for (const stop of network.stopsOnRoute.get(route.id) ?? []) {
      const band = bands?.get(stop.direction)
      if (!band) continue
      assert.ok(
        stop.along >= band.min && stop.along <= band.max,
        `route ${route.shortName}: a stop matched outside its own direction`,
      )
    }
  }
})

test('a direction always knows where it is going', live, () => {
  assert.ok(network)

  // The UI shows "→ destination" everywhere instead of "outbound/inbound", so
  // an empty headsign is a blank label rather than a cosmetic gap.
  for (const stop of network.stops.values()) {
    for (const schedule of stop.schedules) {
      assert.ok(schedule.headsign.ka, `stop ${stop.code}, route ${schedule.shortName}: headsign not backfilled`)
      assert.ok(schedule.headsign.ru, `stop ${stop.code}, route ${schedule.shortName}: no Russian headsign`)
    }
  }
})

test('every direction that publishes times lines up into trips', live, () => {
  assert.ok(network)

  // An untimed pattern is either a direction with no times at all, or one whose
  // per-stop lists stopped lining up — and the second is upstream changing shape
  // under us, which must be heard about here rather than as a planner that
  // quietly stopped offering a line.
  const broken = network.timetable.filter(
    (pattern) =>
      !pattern.departures.length &&
      pattern.stopIds.some((id) =>
        network.stops.get(id)?.schedules.some((s) => s.routeId === pattern.routeId && s.direction === pattern.direction && s.times.length),
      ),
  )

  assert.deepEqual(
    broken.map((pattern) => `${network.routes.get(pattern.routeId)?.shortName} direction ${pattern.direction}`),
    [],
  )
  assert.ok(network.timetable.filter((pattern) => pattern.departures.length).length > 30, 'hardly any timed patterns')
})

test('no bus is scheduled faster than a bus can go', live, () => {
  assert.ok(network)

  // The published timetable does this in ten directions — route 8 inbound runs
  // 13.8 km in three minutes — and the repair in schedule.ts is what stops it.
  // Checked over every pair of stops, not every hop: a run of zero-minute hops
  // is each fine alone and impossible together.
  const tooFast: string[] = []

  for (const pattern of network.timetable) {
    if (!pattern.departures.length) continue
    const leg = (network.stopsOnRoute.get(pattern.routeId) ?? []).filter((stop) => stop.direction === pattern.direction)
    const along = leg.map((stop) => stop.along)

    for (let from = 0; from < along.length; from++) {
      for (let to = from + 1; to < along.length; to++) {
        const minutes = pattern.offsets[to]! - pattern.offsets[from]! + 2
        const kmh = (along[to]! - along[from]!) / 1000 / (minutes / 60)
        if (kmh > MAX_HOP_KMH) {
          tooFast.push(`${network.routes.get(pattern.routeId)?.shortName} d${pattern.direction} stops ${from}-${to}: ${Math.round(kmh)} km/h`)
        }
      }
    }
  }

  assert.deepEqual(tooFast.slice(0, 5), [])
  // What the broken patterns are re-derived at. Measured at 19.6 km/h; a number
  // far from that means the plausible patterns it is taken from have changed.
  assert.ok(network.typicalKmh > 12 && network.typicalKmh < 30, `typical scheduled speed ${network.typicalKmh} km/h`)
})

test('a direction upstream got right keeps its published times', live, async () => {
  assert.ok(network)
  const raw = await fetchDataset()

  let untouched = 0
  for (const stop of network.stops.values()) {
    for (const schedule of stop.schedules) {
      if (schedule.estimated) continue
      const published = [...(raw.data.busStops[stop.id]?.routes?.[schedule.routeId]?.times ?? [])].sort()
      assert.deepEqual(schedule.times, published, `stop ${stop.code}, route ${schedule.shortName}`)
      untouched++
    }
  }

  // Most of the network is fine; a repair that reached everything would be a
  // repair that stopped telling the difference.
  const total = [...network.stops.values()].reduce((sum, stop) => sum + stop.schedules.length, 0)
  assert.ok(untouched / total > 0.8, `only ${untouched} of ${total} schedules kept as published`)
})
