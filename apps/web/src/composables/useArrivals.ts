import { onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { api } from '@/api/client'
import type { Arrival, Direction } from '@/api/types'

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

/** The soonest bus of any of these lines at a stop, as the live feed sees it. */
export interface NextBus {
  routeId: string
  arrivesAt: string
  confidence: 'live' | 'slow'
}

export const nextBus = (arrivals: Arrival[], lines: { routeId: string; direction: Direction }[]): NextBus | null => {
  let soonest: NextBus | null = null
  for (const arrival of arrivals) {
    if (!arrival.estimate) continue
    if (!lines.some((line) => line.routeId === arrival.routeId && line.direction === arrival.direction)) continue
    if (!soonest || Date.parse(arrival.estimate.arrivesAt) < Date.parse(soonest.arrivesAt)) {
      soonest = { routeId: arrival.routeId, arrivesAt: arrival.estimate.arrivesAt, confidence: arrival.estimate.confidence }
    }
  }
  return soonest
}

/**
 * The boards of the few stops a list of trip options gets on at, polled
 * together: the options and the step list then read one set of numbers, and a
 * stop two options share is asked about once. A stop whose answer has not come,
 * or could not, is simply absent — "not known" is not "no bus".
 */
export function useArrivalsAt(stopIds: Ref<string[]>) {
  const boards = shallowRef(new Map<string, Arrival[]>())
  let timer: number | undefined
  let inFlight: AbortController | undefined

  const stop = () => {
    window.clearInterval(timer)
    timer = undefined
    inFlight?.abort()
    inFlight = undefined
  }

  const load = async (ids: string[]) => {
    inFlight?.abort()
    const controller = (inFlight = new AbortController())
    const answers = await Promise.all(
      ids.map((id) =>
        api
          .arrivals(id, controller.signal)
          .then((list) => [id, list] as const)
          .catch(() => null),
      ),
    )
    if (controller.signal.aborted) return
    boards.value = new Map(answers.filter((answer) => answer !== null))
  }

  watch(
    () => stopIds.value.join(),
    () => {
      stop()
      boards.value = new Map()
      const ids = [...new Set(stopIds.value)]
      if (!ids.length) return
      void load(ids)
      timer = window.setInterval(() => void load(ids), POLL_MS)
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  return { boards }
}
