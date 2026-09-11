import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useGeolocation, type GeoPermission, type Position } from '@/composables/useGeolocation'

/**
 * What a nearby list is measured from. A picked point and "me" are the same
 * question asked about two different places, so they are one type rather than
 * two parallel features — which is also what makes "go back to where I was"
 * a single affordance instead of two.
 */
export type Origin = { kind: 'me' } | { kind: 'point'; lat: number; lon: number }

/** Past this a fix is old enough that the reader should be told, not just shown. */
export const STALE_AFTER_MS = 60000

/**
 * Beyond this, a fix is too vague to sort stops by: the median gap between
 * adjacent Batumi stops is 27 m, so a ±300 m fix routinely names the pole across
 * the road — which is the opposite direction of travel.
 */
export const COARSE_ABOVE_M = 300

/**
 * Proximity is app-wide because four screens ask the same question about the
 * same fix. It used to be a page-local composable, and that single fact caused
 * three separate complaints: the dot vanished on navigation, /nearby demanded a
 * fresh tap every visit, and there was no "back" because there was no state to
 * go back to.
 */
export const useProximity = defineStore('proximity', () => {
  const geo = useGeolocation()

  const fix = ref<Position | null>(null)
  const permission = ref<GeoPermission>('unknown')
  const origin = ref<Origin | null>(null)
  /** Armed by the map-pick button; the next tap on the map answers it. */
  const pickMode = ref(false)
  /** The map's nearest-stop bar, put away for the session once waved off. */
  const nearestDismissed = ref(false)

  // The composable owns the browser call; the store owns the lifetime of what it
  // returns. Mirroring rather than re-exporting keeps a fix from being lost when
  // a later attempt fails — a stale position is still better than none, and the
  // UI says how old it is.
  const locating = geo.locating
  const denied = geo.denied

  // Latched rather than aliased: a failed retry must not erase the fix we already
  // have. A position with its age on display beats no position at all.
  watch(geo.position, (next) => {
    if (next) fix.value = next
  })

  /** A picked point wins over the fix: the reader asked about somewhere else. */
  const anchor = computed<{ lat: number; lon: number } | null>(() => {
    if (origin.value?.kind === 'point') return { lat: origin.value.lat, lon: origin.value.lon }
    return fix.value ? { lat: fix.value.lat, lon: fix.value.lon } : null
  })

  const coarse = computed(() => !!fix.value && fix.value.accuracy > COARSE_ABOVE_M)

  const locate = (options?: { silent?: boolean; highAccuracy?: boolean }) => {
    geo.locate(options)
  }

  /**
   * Probe permission and, only when it is already granted, take one quiet fix.
   * Never on `prompt`: a permission dialog nobody asked for, on page load, is
   * how an app teaches people to press Block.
   */
  const init = async () => {
    if (permission.value !== 'unknown') return
    permission.value = await geo.queryPermission()
    if (permission.value !== 'granted' || fix.value) return
    // Coarse on the boot fix — it is answered from the cached network position
    // in about a second, where a GPS lock would hold the page in "locating…".
    locate({ silent: true, highAccuracy: false })
  }

  let watchers = 0
  let stopWatch: (() => void) | undefined

  /** Ref-counted exactly like the vehicle poll: two pages must not race one watchId. */
  const watchPosition = () => {
    watchers++
    if (watchers === 1) stopWatch = geo.watch()

    return () => {
      watchers--
      if (watchers > 0) return
      stopWatch?.()
      stopWatch = undefined
    }
  }

  const useMyLocation = () => {
    origin.value = { kind: 'me' }
    if (!fix.value) locate()
  }

  const arm = () => {
    pickMode.value = true
  }

  const disarm = () => {
    pickMode.value = false
  }

  const pickAt = (lat: number, lon: number) => {
    origin.value = { kind: 'point', lat, lon }
    pickMode.value = false
  }

  const clearOrigin = () => {
    origin.value = null
  }

  const dismissNearest = () => {
    nearestDismissed.value = true
  }

  return {
    fix,
    locating,
    denied,
    permission,
    origin,
    pickMode,
    nearestDismissed,
    anchor,
    coarse,
    init,
    locate,
    watchPosition,
    useMyLocation,
    arm,
    disarm,
    pickAt,
    clearOrigin,
    dismissNearest,
  }
})
