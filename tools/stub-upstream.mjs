// A stand-in for thetamaps.site:54321, for the hours when Batumi's buses are
// parked and the real feed returns []. Serves the REAL network dataset and
// synthesises buses that walk the REAL route polylines.
//
// Deliberately reports Status -1 for most of them, exactly as the real feed
// does, so the direction inference is exercised rather than bypassed.
//
//   node stub-upstream.mjs
//   UPSTREAM_BASE=http://localhost:8899 node --experimental-strip-types src/server.ts
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REAL = 'https://thetamaps.site:54321'
const CACHE = new URL('./stub-db.json', import.meta.url).pathname.replace(/^\//, '')
const PORT = 8899

let db
if (existsSync(CACHE)) {
  db = JSON.parse(readFileSync(CACHE, 'utf8'))
  console.log('dataset from cache')
} else {
  console.log('fetching real dataset once…')
  db = await (await fetch(`${REAL}/api/getDbData`)).json()
  writeFileSync(CACHE, JSON.stringify(db))
}

const shapes = db.data.routeCoordinatesGrouped
const routes = Object.keys(db.data.routesNames)

// Each synthetic bus is a cursor walking its route's polyline.
const fleet = new Map()
for (const routeId of routes) {
  const line = shapes[routeId] ?? []
  if (line.length < 2) continue
  const count = 4
  fleet.set(
    routeId,
    Array.from({ length: count }, (_, i) => ({
      plate: `ST ${routeId.slice(-3)}${i}`,
      // Spread them evenly around the loop so both directions are populated.
      t: (i / count) * (line.length - 1),
      speed: 0.9 + Math.random() * 0.6,
    })),
  )
}

const started = Date.now()

const positions = (routeId) => {
  const line = shapes[routeId] ?? []
  const buses = fleet.get(routeId) ?? []
  if (line.length < 2) return []

  const elapsed = (Date.now() - started) / 1000
  return buses.map((bus, index) => {
    const at = (bus.t + elapsed * bus.speed * 0.07) % (line.length - 1)
    const i = Math.floor(at)
    const frac = at - i
    const a = line[i]
    const b = line[i + 1] ?? line[0]
    return {
      Lat: a.lat + (b.lat - a.lat) * frac,
      Lon: a.lon + (b.lon - a.lon) * frac,
      // Mirrors the real feed: mostly -1, occasionally a real direction.
      Status: index === 0 ? 1 : index === 1 ? 2 : -1,
      Name: bus.plate,
    }
  })
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  res.setHeader('content-type', 'application/json')

  if (url.pathname === '/api/getDbData') {
    res.end(JSON.stringify(db))
    return
  }

  if (url.pathname === '/api/getBusLocsOnRoute') {
    res.end(JSON.stringify({ data: positions(url.searchParams.get('routeId')) }))
    return
  }

  res.statusCode = 404
  res.end('{"error":"Not found"}')
}).listen(PORT, () => console.log(`stub upstream on http://localhost:${PORT} — ${fleet.size} routes`))
