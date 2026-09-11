import type { Arrival, Route, RouteDetail, Stop, StopDetail, Vehicle } from './types'

/**
 * Same origin on the web — Vite proxies `/api` in development and Vercel serves
 * it in production. A packaged app has no origin of its own to serve from
 * (Capacitor runs the bundle from `https://localhost`), so the Android build
 * bakes in the deployed API's absolute URL through `VITE_API_BASE`.
 */
const base = import.meta.env.VITE_API_BASE ?? '/api'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${base}${path}`, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new ApiError(`GET ${path} failed`, response.status)
  return (await response.json()) as T
}

export const api = {
  routes: (signal?: AbortSignal) => get<Route[]>('/routes', signal),
  route: (id: string, signal?: AbortSignal) => get<RouteDetail>(`/routes/${id}`, signal),
  stops: (signal?: AbortSignal) => get<Stop[]>('/stops', signal),
  stop: (id: string, signal?: AbortSignal) => get<StopDetail>(`/stops/${id}`, signal),
  arrivals: (id: string, signal?: AbortSignal) => get<Arrival[]>(`/stops/${id}/arrivals`, signal),

  /** No `routes` means every route, which is a fan-out — ask for what's shown. */
  vehicles: (routeIds: string[] | null, signal?: AbortSignal) =>
    get<Vehicle[]>(routeIds?.length ? `/vehicles?routes=${routeIds.join(',')}` : '/vehicles', signal),
}
