import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useGeolocation, type GeoPermission, type Position } from '@/composables/useGeolocation'
import { useOnboarding } from '@/stores/onboarding'

/**
 * Where a stop was chosen from, when that was the list of stops near the reader.
 * It is what the stop page's back row is derived from, rather than history, so a
 * reloaded or shared link behaves like a tap. A point picked on the map used to
 * be the second kind; picking now answers the journey planner instead, which
 * keeps its own ends.
 */
export type Origin = { kind: 'me' }

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
  const onboarding = useOnboarding()

  const fix = ref<Position | null>(null)
  const permission = ref<GeoPermission>('unknown')
  const origin = ref<Origin | null>(null)

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

  const anchor = computed<{ lat: number; lon: number } | null>(() =>
    fix.value ? { lat: fix.value.lat, lon: fix.value.lon } : null,
  )

  const coarse = computed(() => !!fix.value && fix.value.accuracy > COARSE_ABOVE_M)

  const locate = (options?: { silent?: boolean; highAccuracy?: boolean }) => {
    geo.locate(options)
  }

  /**
   * Whether the app may ask the browser where the reader is, unprompted.
   *
   * Two conditions, and both are about not interrupting. The reader has already
   * said yes — `granted` is the plain answer, and a fix in hand is the other
   * one, the only yes Safari ever gives us, since it will not report geolocation
   * permission at all but hands over coordinates only after one. And the first
   * visit has finished talking: while the offer or the tour is up, the reader is
   * being shown the app rather than using it, and nothing goes looking for them.
   *
   * A press of the locate control is not covered by any of this. That is the
   * reader asking, and it is the only thing allowed to raise the dialog.
   */
  const mayLocate = computed(
    () => !onboarding.talking && (permission.value === 'granted' || !!fix.value),
  )

  /** Probed once, and the quiet fix taken once, however many pages ask. */
  let probed = false
  let booted = false

  const bootFix = () => {
    // Never on `prompt`: a permission dialog nobody asked for, on page load, is
    // how an app teaches people to press Block.
    if (booted || fix.value || !mayLocate.value) return
    booted = true
    // Coarse on the boot fix — it is answered from the cached network position
    // in about a second, where a GPS lock would hold the page in "locating…".
    locate({ silent: true, highAccuracy: false })
  }

  /**
   * Probe permission — `permissions.query` asks the browser, not the reader —
   * and take the quiet fix that a yes already given has earned.
   */
  const init = async () => {
    if (!probed) {
      probed = true
      permission.value = await geo.queryPermission()
    }
    bootFix()
  }

  // Held rather than dropped: the offer and the tour both end on the map, which
  // is where that fix was wanted in the first place.
  watch(mayLocate, (may) => {
    if (may) bootFix()
  })

  let watchers = 0
  let stopWatch: (() => void) | undefined
  let stopGate: (() => void) | undefined

  /**
   * Ref-counted exactly like the vehicle poll: two pages must not race one
   * watchId — and held behind `mayLocate`, because `watchPosition` raises the
   * permission dialog exactly as `getCurrentPosition` does. Starting one with
   * the map put that dialog on screen unasked, on a first visit, on top of the
   * welcome offer: a question about a control the reader had not been shown
   * yet, and the answer to that is Block. A watch follows a yes, it never asks
   * for one — the locate control does the asking, and this starts itself the
   * moment the fix that press returns lands.
   */
  const watchPosition = () => {
    watchers++
    if (watchers === 1) {
      stopGate = watch(
        mayLocate,
        (yes) => {
          if (yes === !!stopWatch) return
          if (yes) stopWatch = geo.watch()
          else {
            stopWatch?.()
            stopWatch = undefined
          }
        },
        { immediate: true },
      )
    }

    return () => {
      watchers--
      if (watchers > 0) return
      stopGate?.()
      stopGate = undefined
      stopWatch?.()
      stopWatch = undefined
    }
  }

  const useMyLocation = () => {
    origin.value = { kind: 'me' }
    if (!fix.value) locate()
  }

  const clearOrigin = () => {
    origin.value = null
  }

  return {
    fix,
    locating,
    denied,
    permission,
    origin,
    anchor,
    coarse,
    init,
    locate,
    watchPosition,
    useMyLocation,
    clearOrigin,
  }
})
