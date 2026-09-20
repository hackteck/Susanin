/**
 * Which way the reader is facing, from what the browser's orientation events
 * report. Plain TypeScript with no DOM, like the planner, so `node --test` runs
 * it: a beam pointing the wrong way looks exactly as confident as a right one,
 * and nothing about it shows up in a screenshot.
 *
 * Every heading here is degrees clockwise from north as the phone reports it,
 * in [0, 360). That is magnetic north on both platforms, and it is passed
 * through: see docs/compass.md for why the declination correction came out.
 */

/** The fields of a `DeviceOrientationEvent` this reads, so the maths never sees the DOM. */
export interface OrientationReading {
  alpha: number | null
  beta: number | null
  gamma: number | null
  absolute: boolean
  /** WebKit only: magnetic heading of the device's top edge, in portrait. */
  webkitCompassHeading?: number | null
  /** WebKit only: ± degrees, and negative when iOS cannot determine a heading. */
  webkitCompassAccuracy?: number | null
}

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

export const normalise = (deg: number) => ((deg % 360) + 360) % 360

/** Shortest signed turn from one bearing to another, in (-180, 180]. */
export const shortestTurn = (from: number, to: number) => {
  const delta = normalise(to - from)
  return delta > 180 ? delta - 360 : delta
}

/**
 * Moves `from` towards `to` by `weight` of the way round the shorter side. A
 * plain average of 359° and 1° is 180°, which is the one answer that is wrong
 * in every way at once.
 */
export const easeBearing = (from: number, to: number, weight: number) =>
  normalise(from + shortestTurn(from, to) * weight)

/**
 * The magnetic heading of where the phone is pointed, from W3C Euler angles.
 *
 * `360 − alpha` is what most compass snippets use. It is right for a phone lying
 * flat and wrong for the way people hold one to look down a street: upright,
 * turning the phone about the vertical is split between alpha and gamma however
 * the platform's angle extraction happens to split it, so a heading read from
 * alpha alone misses gamma's share — 30° of it in the test. Nor is the top edge's
 * own heading the fix: upright it points at the sky, and a few degrees past
 * vertical it points behind the reader. So this builds the rotation matrix and
 * takes two axes — the top of the *screen*, which is what "ahead" means on a
 * phone held flat, and the back of the phone, which is where the camera and the
 * reader's eyes point when it is held up — each weighted by how level it is.
 * Whichever axis is near vertical, and therefore unstable, contributes almost
 * nothing.
 *
 * `screenAngle` is how far the screen is turned from the device's natural
 * orientation: in landscape the top of the screen is a side of the phone.
 *
 * Null when the pose names no direction, which takes a phone held overhead with
 * the screen facing down.
 */
export function facing(alpha: number, beta: number, gamma: number, screenAngle = 0): number | null {
  const [cA, sA] = [Math.cos(toRad(alpha)), Math.sin(toRad(alpha))]
  const [cB, sB] = [Math.cos(toRad(beta)), Math.sin(toRad(beta))]
  const [cG, sG] = [Math.cos(toRad(gamma)), Math.sin(toRad(gamma))]

  // R = Rz(alpha) · Rx(beta) · Ry(gamma), device frame to (east, north, up) —
  // the matrix the W3C spec defines the three angles by. Only the first two rows
  // are needed, because only the horizontal part of an axis names a heading.
  const east = [cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG]
  const north = [sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG]

  const [cS, sS] = [Math.cos(toRad(screenAngle)), Math.sin(toRad(screenAngle))]
  // The screen's top edge, in device coordinates: +y upright, +x when the phone
  // is turned a quarter anticlockwise.
  const topE = east[0]! * sS + east[1]! * cS
  const topN = north[0]! * sS + north[1]! * cS
  // Out of the back of the phone: −z.
  const backE = -east[2]!
  const backN = -north[2]!

  const topLevel = Math.hypot(topE, topN)
  const backLevel = Math.hypot(backE, backN)
  const e = topE * topLevel + backE * backLevel
  const n = topN * topLevel + backN * backLevel

  if (Math.hypot(e, n) < 0.2) return null
  return normalise(toDeg(Math.atan2(e, n)))
}

/**
 * The heading from one orientation event, or null when the event carries none.
 *
 * iOS never reports an absolute alpha — its frame starts wherever the phone was
 * — but it does report `webkitCompassHeading`, already tilt-compensated by
 * CoreLocation and relative to the device's top in portrait. Android's
 * `deviceorientationabsolute` (and Firefox's `deviceorientation`, which is
 * absolute there) carries all three angles referenced to magnetic north. A
 * relative event carries nothing usable: north in it is wherever the phone was
 * pointing when the page loaded.
 */
export function readHeading(reading: OrientationReading, screenAngle = 0): number | null {
  const compass = reading.webkitCompassHeading
  if (typeof compass === 'number' && Number.isFinite(compass)) {
    // A negative accuracy is iOS saying it has no heading, not a small error.
    if (typeof reading.webkitCompassAccuracy === 'number' && reading.webkitCompassAccuracy < 0) return null
    return normalise(compass + screenAngle)
  }

  const { alpha, beta, gamma } = reading
  if (!reading.absolute || alpha === null || beta === null || gamma === null) return null
  return facing(alpha, beta, gamma, screenAngle)
}
