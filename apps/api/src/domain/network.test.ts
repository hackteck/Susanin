import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getNetwork } from './network.ts'

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

/** Matches the threshold `arrivals.ts` uses before it refuses to estimate at all. */
const MAX_FIT_M = 120
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
