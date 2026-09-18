import { fetchDataset, type RawDataset, type RawStop } from '../upstream/thetamaps.ts'
import { matchChain, measureShape, alignToChain, type MeasuredShape } from './geo.ts'
import { lookupName } from './names.ts'
import {
  estimateRunningTimes,
  formatMinutes,
  inferTrips,
  repairRunningTimes,
  typicalSpeedKmh,
  type RunningTimes,
  type TripPattern,
} from './schedule.ts'
import { toCyrillic } from './translit.ts'
import type {
  Direction,
  DirectionSummary,
  LocalizedName,
  Route,
  RouteDetail,
  Stop,
  StopDetail,
  StopSchedule,
  TimetablePattern,
} from './model.ts'

export interface StopOnRoute {
  stopId: string
  direction: Direction
  /** Upstream's position along the route, counted across both directions. */
  order: number
  times: string[]
  /** Metres along the oriented route shape, matched once when the network is built. */
  along: number
}

/** The stretch of a route's round-trip shape that one direction occupies. */
export interface DirectionBand {
  min: number
  max: number
  /**
   * Median distance from a stop to the point on the line it matched to — how
   * well the shape and the stop chain agree. Measured across the real network
   * it is 5 m typical and 12 m at worst, so anything large means the two are
   * describing different things and distance along the line is not a quantity
   * worth dividing by a speed.
   *
   * This replaced a count of out-of-order stops, which looked like the obvious
   * metric and was inert: `matchChain` walks forward only, so it cannot emit an
   * out-of-order result however badly the shape fits. Breaking the orientation
   * fix on purpose left that count at zero and moved this number to infinity.
   */
  fitMeters: number
}

/**
 * Above this, the shape and the stop chain disagree too much to measure along.
 * The real network sits at 5 m typical and 15 m at worst, so this is a wide
 * margin around "the line genuinely describes where the buses drive" — and past
 * it neither an arrival estimate nor a timetable repair has a distance to stand
 * on.
 */
export const MAX_FIT_M = 120

export interface Network {
  routes: Map<string, RouteDetail>
  routeList: Route[]
  stops: Map<string, StopDetail>
  stopList: Stop[]
  /** Route id → its round-trip polyline, oriented to travel and measured. */
  shapes: Map<string, MeasuredShape>
  /** Route id → its stops, in travel order across both directions. */
  stopsOnRoute: Map<string, StopOnRoute[]>
  /** Route id → direction → the shape range that direction covers. */
  bands: Map<string, Map<Direction, DirectionBand>>
  /** Every direction as trips, repaired where upstream's times are impossible. */
  timetable: TimetablePattern[]
  /** Median scheduled speed of the plausible patterns, km/h — what repairs are made at. */
  typicalKmh: number
}

const GEORGIAN = /[Ⴀ-ჿ]/
const LATIN = /[A-Za-z]/

