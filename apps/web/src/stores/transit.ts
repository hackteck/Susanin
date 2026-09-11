import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api/client'
import type { Route, RouteDetail, Stop, Vehicle } from '@/api/types'

const storageKey = 'selected-routes'

/** Upstream caches positions for 4s; polling faster only costs requests. */
const POLL_MS = 5000

const readSelection = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * The network (loaded once) plus the live vehicle feed. App-wide because the
 * map, the sidebar and the route pages all read the same selection.
 */
export const useTransit = defineStore('transit', () => {
  const routes = ref<Route[]>([])
  const stops = ref<Stop[]>([])
  const vehicles = ref<Vehicle[]>([])
  const loading = ref(false)
  const failed = ref(false)

  /** Empty means every route — the default "whole city" view. */
  const selectedRouteIds = ref<string[]>(readSelection())

  const routeById = computed(() => new Map(routes.value.map((route) => [route.id, route])))
  const stopById = computed(() => new Map(stops.value.map((stop) => [stop.id, stop])))
  const selectedRoutes = computed(() =>
    selectedRouteIds.value.map((id) => routeById.value.get(id)).filter((route) => route !== undefined),
  )

  const visibleVehicles = computed(() =>
    selectedRouteIds.value.length
      ? vehicles.value.filter((vehicle) => selectedRouteIds.value.includes(vehicle.routeId))
      : vehicles.value,
  )

  // What "N buses running" should count. The feed reports every bus it can see,
  // including a depot full of them overnight — measured, 137 of 152 at midnight.
  const runningVehicles = computed(() => visibleVehicles.value.filter((vehicle) => vehicle.inService))

  let networkRequest: Promise<void> | null = null

  // The network is static for the session, and three pages want it at once —
  // so the promise is shared rather than the request repeated.
  const loadNetwork = () => {
    if (networkRequest) return networkRequest

    loading.value = true
    failed.value = false
    networkRequest = Promise.all([api.routes(), api.stops()])
      .then(([loadedRoutes, loadedStops]) => {
        routes.value = loadedRoutes
        stops.value = loadedStops
      })
      .catch((error: unknown) => {
        failed.value = true
        networkRequest = null
        throw error
      })
      .finally(() => {
        loading.value = false
      })

    return networkRequest
  }

  // Shapes and stop chains are only fetched for routes actually being drawn —
  // all 28 at once is several megabytes of polyline nobody asked for.
  const routeDetails = ref(new Map<string, RouteDetail>())
  const pendingDetails = new Map<string, Promise<RouteDetail>>()

  const loadRouteDetail = (id: string): Promise<RouteDetail> => {
    const loaded = routeDetails.value.get(id)
    if (loaded) return Promise.resolve(loaded)

    const pending = pendingDetails.get(id)
    if (pending) return pending

    const request = api
      .route(id)
      .then((detail) => {
        routeDetails.value = new Map(routeDetails.value).set(id, detail)
        return detail
      })
      .finally(() => pendingDetails.delete(id))

    pendingDetails.set(id, request)
    return request
  }

  const persist = () => localStorage.setItem(storageKey, JSON.stringify(selectedRouteIds.value))

  const toggleRoute = (id: string) => {
    selectedRouteIds.value = selectedRouteIds.value.includes(id)
      ? selectedRouteIds.value.filter((selected) => selected !== id)
      : [...selectedRouteIds.value, id]
    persist()
  }

  const selectOnly = (id: string) => {
    selectedRouteIds.value = [id]
    persist()
  }

  const clearSelection = () => {
    selectedRouteIds.value = []
    persist()
  }

  let timer: number | undefined
  // Reactive, because the header may only claim a bus count on pages that are
  // actually polling — "0 buses running" beside a live arrival board is a lie.
  const watchers = ref(0)
  const watching = computed(() => watchers.value > 0)

  const refreshVehicles = async () => {
    // A hidden tab must not keep the upstream fan-out running.
    if (document.hidden) return
    try {
      vehicles.value = await api.vehicles(selectedRouteIds.value.length ? selectedRouteIds.value : null)
    } catch {
      // A dropped poll is not worth surfacing: the next one is five seconds away
      // and the markers on screen are still the best answer we have.
    }
  }

  /** Ref-counted so several pages can watch the feed without racing the timer. */
  const watchVehicles = () => {
    watchers.value++
    if (watchers.value === 1) {
      void refreshVehicles()
      timer = window.setInterval(() => void refreshVehicles(), POLL_MS)
    }

    return () => {
      watchers.value--
      if (watchers.value === 0) {
        window.clearInterval(timer)
        timer = undefined
        vehicles.value = []
      }
    }
  }

  return {
    routes,
    stops,
    vehicles,
    loading,
    failed,
    selectedRouteIds,
    routeById,
    stopById,
    selectedRoutes,
    visibleVehicles,
    runningVehicles,
    watching,
    POLL_MS,
    routeDetails,
    loadRouteDetail,
    loadNetwork,
    toggleRoute,
    selectOnly,
    clearSelection,
    refreshVehicles,
    watchVehicles,
  }
})
