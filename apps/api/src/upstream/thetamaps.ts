import { config } from '../config.ts'
import { cache } from '../lib/cache.ts'
import { getJson } from '../lib/http.ts'

// The upstream shapes, verbatim. PascalCase and the `GeoGps` suffixes are
// theirs — nothing outside this folder should ever see them.

export interface RawStopRoute {
  /** 1 = outbound, 2 = inbound. */
  Status: number
  /** Position along the route, counted across BOTH directions in one sequence. */
  Order: number
  /** The day's scheduled departures from this stop, "HH:MM". */
  times?: string[]
}

export interface RawStop {
  BusStopIdGeoGps: string
  BusStopNameGeoGps: string
  BusStopNumber: number
  BusStopNameKA: string
  BusStopNameEN: string
  BusStopLatitude: number
  BusStopLongitude: number
  routes?: Record<string, RawStopRoute>
}

export interface RawRoute {
  RouteIdGeoGps: string
  RouteNameGeoGps: string
  RouteNameKA: string
  RouteNameEN: string
  RouteIsCircle: boolean
  RouteSortOrder: number
}

export interface RawDataset {
  data: {
    busStops: Record<string, RawStop>
    routesNames: Record<string, RawRoute>
    routeCoordinatesGrouped: Record<string, { lat: number; lon: number }[]>
    routeStatusInfo: Record<string, Record<string, { lowestId: string; highestId: string }>>
  }
}

export interface RawVehicle {
  Lat: number
  Lon: number
  /** 1 = outbound, 2 = inbound. */
  Status: number
  /** Licence plate — stable, and the only vehicle identity there is. */
  Name: string
}

const datasetKey = 'upstream:dataset'
const vehiclesKey = (routeId: string) => `upstream:vehicles:${routeId}`

/**
 * The whole static network: stops, routes, timetables, shapes. 1.27 MB and
 * served uncompressed, so it is fetched at most once per TTL for the whole
 * process and every caller shares that one copy.
 */
export function fetchDataset(): Promise<RawDataset> {
  return cache.wrap(datasetKey, config.datasetTtlMs, async () => {
    try {
      return await getJson<RawDataset>(`${config.upstreamBase}/api/getDbData`)
    } catch (error) {
      // A stale network beats no network: stops and shapes barely change, and
      // the alternative is a blank map because one upstream request timed out.
      const stale = cache.stale<RawDataset>(datasetKey)
      if (stale) return stale
      throw error
    }
  })
}

/** Live positions for one route. Upstream has no all-routes endpoint. */
export function fetchVehicles(routeId: string): Promise<RawVehicle[]> {
  return cache.wrap(vehiclesKey(routeId), config.vehiclesTtlMs, async () => {
    const body = await getJson<{ data: RawVehicle[] | null }>(
      `${config.upstreamBase}/api/getBusLocsOnRoute?routeId=${encodeURIComponent(routeId)}`,
    )
    // An unknown routeId answers 200 with `data: null` rather than a 404.
    return body.data ?? []
  })
}
