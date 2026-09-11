import { computed, type ComputedRef, type Ref } from 'vue'
import type { Route, Stop } from '@/api/types'
import { useLocale } from '@/stores/locale'
import { useTransit } from '@/stores/transit'

export interface NearestEntry {
  stop: Stop
  metres: number
  /** Already localised — "320 м" / "1,4 км". */
  distanceLabel: string
  walkLabel: string
  routes: Route[]
}

/** Beyond this it is not "nearby" any more, it is a different trip. */
const MAX_METRES = 1200
const SHOWN = 12
/** A brisk walk. Deliberately not a routed time — Batumi has a river and a port. */
const METRES_PER_MINUTE = 80

export const metresBetween = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

/**
 * The stops around a point, nearest first. Extracted from the nearby page once a
 * third screen wanted the same list: three copies of a haversine and three
 * roundings of "320 м" would have drifted apart, and the map's sheet and the
 * nearby page disagreeing about the same stop's distance is worse than either
 * number being slightly off.
 */
export function useNearestStops(
  anchor: Ref<{ lat: number; lon: number } | null>,
  options?: { maxMetres?: number; limit?: number },
): { entries: ComputedRef<NearestEntry[]> } {
  const transit = useTransit()
  const locale = useLocale()

  const entries = computed<NearestEntry[]>(() => {
    const here = anchor.value
    if (!here) return []

    const maxMetres = options?.maxMetres ?? MAX_METRES
    const limit = options?.limit ?? SHOWN

    return transit.stops
      .map((stop) => ({ stop, metres: metresBetween(here, stop) }))
      .filter((entry) => entry.metres <= maxMetres)
      .sort((a, b) => a.metres - b.metres)
      .slice(0, limit)
      .map((entry) => ({
        stop: entry.stop,
        metres: entry.metres,
        distanceLabel:
          entry.metres < 1000
            ? `${Math.round(entry.metres / 10) * 10} ${locale.t('metresAway')}`
            : `${(entry.metres / 1000).toFixed(1)} ${locale.t('kilometresAway')}`,
        walkLabel: `${Math.max(1, Math.round(entry.metres / METRES_PER_MINUTE))} ${locale.t('walkMinutes')}`,
        routes: entry.stop.routeIds
          .map((id) => transit.routeById.get(id))
          .filter((route) => route !== undefined),
      }))
  })

  return { entries }
}
