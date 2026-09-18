import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DECLINATION_DEG, easeBearing, facing, readHeading, shortestTurn } from './compass.ts'

/** Degrees apart round the circle, so 359° and 1° are 2 apart rather than 358. */
const apart = (a: number, b: number) => Math.abs(shortestTurn(a, b))

const close = (actual: number | null, expected: number, tolerance = 0.01, message?: string) => {
  assert.ok(actual !== null, message ?? `expected ${expected}°, got null`)
  assert.ok(apart(actual, expected) <= tolerance, message ?? `expected ${expected}°, got ${actual}°`)
}

test('a phone lying flat faces where its top edge points', () => {
  // Alpha turns anticlockwise, so a top edge at alpha 90 points west.
  close(facing(0, 0, 0), 0)
  close(facing(90, 0, 0), 270)
  close(facing(180, 0, 0), 180)
  close(facing(270, 0, 0), 90)
})

test('a phone held upright faces where its camera points', () => {
  // Upright, the top edge points at the sky and names no direction at all.
  close(facing(0, 90, 0), 0)
  close(facing(90, 90, 0), 270)
})

test('tipping a phone past upright does not swing the beam round', () => {
  // Holding a phone up to look down a street routinely leans it a few degrees
  // past vertical, where the top edge's heading flips by 180°.
  for (let beta = 30; beta <= 120; beta += 5) close(facing(30, beta, 0), 330, 0.01, `beta ${beta}`)
})

test('the same upright pose spelt with two sets of angles gives one heading', () => {
  // At beta 90 alpha and gamma both turn the phone about the vertical, so the
  // split between them is arbitrary — and a heading read from alpha alone moves
  // by whatever share gamma happened to take.
  close(facing(0, 90, 30), facing(30, 90, 0)!)
  close(facing(0, 90, 30), 330)
})

test('a flat phone tilted onto its side still faces its top edge, near enough', () => {
  // Rolled 20°, the back of the phone points off to one side; it may pull the
  // beam a little, never most of the way.
  const rolled = facing(0, 0, 20)
  assert.ok(rolled !== null && apart(rolled, 0) < 8, `rolled 20° reads ${rolled}°`)
})

test('in landscape the top of the screen is a side of the phone', () => {
  close(facing(0, 0, 0, 90), 90)
  close(facing(0, 0, 0, 270), 270)
  close(facing(0, 0, 0, -90), 270, 0.01, 'window.orientation writes the clockwise turn as -90')
  // Upright on its side, camera north: the top edge points west and the screen
  // has turned with it.
  close(facing(90, 0, -90, 90), 0, 0.01, 'upright in landscape, it faces where the camera points')
})

test('a pose that names no direction is null, not north', () => {
  // Overhead, screen down, tipped so the top and the back cancel out.
  assert.equal(facing(0, 135, 0), null)
})

test('an absolute Android reading is turned from magnetic to true north', () => {
  close(readHeading({ alpha: 0, beta: 0, gamma: 0, absolute: true }), DECLINATION_DEG)
  close(readHeading({ alpha: 0, beta: 0, gamma: 0, absolute: true }, 90), 90 + DECLINATION_DEG)
})

test('a relative reading carries no heading', () => {
  // North in a relative frame is wherever the phone was when the page loaded.
  assert.equal(readHeading({ alpha: 0, beta: 0, gamma: 0, absolute: false }), null)
  assert.equal(readHeading({ alpha: null, beta: null, gamma: null, absolute: true }), null, 'no sensor')
})

test('an iOS reading uses the compass heading, turned for the screen and for true north', () => {
  // iOS alpha is relative and must be ignored; the compass heading is not.
  const ios = { alpha: 123, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 355, webkitCompassAccuracy: 10 }
  close(readHeading(ios), 355 + DECLINATION_DEG - 360)
  close(readHeading(ios, 90), 355 + 90 + DECLINATION_DEG - 360)
  assert.equal(readHeading({ ...ios, webkitCompassAccuracy: -1 }), null, 'iOS says it has no heading')
})

test('a bearing eases across north the short way', () => {
  assert.equal(shortestTurn(350, 10), 20)
  assert.equal(shortestTurn(10, 350), -20)
  close(easeBearing(350, 10, 0.5), 0)
  close(easeBearing(10, 350, 0.25), 5)
})
