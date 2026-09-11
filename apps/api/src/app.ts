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

// Our own cache headers, since the client polls: the network is effectively
// static, live positions are not.
const STATIC_CACHE = 'public, max-age=300, stale-while-revalidate=600'
const LIVE_CACHE = 'no-cache'

app.get('/health', async (context) => {
  try {
    const network = await getNetwork()
    return context.json({
      status: 'ok',
      upstream: config.upstreamBase,
      routes: network.routeList.length,
      stops: network.stopList.length,
    })
  } catch (error) {
    return context.json({ status: 'degraded', upstream: config.upstreamBase, error: String(error) }, 503)
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
    console.error(`upstream ${error.status} for ${error.url}`)
    return context.json({ error: 'upstream unavailable' }, 502)
  }

  console.error(error)
  return context.json({ error: 'internal error' }, 500)
})
