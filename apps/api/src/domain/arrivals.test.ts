import assert from 'node:assert/strict'
import { test } from 'node:test'
import { minutesNowInBatumi, ratchet } from './arrivals.ts'

// Rule 1 of the estimate: it counts down, never up. The first version adopted
// small upward revisions raw and the number climbed a few seconds every poll.
test('a published arrival never moves later by a little, and only eases when it moves later by a lot', () => {
  const key = `test|${Math.random()}`
  const now = 1_000_000

  assert.equal(ratchet(key, now + 300_000, now), now + 300_000)

  // Ten seconds later: inside the deadband, so the number stays put.
  assert.equal(ratchet(key, now + 310_000, now + 5_000), now + 300_000)

  // A minute later: eased a quarter of the way, not jumped.
  assert.equal(ratchet(key, now + 360_000, now + 10_000), now + 315_000)

  // Sooner: taken at once. Good news never made anyone miss a bus.
  assert.equal(ratchet(key, now + 280_000, now + 15_000), now + 280_000)
})

// The timetable is "HH:MM" in Batumi and the function runs in UTC on Vercel.
test("the timetable clock is Batumi's, whatever the process thinks the time zone is", () => {
  // 20:00 UTC is midnight in Batumi — UTC+4, no daylight saving.
  assert.equal(minutesNowInBatumi(new Date('2026-09-11T20:00:00Z')), 0)
  assert.equal(minutesNowInBatumi(new Date('2026-09-11T03:30:00Z')), 7 * 60 + 30)
})