// Several names in the feed end with a bare "№" or "#" whose number never got
// entered ("Adlia street №"). Rendered as-is it reads as a truncation bug in
// this app rather than a gap in the source, so the dangling mark comes off.
const clean = (value: string | undefined) =>
  (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[№#]\s*$/, '')
    .trim()

/** Names repeat the pole number ("1963 ბათუმის ყინულის არენა"); we have it already. */
const stripCode = (name: string, code: number) => {
  const prefix = `${code} `
  return name.startsWith(prefix) ? name.slice(prefix.length).trim() : name
}

/**
 * Georgian is never overridden — it is what is painted on the pole. The other two
 * come from OpenStreetMap first, because OSM's names are translations and ours
 * were only ever a transliteration; then from the feed's own English when it is
 * genuinely Latin (it is for 171 of 578); then, for what nobody has mapped, the
 * sounded-out fallback. Showing Georgian under an "English" label is honest —
 * inventing a transliteration and calling it English is not.
 */
const localize = (ka: string, en: string): LocalizedName => {
  const georgian = ka || en
  const osm = lookupName(georgian)
  const isEnglish = LATIN.test(en) && !GEORGIAN.test(en)

  return {
    ka: georgian,
    en: osm?.en || (isEnglish ? en : georgian),
    ru: osm?.ru || toCyrillic(georgian),
  }
}

/**
 * The golden angle spreads 28 routes so that neighbours in the list never land
 * on neighbouring hues. Stable as long as the route set is, which is the same
 * assumption the line numbers already make. The offset keeps the first route
 * off pure red, which on a map reads as a warning rather than as a bus.
 */
const hueFor = (index: number) => Math.round((25 + index * 137.508) % 360)

const asDirection = (status: number): Direction => (status === 2 ? 2 : 1)

const buildNetwork = (raw: RawDataset): Network => {
  const { busStops, routesNames, routeCoordinatesGrouped } = raw.data

  const orderedRoutes = Object.values(routesNames).sort((a, b) => a.RouteSortOrder - b.RouteSortOrder)
  const hues = new Map(orderedRoutes.map((route, index) => [route.RouteIdGeoGps, hueFor(index)]))

  // One pass over the stops collects both directions of every route.
  const stopsOnRoute = new Map<string, StopOnRoute[]>()
  const stopNames = new Map<string, LocalizedName>()
  const stops = new Map<string, StopDetail>()
  /** `stop|route|direction` → its schedule, so a repaired time can be written back. */
  const scheduleAt = new Map<string, StopSchedule>()

  const stopName = (raw: RawStop) =>
    localize(stripCode(clean(raw.BusStopNameKA), raw.BusStopNumber), stripCode(clean(raw.BusStopNameEN), raw.BusStopNumber))

  for (const [stopId, rawStop] of Object.entries(busStops)) {
    const name = stopName(rawStop)
    stopNames.set(stopId, name)

    const schedules: StopSchedule[] = []
    for (const [routeId, entry] of Object.entries(rawStop.routes ?? {})) {
      const route = routesNames[routeId]
      if (!route) continue

      const direction = asDirection(entry.Status)
      const times = [...(entry.times ?? [])].sort()

      const schedule: StopSchedule = {
        routeId,
        shortName: clean(route.RouteNameEN) || clean(route.RouteNameKA),
        hue: hues.get(routeId) ?? 0,
        direction,
        // Backfilled once the route loop below knows where each direction ends.
        headsign: { ka: '', en: '', ru: '' },
        times,
        estimated: false,
      }
      schedules.push(schedule)
      scheduleAt.set(`${stopId}|${routeId}|${direction}`, schedule)

      const list = stopsOnRoute.get(routeId) ?? []
      list.push({ stopId, direction, order: entry.Order, times, along: 0 })
      stopsOnRoute.set(routeId, list)
    }

    schedules.sort((a, b) => a.shortName.localeCompare(b.shortName, 'en', { numeric: true }))

    stops.set(stopId, {
      id: stopId,
      code: rawStop.BusStopNumber,
      name,
      lat: rawStop.BusStopLatitude,
      lon: rawStop.BusStopLongitude,
      routeIds: schedules.map((schedule) => schedule.routeId),
      schedules,
    })
  }

  for (const list of stopsOnRoute.values()) list.sort((a, b) => a.order - b.order)

  const routes = new Map<string, RouteDetail>()
  const shapes = new Map<string, MeasuredShape>()
  const bands = new Map<string, Map<Direction, DirectionBand>>()

  for (const rawRoute of orderedRoutes) {
    const id = rawRoute.RouteIdGeoGps
    const onRoute = stopsOnRoute.get(id) ?? []
    const rawShape = (routeCoordinatesGrouped[id] ?? []).map((point) => ({ lat: point.lat, lon: point.lon }))

    // Match the stop chain to the line once, here, so every later question —
    // where a stop sits, how far a bus still has to run — is a lookup.
    const chainPoints = onRoute
      .map((stop) => stops.get(stop.stopId))
      .filter((stop) => stop !== undefined)
      .map((stop) => ({ lat: stop.lat, lon: stop.lon }))

    const shapePoints = alignToChain(rawShape, chainPoints)

    if (shapePoints.length > 1 && chainPoints.length > 1) {
      const shape = measureShape(shapePoints)
      shapes.set(id, shape)

      const matched = matchChain(shape, chainPoints)
      const routeBands = new Map<Direction, DirectionBand>()

      const offsets = new Map<Direction, number[]>()

      onRoute.forEach((stop, index) => {
        stop.along = matched[index]?.along ?? 0

        const band = routeBands.get(stop.direction)
        if (!band) routeBands.set(stop.direction, { min: stop.along, max: stop.along, fitMeters: 0 })
        else {
          band.min = Math.min(band.min, stop.along)
          band.max = Math.max(band.max, stop.along)
        }

        const list = offsets.get(stop.direction) ?? []
        list.push(matched[index]?.offset ?? Infinity)
        offsets.set(stop.direction, list)
      })

      // Median, not mean: one stop set back from the kerb should not condemn a
      // route, and one stop matched to the wrong street should not hide behind
      // forty good ones either.
      for (const [direction, band] of routeBands) {
        const sorted = (offsets.get(direction) ?? []).sort((a, b) => a - b)
        band.fitMeters = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Infinity
      }

      bands.set(id, routeBands)
    }

    const directions: RouteDetail['directions'] = []
    for (const direction of [1, 2] as Direction[]) {
      const leg = onRoute.filter((stop) => stop.direction === direction)
      if (!leg.length) continue
      directions.push({
        direction,
        from: stopNames.get(leg[0]!.stopId) ?? { ka: '', en: '', ru: '' },
        to: stopNames.get(leg.at(-1)!.stopId) ?? { ka: '', en: '', ru: '' },
        stopCount: leg.length,
        stopIds: leg.map((stop) => stop.stopId),
        along: leg.map((stop) => Math.round(stop.along)),
      })
    }

    routes.set(id, {
      id,
      shortName: clean(rawRoute.RouteNameEN) || clean(rawRoute.RouteNameKA),
      isCircle: rawRoute.RouteIsCircle,
      sortOrder: rawRoute.RouteSortOrder,
      hue: hues.get(id) ?? 0,
      directions,
      shape: shapePoints.map((point) => [point.lat, point.lon] as [number, number]),
    })

  }

  const { timetable, typicalKmh } = buildTimetable(routes, stopsOnRoute, bands, scheduleAt)

  // A direction's destination is only known once its stop chain is ordered, so
  // the schedules built above get it here rather than being built twice.
  const headsigns = new Map<string, LocalizedName>()
  for (const route of routes.values()) {
    for (const leg of route.directions) headsigns.set(`${route.id}:${leg.direction}`, leg.to)
  }
  for (const stop of stops.values()) {
    for (const schedule of stop.schedules) {
      schedule.headsign = headsigns.get(`${schedule.routeId}:${schedule.direction}`) ?? schedule.headsign
    }
  }

  const summarise = (route: RouteDetail): Route => ({
    id: route.id,
    shortName: route.shortName,
    isCircle: route.isCircle,
    sortOrder: route.sortOrder,
    hue: route.hue,
    directions: route.directions.map(
      ({ direction, from, to, stopCount }): DirectionSummary => ({ direction, from, to, stopCount }),
    ),
  })

  const stopList: Stop[] = [...stops.values()].map(({ schedules: _schedules, ...stop }) => stop)

  return {
    routes,
    routeList: [...routes.values()].map(summarise),
    stops,
    stopList,
    shapes,
    stopsOnRoute,
    bands,
    timetable,
    typicalKmh,
  }
}

/**
 * Trips for every direction, with impossible running times repaired — and the
 * repair written back into the stop schedules, so the stop page, the arrival
 * board and the journey planner all tell a rider the same time for the same
 * bus. See schedule.ts for what counts as impossible and why.
 *
 * Two passes, because the speed a broken pattern is re-derived at is measured
 * off the rest of the network rather than chosen.
 */
function buildTimetable(
  routes: Map<string, RouteDetail>,
  stopsOnRoute: Map<string, StopOnRoute[]>,
  bands: Map<string, Map<Direction, DirectionBand>>,
  scheduleAt: Map<string, StopSchedule>,
): { timetable: TimetablePattern[]; typicalKmh: number } {
  const legs: {
    routeId: string
    direction: Direction
    leg: StopOnRoute[]
    along: number[]
    measurable: boolean
    patterns: TripPattern[] | null
  }[] = []

  for (const route of routes.values()) {
    for (const { direction } of route.directions) {
      const leg = (stopsOnRoute.get(route.id) ?? []).filter((stop) => stop.direction === direction)
      const fit = bands.get(route.id)?.get(direction)?.fitMeters ?? Infinity
      legs.push({
        routeId: route.id,
        direction,
        leg,
        along: leg.map((stop) => stop.along),
        measurable: fit <= MAX_FIT_M,
        // No times anywhere is a direction without a timetable, which is a
        // different thing from times that do not line up into trips.
        patterns: leg.some((stop) => stop.times.length) ? inferTrips(leg.map((stop) => stop.times)) : [],
      })
    }
  }

  const typicalKmh = typicalSpeedKmh(
    legs
      .filter(({ measurable }) => measurable)
      .flatMap(({ along, patterns }) => (patterns ?? []).map(({ offsets }) => ({ offsets, along }))),
  )

  const timetable: TimetablePattern[] = []

  for (const { routeId, direction, leg, along, measurable, patterns } of legs) {
    const stopIds = leg.map((stop) => stop.stopId)

    // Times that do not line up are left on the stop pages exactly as
    // published, and the planner treats the direction as untimed: better no
    // departure than one read off the wrong trip.
    if (!patterns?.length) {
      const estimate = estimateRunningTimes(along, typicalKmh)
      timetable.push({ routeId, direction, stopIds, ...estimate, departures: [] })
      continue
    }

    const repaired = patterns.map((pattern) => ({
      departures: pattern.departures,
      ...(measurable
        ? repairRunningTimes(pattern.offsets, along, typicalKmh)
        : ({ offsets: pattern.offsets, estimated: pattern.offsets.map(() => false) } satisfies RunningTimes)),
    }))

    for (const pattern of repaired) timetable.push({ routeId, direction, stopIds, ...pattern })

    // Written back only where something moved, so a direction upstream got right
    // keeps its published strings byte for byte.
    leg.forEach((stop, index) => {
      if (!repaired.some((pattern) => pattern.estimated[index])) return
      const times = repaired
        .flatMap((pattern) => pattern.departures.map((departure) => formatMinutes(departure + pattern.offsets[index]!)))
        .sort()
      stop.times = times
      const schedule = scheduleAt.get(`${stop.stopId}|${routeId}|${direction}`)
      if (schedule) {
        schedule.times = times
        schedule.estimated = true
      }
    })
  }

  return { timetable, typicalKmh }
}

// Normalising 578 stops and 80k departure times is not free, and the raw
// dataset is one cached object that only changes when its TTL lapses — so the
// derived network is keyed on that object's identity and rebuilt exactly then.
const built = new WeakMap<RawDataset, Network>()

export async function getNetwork(): Promise<Network> {
  const raw = await fetchDataset()
  const existing = built.get(raw)
  if (existing) return existing

  const network = buildNetwork(raw)
  built.set(raw, network)
  return network
}
