import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { config } from './config.ts'
import { UpstreamError } from './lib/http.ts'
import { getArrivals } from './domain/arrivals.ts'
import { getNetwork } from './domain/network.ts'
import { getVehicles } from './domain/vehicles.ts'

export const app = new Hono().basePath('/api')

app.use(
  '*',
  cors({
    origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'OPTIONS'],
  }),
)

/**
 * Our own cache headers, since the client polls. `s-maxage` is the load-bearing
 * part and it is aimed at a shared cache, not at the browser.
 *
 * The per-process TTL cache below bounds upstream load per *process*, and on
 * Vercel that is multiplied by however many instances happen to be warm. A
 * shared cache in front of the function collapses them all: with `s-maxage`,
 * every viewer in a region is answered from one origin response per window,
 * whatever the instance count. It is the cheapest available fix for the ceiling
 * described in the README, and it needs no infrastructure.
 *
 * `no-cache` is what these live routes used to send, and it meant every poll of
 * every open tab reached a function — the 28-way upstream fan-out included.
 *
 * The windows deliberately match the TTLs in config.ts, which in turn match what
 * upstream itself declares (`max-age=4` for positions, 600 for the dataset). So
 * a shared cache is never staler than the data claims to be, which is why this
 * does not contradict the rule that a cached bus is worse than no bus: that rule
 * is about the service worker holding a position across sessions and presenting
 * it as current. Four seconds, shared, cannot do that — and `max-age=0` keeps
 * the *browser* out of it, which is where a stale bus would really come from.
 *
 * Vercel strips `s-maxage` and `stale-while-revalidate` before the response
 * reaches the browser, so one header serves both audiences.
 */
const STATIC_CACHE = 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600'
const LIVE_CACHE = 'public, max-age=0, s-maxage=4, stale-while-revalidate=4'

// Deliberately silent about *where* the feed is: this endpoint is public, and
// the README asks people not to hit the municipal box directly. The address is
// in the config and the server's own startup log, where an operator looks.
app.get('/health', async (context) => {
  try {
    const network = await getNetwork()
    return context.json({
      status: 'ok',
      routes: network.routeList.length,
      stops: network.stopList.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return context.json({ status: 'degraded', error: message }, 503)
  }
})

app.get('/routes', async (context) => {
  const network = await getNetwork()
  context.header('Cache-Control', STATIC_CACHE)
  return context.json(network.routeList)
})

app.get('/routes/:id', async (context) => {
  const network = await getNetwork()
  const route = network.routes.get(context.req.param('id'))
  if (!route) return context.json({ error: 'route not found' }, 404)

  context.header('Cache-Control', STATIC_CACHE)
  return context.json(route)
})

app.get('/stops', async (context) => {
  const network = await getNetwork()
  const bbox = context.req.query('bbox')

  context.header('Cache-Control', STATIC_CACHE)
  if (!bbox) return context.json(network.stopList)

  const [south, west, north, east] = bbox.split(',').map(Number)
  if ([south, west, north, east].some((value) => !Number.isFinite(value))) {
    return context.json({ error: 'bbox must be south,west,north,east' }, 400)
  }

  return context.json(
    network.stopList.filter(
      (stop) => stop.lat >= south! && stop.lat <= north! && stop.lon >= west! && stop.lon <= east!,
    ),
  )
})

app.get('/stops/:id', async (context) => {
  const network = await getNetwork()
  const stop = network.stops.get(context.req.param('id'))
  if (!stop) return context.json({ error: 'stop not found' }, 404)

  context.header('Cache-Control', STATIC_CACHE)
  return context.json(stop)
})

app.get('/stops/:id/arrivals', async (context) => {
  const arrivals = await getArrivals(context.req.param('id'))
  if (!arrivals) return context.json({ error: 'stop not found' }, 404)

  context.header('Cache-Control', LIVE_CACHE)
  return context.json(arrivals)
})

app.get('/vehicles', async (context) => {
  const network = await getNetwork()
  const requested = context.req.query('routes')

  // Defaulting to every route is a 28-way fan-out upstream. It is allowed
  // because the map needs it, and it is safe only because the cache collapses
  // concurrent callers into one request per route per TTL.
  // Deduplicated: `?routes=a,a,a` otherwise returns the same buses three times
  // and, worse, has every copy observe the same vehicle at the same position —
  // which the tracker reads as "not moving" and zeroes the speed everyone's
  // arrival estimates are built on.
  const routeIds = requested
    ? [...new Set(requested.split(',').map((id) => id.trim()))].filter((id) => network.routes.has(id))
    : network.routeList.map((route) => route.id)

  if (requested && !routeIds.length) return context.json({ error: 'no known route ids given' }, 400)

  const vehicles = await getVehicles(routeIds)
  context.header('Cache-Control', LIVE_CACHE)
  return context.json(vehicles)
})

app.onError((error, context) => {
  if (error instanceof UpstreamError) {
    console.error(`upstream ${error.status || 'unreachable'} for ${error.url}: ${error.message}`)
    return context.json({ error: 'upstream unavailable' }, 502)
  }

  console.error(error)
  return context.json({ error: 'internal error' }, 500)
})
