export interface Point {
  lat: number
  lon: number
}

const EARTH_RADIUS_M = 6371000
const toRad = (deg: number) => (deg * Math.PI) / 180

export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Compass bearing a→b, degrees clockwise from north. */
export function bearingDegrees(a: Point, b: Point): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLon = toRad(b.lon - a.lon)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** Smallest angle between two bearings, 0-180. */
export function angleBetween(a: number, b: number): number {
  const delta = Math.abs(((a - b) % 360) + 360) % 360
  return delta > 180 ? 360 - delta : delta
}

/**
 * A route shape with each vertex's distance from the start precomputed.
 * Batumi sits at ~41.6°N where a degree of longitude is ~0.75 of a degree of
 * latitude, so the local plane is scaled rather than treated as square — the
 * two coordinates are numerically similar here, which hides the mistake.
 */
export interface MeasuredShape {
  points: Point[]
  /** Cumulative metres at each vertex; `at(-1)` is the total length. */
  cumulative: number[]
  length: number
  /** Metres per degree of longitude at this latitude. */
  lonScale: number
}

const METRES_PER_DEG_LAT = 111320

export function measureShape(points: Point[]): MeasuredShape {
  const cumulative: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + haversineMeters(points[i - 1]!, points[i]!))
  }
  const midLat = points.length ? points[Math.floor(points.length / 2)]!.lat : 41.64
  return {
    points,
    cumulative,
    length: cumulative.at(-1) ?? 0,
    lonScale: METRES_PER_DEG_LAT * Math.cos(toRad(midLat)),
  }
}

export interface Projection {
  /** Distance from the shape's start, in metres. */
  along: number
  /** How far the point sits off the shape, in metres. */
  offset: number
}

export interface ProjectOptions {
  /** Nudge the match towards a position we already expect it near. */
  preferAlong?: number
  /** Only consider the stretch of shape between these distances. */
  range?: { min: number; max: number }
}

/**
 * Nearest point on the shape, in local metres. The options exist because a
 * route's two directions run down the same streets, so an unconstrained match
 * lands on whichever pass of the polyline happens to be a metre closer —
 * `range` confines a vehicle to the leg it is actually running.
 */
export function projectOntoShape(
  shape: MeasuredShape,
  point: Point,
  options: ProjectOptions = {},
): Projection | null {
  if (shape.points.length < 2) return null

  const { preferAlong, range } = options

  let best: Projection | null = null
  let bestScore = Infinity

  for (let i = 1; i < shape.points.length; i++) {
    const a = shape.points[i - 1]!
    const b = shape.points[i]!

    // Local metres with `a` at the origin, so the segment is just (bx, by).
    const bx = (b.lon - a.lon) * shape.lonScale
    const by = (b.lat - a.lat) * METRES_PER_DEG_LAT
    const px = (point.lon - a.lon) * shape.lonScale
    const py = (point.lat - a.lat) * METRES_PER_DEG_LAT

    const segLenSq = bx ** 2 + by ** 2
    const t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq))

    const offset = Math.hypot(px - bx * t, py - by * t)
    const along = shape.cumulative[i - 1]! + t * (shape.cumulative[i]! - shape.cumulative[i - 1]!)
    if (range && (along < range.min || along > range.max)) continue

    // A 200 m weight means the expected position only decides between
    // candidates that fit about equally well geometrically.
    const score = preferAlong === undefined ? offset : offset + Math.abs(along - preferAlong) / 200
    if (score < bestScore) {
      bestScore = score
      best = { along, offset }
    }
  }

  return best
}

/**
 * Distance still to run from `from` to `to` along a shape that closes on
 * itself. Every Batumi route's polyline is the full round trip with its ends
 * meeting, so "forward" wraps and covers both directions with no special case.
 */
export function forwardDistance(shape: MeasuredShape, from: number, to: number): number {
  if (shape.length === 0) return 0
  const delta = to - from
  return delta >= 0 ? delta : delta + shape.length
}

/**
 * Which way the line is heading at a given distance along it. This is what
 * tells the two directions apart: they run down the same streets, so the only
 * thing separating them is that one goes north and the other goes south.
 */
export function bearingAtAlong(shape: MeasuredShape, along: number): number | null {
  if (shape.points.length < 2) return null

  for (let i = 1; i < shape.points.length; i++) {
    if (shape.cumulative[i]! >= along) return bearingDegrees(shape.points[i - 1]!, shape.points[i]!)
  }

  return bearingDegrees(shape.points.at(-2)!, shape.points.at(-1)!)
}

