import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { api } from '@/api/client'
import type { Arrival } from '@/api/types'

/** Arrivals are recomputed from live positions, so they go stale as fast as those. */
const POLL_MS = 10000

/**
 * Keeps one stop's arrival board fresh. Follows the ref it is given, so a page
 * that switches stops does not have to tear anything down.
 */
export function useArrivals(stopId: Ref<string | null>) {
  const arrivals = ref<Arrival[]>([])
  const loading = ref(false)
  const failed = ref(false)

  let timer: number | undefined
  let inFlight: AbortController | undefined

  const stop = () => {
    window.clearInterval(timer)
    timer = undefined
    inFlight?.abort()
    inFlight = undefined
  }

  const load = async (id: string, showSpinner: boolean) => {
    // A poll that overtakes the previous one would leave two answers racing to
    // land, and the older one can win.
    inFlight?.abort()
    inFlight = new AbortController()

    if (showSpinner) loading.value = true
    try {
      arrivals.value = await api.arrivals(id, inFlight.signal)
      failed.value = false
    } catch (error) {
      if ((error as Error).name !== 'AbortError') failed.value = true
    } finally {
      if (showSpinner) loading.value = false
    }
  }

  watch(
    stopId,
    (id) => {
      stop()
      arrivals.value = []
      if (!id) return

      void load(id, true)
      timer = window.setInterval(() => void load(id, false), POLL_MS)
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { arrivals, loading, failed }
}
