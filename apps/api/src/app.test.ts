import { test } from 'node:test'
import assert from 'node:assert/strict'
import { app } from './app.ts'
import type { Arrival, Route, RouteDetail, Stop, StopDetail, Vehicle } from './domain/model.ts'

/**
 * The API's contract, exercised end to end.
 *
 * Driven straight through `app.fetch` rather than over a socket: a Hono app is
 * a fetch handler, so this tests the real routing, the real cache and the real
 * upstream without needing a server, a port, or anything to be running first.
 */
const get = (path: string) => app.fetch(new Request(`http://susanin.test${path}`))

const json = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const response = await get(path)
  return { status: response.status, body: (await response.json()) as T }
}

/** Batumi, generously. A coordinate outside this is a bug, not a suburb. */
const inBatumi = (lat: number, lon: number) => lat > 41.5 && lat < 41.8 && lon > 41.5 && lon < 41.8

const GEORGIAN = /[Ⴀ-ჿ]/

// The upstream is a small municipal service that stops answering when the
// fleet does — after about 20:00 every route returns an empty list, and the
// host is occasionally simply unreachable. Skipping loudly beats failing
// misleadingly, so the whole suite is gated on one probe.
const reachable = await (async () => {
  try {
    return (await get('/api/health')).status === 200
  } catch {
    return false
  }
})()

const live = reachable ? {} : { skip: 'upstream unreachable — see UPSTREAM_BASE in .env.example' }

test('health reports a network it can actually see', live, async () => {
  const { status, body } = await json<{ status: string; routes: number; stops: number }>('/api/health')

  assert.equal(status, 200)
  assert.equal(body.status, 'ok')
  assert.ok(body.routes > 0, 'no routes')
  assert.ok(body.stops > 0, 'no stops')
})

test('every route is complete enough to draw', live, async () => {
  const { status, body } = await json<Route[]>('/api/routes')

  assert.equal(status, 200)
  assert.ok(body.length > 0, 'no routes')

  for (const route of body) {
    assert.ok(route.id, 'route without an id')
    assert.ok(route.shortName, `route ${route.id} has no line number`)
    assert.ok(route.hue >= 0 && route.hue < 360, `route ${route.shortName} hue ${route.hue}`)
    assert.ok(route.directions.length > 0, `route ${route.shortName} has no directions`)

    for (const leg of route.directions) {
      assert.ok(leg.stopCount > 0, `route ${route.shortName} direction ${leg.direction} is empty`)
      assert.ok(leg.to.ka, `route ${route.shortName} direction ${leg.direction} has no destination`)
    }
  }
})

test('a route detail carries its shape and its stop chains', live, async () => {
  const { body: routes } = await json<Route[]>('/api/routes')
  const { status, body } = await json<RouteDetail>(`/api/routes/${routes[0]!.id}`)

  assert.equal(status, 200)
  assert.ok(body.shape.length > 1, 'route has no drawable shape')
  assert.ok(
    body.shape.every(([lat, lon]) => inBatumi(lat, lon)),
    'shape leaves Batumi',
  )

  for (const leg of body.directions) {
    assert.equal(leg.stopIds.length, leg.stopCount)
    assert.equal(new Set(leg.stopIds).size, leg.stopIds.length, 'a stop repeats within one direction')
  }
})

test('an unknown route is a 404, not an empty success', live, async () => {
  assert.equal((await get('/api/routes/nope')).status, 404)
  assert.equal((await get('/api/stops/nope')).status, 404)
  assert.equal((await get('/api/stops/nope/arrivals')).status, 404)
})

test('every stop has a name in all three locales', live, async () => {
  const { status, body } = await json<Stop[]>('/api/stops')

  assert.equal(status, 200)
  assert.ok(body.length > 0, 'no stops')

  for (const stop of body) {
    assert.ok(stop.name.ka, `stop ${stop.code} has no Georgian name`)
    assert.ok(stop.name.en, `stop ${stop.code} has no English name`)
    assert.ok(stop.name.ru, `stop ${stop.code} has no Russian name`)
    assert.ok(inBatumi(stop.lat, stop.lon), `stop ${stop.code} is at ${stop.lat},${stop.lon}`)
  }
})

test('no Georgian script survives into a Russian name', live, async () => {
  // The point of the transliteration: a Russian reader must never be shown the
  // Georgian for the stop they are standing at.
  const { body } = await json<Stop[]>('/api/stops')
  const untranslated = body.filter((stop) => GEORGIAN.test(stop.name.ru))

  assert.equal(untranslated.length, 0, `still Georgian: ${untranslated.slice(0, 3).map((s) => s.name.ru).join(', ')}`)
})

