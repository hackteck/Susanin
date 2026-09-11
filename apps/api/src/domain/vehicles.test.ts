import assert from 'node:assert/strict'
import { test } from 'node:test'
import { observe } from './vehicles.ts'

const LAT = 41.64
const LON = 41.63
/** 40 m north in 5 s is 28.8 km/h — a bus pulling away from a stop. */
const NORTH_40_M = 40 / 111320

// Positions are cached for 4 s and every request observes the fleet, so one
// standstill is seen a dozen times a minute. The decay has to depend on the
// minute, not on the dozen — the first version compounded and a bus at a red
// light read as stopped dead in thirty seconds.
test('a standing bus loses half its speed a minute, however often it is observed', () => {
  const id = 'AA-001-BB'
  const t0 = 1_000_000

  observe(id, LAT, LON, t0)
  const moving = observe(id, LAT + NORTH_40_M, LON, t0 + 5000)
  const speedWhenStopped = moving.speedKmh!
  assert.ok(speedWhenStopped > 25 && speedWhenStopped < 32, `measured ${speedWhenStopped} km/h`)

  let track = moving
  for (let sample = 1; sample <= 12; sample++) {
    track = observe(id, LAT + NORTH_40_M, LON, t0 + 5000 + sample * 5000)
  }

  const expected = speedWhenStopped / 2
  assert.ok(
    Math.abs(track.speedKmh! - expected) < 1.5,
    `after a minute at the kerb: ${track.speedKmh} km/h, expected about ${expected}`,
  )
})
