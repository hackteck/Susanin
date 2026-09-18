import assert from 'node:assert/strict'
import { test } from 'node:test'
import { metresBetween } from './geo.ts'
import { sliceLine } from './geometry.ts'
import { clockLabel, minutesInBatumi, parseClock, upcoming } from './time.ts'

test("the planner's clock is Batumi's, whatever the device's time zone", () => {
  // 20:00 UTC is midnight in Batumi — UTC+4, no daylight saving.
  assert.equal(minutesInBatumi(new Date('2026-09-18T20:00:00Z')), 0)
  assert.equal(minutesInBatumi(new Date('2026-09-18T03:30:30Z')), 7 * 60 + 30.5)
})

test('clock labels wrap past midnight rather than printing 24:10', () => {
  assert.equal(clockLabel(7 * 60 + 5.9), '07:05')
  assert.equal(clockLabel(1440 + 70), '01:10')
})

test('a typed time is today unless it is clearly already gone', () => {
  const now = 22 * 60
  assert.equal(upcoming(7 * 60, now), 1440 + 7 * 60, '07:00 at ten at night means tomorrow')
  assert.equal(upcoming(21 * 60 + 50, now), 21 * 60 + 50, 'ten minutes ago is someone who took a moment to type')
  assert.equal(parseClock('7:05'), 425)
  assert.equal(parseClock('25:00'), null)
})

test('a slice of line runs from one distance to the other and no further', () => {
  // Three points due east, roughly 830 m apart.
  const shape: [number, number][] = [
    [41.64, 41.6],
    [41.64, 41.61],
    [41.64, 41.62],
  ]
  const leg = metresBetween({ lat: 41.64, lon: 41.6 }, { lat: 41.64, lon: 41.61 })
  const cut = sliceLine(shape, leg / 2, leg * 1.5)

  assert.equal(cut.length, 3, 'start, the vertex in between, end')
  assert.ok(Math.abs(cut[0]![1] - 41.605) < 1e-6)
  assert.deepEqual(cut[1], shape[1])
  assert.ok(Math.abs(cut[2]![1] - 41.615) < 1e-6)
  assert.deepEqual(sliceLine(shape, 500, 400), [], 'backwards is nothing, not everything')
})