test('bbox narrows the stop list, and a broken one is rejected', live, async () => {
  const { body: all } = await json<Stop[]>('/api/stops')
  const { status, body: box } = await json<Stop[]>('/api/stops?bbox=41.63,41.60,41.66,41.65')

  assert.equal(status, 200)
  assert.ok(box.length > 0, 'bbox matched nothing')
  assert.ok(box.length < all.length, 'bbox matched everything')
  assert.ok(
    box.every((stop) => stop.lat >= 41.63 && stop.lat <= 41.66 && stop.lon >= 41.6 && stop.lon <= 41.65),
    'a stop outside the box came back',
  )

  assert.equal((await get('/api/stops?bbox=nonsense')).status, 400)
})

test('a stop lists its timetable, sorted, with a destination', live, async () => {
  const { body: stops } = await json<Stop[]>('/api/stops')
  const busy = stops.find((stop) => stop.routeIds.length > 1) ?? stops[0]!
  const { status, body } = await json<StopDetail>(`/api/stops/${busy.id}`)

  assert.equal(status, 200)

  for (const schedule of body.schedules) {
    assert.ok(schedule.shortName, 'schedule without a line number')
    assert.ok(schedule.headsign.ka, `route ${schedule.shortName} has no destination at this stop`)
    assert.deepEqual([...schedule.times].sort(), schedule.times, 'departures are out of order')
    assert.ok(
      schedule.times.every((time) => /^\d{2}:\d{2}$/.test(time)),
      `route ${schedule.shortName} has a malformed departure time`,
    )
  }
})

test('arrivals answer with a countdown a client can tick against', live, async () => {
  const { body: stops } = await json<Stop[]>('/api/stops')
  const busy = stops.find((stop) => stop.routeIds.length > 1) ?? stops[0]!
  const { status, body } = await json<Arrival[]>(`/api/stops/${busy.id}/arrivals`)

  assert.equal(status, 200)
  assert.ok(Array.isArray(body))

  for (const arrival of body) {
    assert.ok(arrival.headsign.ru, `route ${arrival.shortName} arrival has no destination`)

    // Either the schedule says something or it honestly says nothing.
    if (arrival.scheduledTime !== null) {
      assert.ok(arrival.scheduledAt, 'a scheduled time with no instant to count to')
      assert.ok(!Number.isNaN(Date.parse(arrival.scheduledAt)), 'scheduledAt is not a date')
    }

    if (!arrival.estimate) continue

    // The estimate is what the client counts down to, so it has to be an
    // instant, and it has to be in the future when it is published.
    const arrivesAt = Date.parse(arrival.estimate.arrivesAt)
    assert.ok(!Number.isNaN(arrivesAt), 'arrivesAt is not a date')
    assert.ok(arrivesAt > Date.now() - 120_000, 'an estimate that already expired')
    assert.ok(arrival.estimate.stopsAway >= 0, 'negative stops away')
    assert.ok(arrival.estimate.distanceMeters >= 0, 'a bus that has already passed')
    assert.ok(['live', 'slow'].includes(arrival.estimate.confidence), 'unknown confidence')
  }
})

test('vehicles come back per route, and a bad id is rejected', live, async () => {
  const { body: routes } = await json<Route[]>('/api/routes')
  const { status, body } = await json<Vehicle[]>(`/api/vehicles?routes=${routes[0]!.id}`)

  assert.equal(status, 200)
  // Deliberately not "more than none": after about 20:00 the fleet is parked
  // and upstream returns nothing, which is an answer rather than a failure.
  assert.ok(Array.isArray(body))

  for (const vehicle of body) {
    assert.ok(vehicle.id, 'vehicle without a plate')
    assert.ok(inBatumi(vehicle.lat, vehicle.lon), `vehicle ${vehicle.id} is at ${vehicle.lat},${vehicle.lon}`)
    assert.ok(
      vehicle.direction === 1 || vehicle.direction === 2 || vehicle.direction === null,
      `vehicle ${vehicle.id} has direction ${vehicle.direction}`,
    )
    assert.ok(
      vehicle.heading === null || (vehicle.heading >= 0 && vehicle.heading < 360),
      `vehicle ${vehicle.id} heading ${vehicle.heading}`,
    )
  }

  assert.equal((await get('/api/vehicles?routes=not-a-route')).status, 400)
})

test('a repeated route id does not multiply the answer', live, async () => {
  const { body: routes } = await json<Route[]>('/api/routes')
  const id = routes[0]!.id

  const once = await json<Vehicle[]>(`/api/vehicles?routes=${id}`)
  const thrice = await json<Vehicle[]>(`/api/vehicles?routes=${id},${id},${id}`)

  // Undeduplicated, this returned every bus three times — and worse, had the
  // tracker observe each one at the same position three times in a row, which
  // reads as "not moving" and zeroes the speed every estimate is built on.
  assert.equal(thrice.body.length, once.body.length)
  assert.equal(new Set(thrice.body.map((vehicle) => vehicle.id)).size, thrice.body.length)
})
