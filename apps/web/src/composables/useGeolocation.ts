import { onScopeDispose, ref } from 'vue'
import { useToasts } from '@/stores/toasts'
import { useLocale } from '@/stores/locale'

export interface Position {
  lat: number
  lon: number
  /** Metres, 95% confidence. The halo and the "approximate" treatment read this. */
  accuracy: number
  /** When the fix landed, so staleness is a fact rather than an assumption. */
  at: number
}

/** What the browser will say before we ask — `unknown` when it refuses to say. */
export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown'

export interface LocateOptions {
  /** An automatic fix must never raise a toast: nobody asked for it. */
  silent?: boolean
  highAccuracy?: boolean
}

/**
 * The browser-facing primitive. One caller only — `stores/proximity.ts` — because
 * two pages each holding their own instance is what threw a fix away on every
 * navigation.
 *
 * A one-shot fix was the original deliberate choice, and it is still right for a
 * timetable. It is wrong for the map, where the dot is a live claim rendered
 * beside a live bus and the decision it supports is made while walking — so
 * `watch` exists too, and pays for itself by running only while a map is on
 * screen and the tab is visible.
 */
export function useGeolocation() {
  const position = ref<Position | null>(null)
  const locating = ref(false)
  /** Refused, specifically — not "timed out", which a page must not treat the same. */
  const denied = ref(false)

  const toasts = useToasts()
  const locale = useLocale()

  const read = (fix: GeolocationPosition): Position => ({
    lat: fix.coords.latitude,
    lon: fix.coords.longitude,
    // Absent only in exotic implementations; 0 would claim perfect precision,
    // so an unknown accuracy is reported as unknown-but-poor rather than perfect.
    accuracy: Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : Number.POSITIVE_INFINITY,
    at: fix.timestamp || Date.now(),
  })

  // The three error codes are three different situations and only one of them is
  // the user's doing. Collapsing them into "location unavailable" told a reader
  // in a tunnel that they had refused permission.
  const message = (error: GeolocationPositionError) => {
    if (error.code === error.PERMISSION_DENIED) return locale.t('locationDenied')
    if (error.code === error.TIMEOUT) return locale.t('locationTimeout')
    return locale.t('locationUnavailable')
  }

  const fail = (error: GeolocationPositionError | null, options?: LocateOptions) => {
    locating.value = false
    // Only a real refusal latches `denied`. A timeout must leave the button
    // offering another go rather than saying the reader said no.
    if (!error || error.code === error.PERMISSION_DENIED) denied.value = true
    if (options?.silent) return

    toasts.push({
      title: error ? message(error) : locale.t('locationUnavailable'),
      variant: 'destructive',
      // surstromming's own rule: an error toast must not vanish before it is read.
      duration: 0,
    })
  }

  const locate = (options?: LocateOptions) => {
    if (!navigator.geolocation) {
      fail(null, options)
      return
    }

    locating.value = true
    denied.value = false
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        position.value = read(fix)
        locating.value = false
      },
      (error) => fail(error, options),
      {
        enableHighAccuracy: options?.highAccuracy ?? true,
        // A cold GPS fix on a street routinely takes longer than ten seconds, and
        // the old budget turned an ordinary first press into an error message.
        timeout: 20000,
        maximumAge: 30000,
      },
    )
  }

  /**
   * Continuous position, paused while the tab is hidden — the same discipline the
   * vehicle poll already applies, and for the same reason: nothing the reader
   * cannot see is worth a radio.
   */
  const watch = (options?: LocateOptions) => {
    let id: number | undefined

    const start = () => {
      if (id !== undefined || !navigator.geolocation) return
      id = navigator.geolocation.watchPosition(
        (fix) => {
          position.value = read(fix)
          locating.value = false
        },
        // A watch that fails is not worth a toast on every sample; the map's
        // stale treatment is what tells the reader the dot has stopped moving.
        (error) => fail(error, { ...options, silent: true }),
        { enableHighAccuracy: options?.highAccuracy ?? true, timeout: 20000, maximumAge: 5000 },
      )
    }

    const stop = () => {
      if (id === undefined) return
      navigator.geolocation.clearWatch(id)
      id = undefined
    }

    const onVisibility = () => (document.hidden ? stop() : start())

    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }

  /**
   * Guarded three ways because every one of them has bitten a real browser:
   * Permissions may be absent, `query` may reject on an unsupported name, and
   * older WebKit resolves with a status object it then never updates. `unknown`
   * is the honest answer and callers must treat it as "do not act automatically".
   */
  const queryPermission = async (): Promise<GeoPermission> => {
    if (!navigator.permissions?.query) return 'unknown'
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' })
      return status.state
    } catch {
      return 'unknown'
    }
  }

  onScopeDispose(() => {
    locating.value = false
  })

  return { position, locating, denied, locate, watch, queryPermission }
}