/** How much a candidate is penalised per metre it runs ahead of the last stop. */
const FORWARD_BIAS = 0.02
/** Slack for a stop that genuinely sits a little behind the previous one. */
const BACKTRACK_SLACK_M = 60

/**
 * Walk a route's stop chain along its shape, matching each stop to a position
 * at or after the one before it.
 *
 * Projecting each stop independently does not work here: a route's two
 * directions run down the same streets, so half the stops on the way back sit
 * closer to the outbound pass of the polyline than to their own. Sequential
 * matching removes the ambiguity by construction — measured, the independent
 * version put 29 of route 12's 33 outbound stops out of order.
 */
export function matchChain(shape: MeasuredShape, points: Point[]): { along: number; offset: number }[] {
  const matched: { along: number; offset: number }[] = []
  let previousAlong = 0

  for (const point of points) {
    let best: { along: number; offset: number } | null = null
    let bestScore = Infinity

    for (let i = 1; i < shape.points.length; i++) {
      const a = shape.points[i - 1]!
      const b = shape.points[i]!

      const bx = (b.lon - a.lon) * shape.lonScale
      const by = (b.lat - a.lat) * METRES_PER_DEG_LAT
      const px = (point.lon - a.lon) * shape.lonScale
      const py = (point.lat - a.lat) * METRES_PER_DEG_LAT

      const segLenSq = bx ** 2 + by ** 2
      const t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / segLenSq))
      const along = shape.cumulative[i - 1]! + t * (shape.cumulative[i]! - shape.cumulative[i - 1]!)
      if (along < previousAlong - BACKTRACK_SLACK_M) continue

      const offset = Math.hypot(px - bx * t, py - by * t)
      const score = offset + Math.max(0, along - previousAlong) * FORWARD_BIAS
      if (score < bestScore) {
        bestScore = score
        best = { along, offset }
      }
    }

    // Past the end of the shape there is nothing forward left to match against.
    const resolved = best ?? { along: previousAlong, offset: Infinity }
    matched.push(resolved)
    previousAlong = resolved.along
  }

  return matched
}

/** A polyline whose ends meet is a ring, and a ring can start anywhere. */
const isClosed = (points: Point[]) => haversineMeters(points[0]!, points.at(-1)!) < 100

/** Rotate a ring so it begins at the vertex nearest `target`. */
function rotateTo(points: Point[], target: Point): Point[] {
  const ring = points.slice(0, -1)
  if (ring.length < 2) return points

  let bestIndex = 0
  let bestDistance = Infinity
  ring.forEach((point, index) => {
    const distance = haversineMeters(point, target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  const rotated = [...ring.slice(bestIndex), ...ring.slice(0, bestIndex)]
  return [...rotated, rotated[0]!]
}

/**
 * Put a route's polyline into the same frame as its stop chain.
 *
 * Upstream stores the line without saying which way round it goes or where in
 * the cycle it starts, and gets both wrong on some routes. Two corrections are
 * needed and they are independent:
 *
 * - **Reversal.** Some lines are drawn against the direction of travel.
 * - **Rotation.** The ends of these polylines meet, so the stored start is
 *   arbitrary — and on route 12 it sat halfway round. Because `matchChain`
 *   walks forward only, the outbound leg then consumed the line to its very end
 *   and every inbound stop pinned to the last vertex, 7.4 km from where it
 *   belongs. Measured, not reasoned: the whole inbound leg had no line left to
 *   match against.
 *
 * Both are settled the same way — match the chain against each candidate and
 * keep the tightest fit — so neither needs a heuristic about what upstream
 * "usually" does.
 */
export function alignToChain(points: Point[], chain: Point[]): Point[] {
  if (points.length < 2 || chain.length < 2) return points

  const cost = (candidate: Point[]) => {
    const matched = matchChain(measureShape(candidate), chain)
    return matched.reduce((total, match) => total + Math.min(match.offset, 500), 0)
  }

  const orientations = [points, [...points].reverse()]
  const candidates = isClosed(points)
    ? [...orientations, ...orientations.map((candidate) => rotateTo(candidate, chain[0]!))]
    : orientations

  let best = points
  let bestCost = Infinity
  for (const candidate of candidates) {
    const candidateCost = cost(candidate)
    if (candidateCost < bestCost) {
      bestCost = candidateCost
      best = candidate
    }
  }

  return best
}
