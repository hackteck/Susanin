import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  angleBetween,
  bearingAtAlong,
  bearingDegrees,
  haversineMeters,
  matchChain,
  measureShape,
  alignToChain,
  projectOntoShape,
  type Point,
} from './geo.ts'

const at = (lat: number, lon: number): Point => ({ lat, lon })

/**
 * A route as Batumi actually stores one: out along a street to a terminal and
 * back down the same street, as a single polyline. Both directions therefore
 * lie on identical geometry, which is the whole difficulty.
 */
const OUT_AND_BACK = [
  at(41.6, 41.6),
  at(41.605, 41.6),
  at(41.61, 41.6),
  at(41.615, 41.6),
  at(41.62, 41.6),
  at(41.615, 41.6),
  at(41.61, 41.6),
  at(41.605, 41.6),
  at(41.6, 41.6),
]

/** Stops in travel order: four going up, then the same four coming back. */
const CHAIN = [
  at(41.602, 41.6),
  at(41.607, 41.6),
  at(41.612, 41.6),
  at(41.618, 41.6),
  at(41.618, 41.6),
  at(41.612, 41.6),
  at(41.607, 41.6),
  at(41.602, 41.6),
]

test('haversine measures a degree of latitude', () => {
  // 0.01° of latitude is ~1111 m anywhere on Earth.
  assert.ok(Math.abs(haversineMeters(at(41.6, 41.6), at(41.61, 41.6)) - 1111) < 5)
})

test('bearing reads as a compass', () => {
  assert.ok(Math.abs(bearingDegrees(at(41.6, 41.6), at(41.61, 41.6))) < 0.5) // north
  assert.ok(Math.abs(bearingDegrees(at(41.6, 41.6), at(41.6, 41.61)) - 90) < 0.5) // east
})

test('angleBetween takes the short way round', () => {
  assert.equal(angleBetween(350, 10), 20)
  assert.equal(angleBetween(10, 350), 20)
  assert.equal(angleBetween(0, 180), 180)
  assert.equal(angleBetween(-10, 10), 20)
})

test('projection reports how far off the line a point sits', () => {
  const shape = measureShape([at(41.6, 41.6), at(41.62, 41.6)])
  // 0.001° of longitude at this latitude is ~83 m.
  const projection = projectOntoShape(shape, at(41.61, 41.601))

  assert.ok(projection)
  assert.ok(Math.abs(projection.offset - 83) < 5, `offset ${projection.offset}`)
  assert.ok(Math.abs(projection.along - 1111) < 10, `along ${projection.along}`)
})

test('a range confines a match to one direction of travel', () => {
  const shape = measureShape(OUT_AND_BACK)
  const halfway = shape.length / 2
  const point = at(41.61, 41.6)

  // Unconstrained, an out-and-back shape matches the outbound pass — the two
  // are geometrically identical, so nothing else could decide it.
  const free = projectOntoShape(shape, point)
  assert.ok(free && free.along < halfway)

  // Told which leg the bus is on, it matches there instead.
  const constrained = projectOntoShape(shape, point, { range: { min: halfway, max: shape.length } })
  assert.ok(constrained && constrained.along > halfway)
})

test('matchChain keeps a stop chain in order down an out-and-back shape', () => {
  const shape = measureShape(OUT_AND_BACK)
  const matched = matchChain(shape, CHAIN)

  for (let i = 1; i < matched.length; i++) {
    assert.ok(
      matched[i]!.along >= matched[i - 1]!.along,
      `stop ${i} matched behind stop ${i - 1}: ${matched[i]!.along} < ${matched[i - 1]!.along}`,
    )
  }

  // And it genuinely used both halves rather than piling everything onto the
  // outbound pass, which is what independent per-stop projection does.
  assert.ok(matched.at(-1)!.along > shape.length / 2)
})

test('alignToChain flips a polyline drawn against the direction of travel', () => {
  // An asymmetric path, so the two orientations are actually distinguishable.
  const path = [at(41.6, 41.6), at(41.61, 41.6), at(41.61, 41.62)]
  const chain = [at(41.601, 41.6), at(41.609, 41.6), at(41.61, 41.619)]

  assert.deepEqual(alignToChain(path, chain), path)
  assert.deepEqual(alignToChain([...path].reverse(), chain), path)
})

test('bearingAtAlong reports which way the line is heading there', () => {
  const shape = measureShape([at(41.6, 41.6), at(41.62, 41.6), at(41.62, 41.62)])

  const north = bearingAtAlong(shape, 100)
  const east = bearingAtAlong(shape, shape.length - 100)

  assert.ok(north !== null && Math.abs(north) < 1, `north ${north}`)
  assert.ok(east !== null && Math.abs(east - 90) < 1, `east ${east}`)
})

test('a shape with fewer than two points has nothing to project onto', () => {
  assert.equal(projectOntoShape(measureShape([at(41.6, 41.6)]), at(41.6, 41.6)), null)
  assert.equal(bearingAtAlong(measureShape([]), 0), null)
})
