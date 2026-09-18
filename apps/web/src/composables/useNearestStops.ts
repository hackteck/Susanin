import { computed, type ComputedRef, type Ref } from 'vue'
import type { Route, Stop } from '@/api/types'
import { useJourneyFormat, wholeMinutes } from '@/composables/useJourneyFormat'
import { metresBetween } from '@/planner/geo'
import { ACCESS_MAX_METRES } from '@/planner/plan'
import { walkingMinutes } from '@/planner/walking'
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

/**
 * Beyond this it is not "nearby" any more, it is a different trip — the same
 * radius the journey planner walks to a stop from, so the two agree on what
 * "near" means.
 */
const MAX_METRES = ACCESS_MAX_METRES
const SHOWN = 12

/**
 * The stops around a point, nearest first. Extracted once a third screen wanted
 * the same list: three copies of a haversine and three roundings of "320 м"
 * would have drifted apart, and two screens disagreeing about the same stop's
 * distance is worse than either number being slightly off. The walk time is the
 * journey planner's own model (planner/walking.ts), for the same reason: this
 * list and a planned trip must not give the same walk two different times.
 */
export function useNearestStops(
  anchor: Ref<{ lat: number; lon: number } | null>,
  options?: { maxMetres?: number; limit?: number },
): { entries: ComputedRef<NearestEntry[]> } {
  const transit = useTransit()
  const locale = useLocale()
  const format = useJourneyFormat()

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
        distanceLabel: format.distance(entry.metres),
        walkLabel: `${wholeMinutes(walkingMinutes(entry.metres))} ${locale.t('walkMinutes')}`,
        routes: entry.stop.routeIds
          .map((id) => transit.routeById.get(id))
          .filter((route) => route !== undefined),
      }))
  })

  return { entries }
}
