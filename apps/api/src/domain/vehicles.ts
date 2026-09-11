import { fetchVehicles } from '../upstream/thetamaps.ts'
import { angleBetween, bearingAtAlong, bearingDegrees, haversineMeters, projectOntoShape } from './geo.ts'
import { getNetwork, type Network } from './network.ts'
import type { Direction, Vehicle } from './model.ts'

interface Track {
  lat: number
  lon: number
  /** When the bus was last somewhere new. */
  movedAt: number
  /** When we last got any sample at all — a parked bus is still reporting. */
  seenAt: number
  firstSeenAt: number
  heading: number | null
  speedKmh: number | null
  /** Last direction we were confident about; carried while a bus is stopped. */
  direction: Direction | null
}

// Upstream sends a bare {Lat, Lon, Status, Name} — no heading, no speed, no
// timestamp. All three come from watching a plate move between samples, so the
// process has to remember where it last saw one.
const tracks = new Map<string, Track>()

/** Below this, a change is GPS noise rather than the bus going somewhere. */
const MOVED_METERS = 12
const MAX_PLAUSIBLE_KMH = 90
const TRACK_TTL_MS = 60 * 60 * 1000
/** Not moved for this long and it is parked, laying over, or done for the day. */
const STALE_MS = 10 * 60 * 1000
/** A bus we have only just met has not had a chance to prove it moves. */
const GRACE_MS = 2 * 60 * 1000
/** Speed halves every minute a bus stands still, instead of standing at its last value. */
const SPEED_HALF_LIFE_MS = 60_000
/** Further off the line than this and the plate is not running this route. */
const MAX_OFFSET_M = 250
/** A shape bearing this far from the bus's own is the other direction's pass. */
const MAX_BEARING_DELTA = 70

const prune = (now: number) => {
  for (const [id, track] of tracks) {
    if (now - track.seenAt > TRACK_TTL_MS) tracks.delete(id)
  }
}

/**
 * Which way round the route a bus is going.
 *
 * Upstream's own `Status` field says 1 or 2 — but measured across the whole
 * fleet, **90% of vehicles report -1**, which is no answer at all. Treating
 * that as "outbound" (which is what reading it as a number does) puts nine
 * buses in ten on the wrong leg, and the arrival board then has nothing to
 * offer anyone travelling the other way.
 *
 * So the geometry decides instead: project onto each direction's stretch of the
 * shape and keep whichever one is both close and pointing the same way the bus
 * is. A bus with no heading yet has no answer here, and that is the honest
 * result — it is also a bus that is not moving, so it predicts nothing.
 */
function inferDirection(network: Network, routeId: string, track: Track): Direction | null {
  const shape = network.shapes.get(routeId)
  const bands = network.bands.get(routeId)
  if (!shape || !bands || track.heading === null) return null

  let best: { direction: Direction; score: number; delta: number } | null = null

  for (const [direction, band] of bands) {
    const projection = projectOntoShape(shape, track, {
      range: { min: band.min - 400, max: band.max + 400 },
    })
    if (!projection || projection.offset > MAX_OFFSET_M) continue

    const lineBearing = bearingAtAlong(shape, projection.along)
    if (lineBearing === null) continue

    const delta = angleBetween(lineBearing, track.heading)
    // Offset breaks ties between two passes that both point the right way.
    const score = delta + projection.offset / 10
    if (!best || score < best.score) best = { direction, score, delta }
  }

  return best && best.delta <= MAX_BEARING_DELTA ? best.direction : null
}

/** Exported for its test; nothing outside this module calls it. */
export const observe = (id: string, lat: number, lon: number, now: number): Track => {
  const previous = tracks.get(id)

  if (!previous) {
    const fresh: Track = {
      lat,
      lon,
      movedAt: now,
      seenAt: now,
      firstSeenAt: now,
      heading: null,
      speedKmh: null,
      direction: null,
    }
    tracks.set(id, fresh)
    return fresh
  }

  const sinceLastSample = now - previous.seenAt
  previous.seenAt = now
  const moved = haversineMeters(previous, { lat, lon })

  // A repeated sample is the norm: positions are cached for 4s and clients poll
  // faster than the fleet reports. Keep the last real heading rather than
  // dropping it every other request — but let the speed decay, because a bus
  // that has stopped should not keep advertising the speed it had before it did.
  //
  // Decayed by the time since the *last sample*, not since the bus stopped. This
  // runs once per request, so one standstill is observed many times over, and
  // applying the whole standing time on each of them compounded: a bus at a red
  // light read as stopped dead inside thirty seconds instead of halving per
  // minute, and wore the ≈ mark for it. Per-interval factors multiply out to
  // the same half-life however many callers there are.
  if (moved < MOVED_METERS) {
    if (previous.speedKmh !== null) {
      previous.speedKmh = previous.speedKmh * Math.pow(0.5, sinceLastSample / SPEED_HALF_LIFE_MS)
    }
    return previous
  }

  const seconds = Math.max(1, (now - previous.movedAt) / 1000)
  const kmh = Math.min(MAX_PLAUSIBLE_KMH, (moved / seconds) * 3.6)

  previous.heading = bearingDegrees(previous, { lat, lon })
  // Smoothed: a single sample straddling a red light reads as a standstill.
  previous.speedKmh = previous.speedKmh === null ? kmh : previous.speedKmh * 0.6 + kmh * 0.4
  previous.lat = lat
  previous.lon = lon
  previous.movedAt = now

  return previous
}

/**
 * Live vehicles for the given routes. Upstream has no all-routes endpoint, so
 * "everything" is a fan-out — which is exactly why it goes through the cache:
 * concurrent viewers of the same route share one upstream request.
 */
export async function getVehicles(routeIds: string[]): Promise<Vehicle[]> {
  const network = await getNetwork()
  const now = Date.now()
  prune(now)

  const perRoute = await Promise.all(
    routeIds.map(async (routeId) => {
      const route = network.routes.get(routeId)
      if (!route) return []

      const raw = await fetchVehicles(routeId)

      return raw
        .filter((vehicle) => Number.isFinite(vehicle.Lat) && Number.isFinite(vehicle.Lon))
        .map((vehicle): Vehicle => {
          const id = vehicle.Name?.trim() || `${routeId}:${vehicle.Lat},${vehicle.Lon}`
          const track = observe(id, vehicle.Lat, vehicle.Lon, now)

          // Upstream's answer when it has one; ours when it doesn't. A bus that
          // stops keeps the direction it was last going, which is what a bus
          // waiting at a light is actually doing.
          const reported = vehicle.Status === 1 || vehicle.Status === 2 ? (vehicle.Status as Direction) : null
          track.direction = reported ?? inferDirection(network, routeId, track) ?? track.direction

          const standingFor = now - track.movedAt
          const inService = standingFor < STALE_MS || now - track.firstSeenAt < GRACE_MS

          return {
            id,
            routeId,
            shortName: route.shortName,
            hue: route.hue,
            lat: track.lat,
            lon: track.lon,
            direction: track.direction,
            // 0-360 rather than the ±180 the bearing maths produces: a compass
            // reading is what the client rotates a marker by.
            heading: track.heading === null ? null : (Math.round(track.heading) + 360) % 360,
            speedKmh: track.speedKmh === null ? null : Math.round(track.speedKmh),
            inService,
            /** Seconds it has been standing still — what makes an estimate soft. */
            standingSeconds: Math.round(standingFor / 1000),
            seenAt: new Date(track.seenAt).toISOString(),
            movedAt: new Date(track.movedAt).toISOString(),
          }
        })
    }),
  )

  return perRoute.flat()
}
