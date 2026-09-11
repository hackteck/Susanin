import { ref } from 'vue'
import { useToasts } from '@/stores/toasts'
import { useLocale } from '@/stores/locale'

export interface Position {
  lat: number
  lon: number
}

/**
 * A one-shot fix, asked for by a button press. Deliberately not a watch: a
 * transit map is consulted, not navigated by, and a permanent GPS subscription
 * is a battery cost for something the reader looks at twice.
 */
export function useGeolocation() {
  const position = ref<Position | null>(null)
  const locating = ref(false)
  /** Refused or unavailable — a page can then explain instead of just doing nothing. */
  const denied = ref(false)

  const toasts = useToasts()
  const locale = useLocale()

  const fail = () => {
    locating.value = false
    denied.value = true
    toasts.push({ title: locale.t('locationDenied'), variant: 'destructive' })
  }

  const locate = () => {
    if (!navigator.geolocation) {
      fail()
      return
    }

    locating.value = true
    denied.value = false
    navigator.geolocation.getCurrentPosition(
      (fix) => {
        position.value = { lat: fix.coords.latitude, lon: fix.coords.longitude }
        locating.value = false
      },
      fail,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  }

  return { position, locating, denied, locate }
}
