import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatMinutes, inferTrips, MAX_HOP_KMH, repairRunningTimes, typicalSpeedKmh } from './schedule.ts'

test('the k-th time at each stop is the k-th trip', () => {
  // Upstream sends each stop its own list; nothing says which times go together.
  const patterns = inferTrips([
    ['07:10', '07:00'],
    ['07:03', '07:13'],
    ['07:20', '07:10'],
  ])

  assert.deepEqual(patterns, [{ offsets: [0, 3, 10], departures: [420, 430] }])
})

test('lists that do not line up into trips are refused, not guessed at', () => {
  assert.equal(inferTrips([['07:00', '07:10'], ['07:05']]), null, 'a stop missing a trip')
  assert.equal(inferTrips([['07:00'], ['06:55']]), null, 'a trip that runs backwards')
  assert.deepEqual(inferTrips([[], []]), null, 'nothing to line up')
})

test('trips with different running times become separate patterns', () => {
  const patterns = inferTrips([
    ['07:00', '08:00'],
    ['07:05', '08:10'],
  ])

  assert.equal(patterns?.length, 2)
})

test('a pattern with no intermediate times is re-derived from distance', () => {
  // Route 8 inbound, in miniature: 13.8 km published as three minutes.
  const along = [0, 4600, 9200, 13800]
  const repaired = repairRunningTimes([0, 1, 2, 3], along, 20)

  // 20 km/h is 333 m a minute.
  assert.deepEqual(repaired.offsets, [0, 14, 28, 41])
  assert.deepEqual(repaired.estimated, [false, true, true, true], 'the first stop is never ours')
})

test('an impossible hop is pushed later, and only as far as it has to go', () => {
  // 9 km in 4 minutes is 135 km/h; the hop cap allows 60, less the rounding
  // slack. The whole direction still averages 33 km/h, so only the hop is wrong.
  const repaired = repairRunningTimes([0, 2, 6, 20], [0, 1000, 10000, 11000], 20)

  const hopMinutes = 9000 / ((MAX_HOP_KMH * 1000) / 60)
  assert.equal(repaired.offsets[2], Math.ceil(2 + hopMinutes - 2))
  assert.equal(repaired.offsets[0], 0)
  assert.equal(repaired.offsets[1], 2, 'a plausible time before the fault is left alone')
  assert.equal(repaired.offsets[3], 20, 'and so is one after it')
  assert.deepEqual(repaired.estimated, [false, false, true, false])
})

test('a plausible pattern keeps its published minutes exactly', () => {
  // 1 km a minute is only 60 km/h at face value, and whole minutes at both ends
  // of a hop can hide two. Rounding is not a fault.
  const offsets = [0, 1, 2, 5, 9]
  const repaired = repairRunningTimes(offsets, [0, 900, 1900, 3000, 4200], 20)

  assert.deepEqual(repaired.offsets, offsets)
  assert.ok(repaired.estimated.every((flag) => !flag))
})

test('a run of zero-minute hops is judged together, not one at a time', () => {
  // Each 800 m hop fits in the rounding slack on its own; five of them do not.
  const along = [0, 800, 1600, 2400, 3200, 4000]
  const repaired = repairRunningTimes([0, 0, 0, 0, 0, 0], along, 20)

  assert.ok(repaired.offsets.at(-1)! >= 2, `4 km in ${repaired.offsets.at(-1)} min`)
})

test('the typical speed ignores the patterns it exists to repair', () => {
  const kmh = typicalSpeedKmh([
    { offsets: [0, 30], along: [0, 10000] },
    { offsets: [0, 40], along: [0, 12000] },
    { offsets: [0, 3], along: [0, 13800] },
  ])

  assert.ok(kmh >= 18 && kmh <= 20, `${kmh} km/h`)
})

test('minutes format back to the timetable\'s own clock', () => {
  assert.equal(formatMinutes(0), '00:00')
  assert.equal(formatMinutes(7 * 60 + 5), '07:05')
  assert.equal(formatMinutes(1440 + 13), '00:13', 'past midnight wraps')
})
