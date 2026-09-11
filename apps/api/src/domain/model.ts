// The shapes the frontend consumes. Nothing upstream leaks through here:
// ids stay opaque strings, everything else is camelCase and localised.

/**
 * Georgian is the real name; English is often the same text (see CLAUDE.md);
 * Russian is a transliteration of the Georgian, because that is what is written
 * on the pole and only 171 of 578 stops have a genuinely Latin name at all.
 */
export interface LocalizedName {
  ka: string
  en: string
  ru: string
}

/** 1 = outbound (from the first terminal), 2 = inbound. */
export type Direction = 1 | 2

export interface DirectionSummary {
  direction: Direction
  from: LocalizedName
  to: LocalizedName
  stopCount: number
}

export interface Route {
  id: string
  /** The line number as painted on the bus — "2", "10A". */
  shortName: string
  isCircle: boolean
  sortOrder: number
  /** Degrees on the colour wheel; the client supplies lightness and chroma. */
  hue: number
  directions: DirectionSummary[]
}

export interface RouteDirection extends DirectionSummary {
  /** Stop ids in travel order. */
  stopIds: string[]
}

export interface RouteDetail extends Omit<Route, 'directions'> {
  directions: RouteDirection[]
  /** The whole round trip as [lat, lon] pairs — upstream has no per-direction shape. */
  shape: [number, number][]
}

export interface Stop {
  id: string
  /** The number on the pole. */
  code: number
  name: LocalizedName
  lat: number
  lon: number
  routeIds: string[]
}

export interface StopSchedule {
  routeId: string
  shortName: string
  hue: number
  direction: Direction
  /** Where this direction ends up. A rider navigates by destination, not by "inbound". */
  headsign: LocalizedName
  /** Scheduled departures from this stop, "HH:MM", ascending. */
  times: string[]
}

export interface StopDetail extends Stop {
  schedules: StopSchedule[]
}

export interface Vehicle {
  /** The licence plate — upstream's only vehicle identity, and it is stable. */
  id: string
  routeId: string
  shortName: string
  hue: number
  lat: number
  lon: number
  /**
   * Which way round the route it is going. Null when we genuinely cannot tell —
   * upstream reports -1 for about nine vehicles in ten, so this is inferred
   * from geometry, and a bus that has not moved yet has no answer.
   */
  direction: Direction | null
  /** Derived from consecutive samples; null until we have seen it move. */
  heading: number | null
  /** Derived, km/h; decays toward zero while a bus stands still. */
  speedKmh: number | null
  /** False once it has been parked long enough to be off duty, not just waiting. */
  inService: boolean
  /** How long it has been standing still. */
  standingSeconds: number
  /** When we last had any sample for it. */
  seenAt: string
  /** When it was last somewhere new. */
  movedAt: string
}

export interface Arrival {
  routeId: string
  shortName: string
  hue: number
  direction: Direction
  headsign: LocalizedName
  /** Next scheduled departure, "HH:MM" in Batumi time, or null past today's last. */
  scheduledTime: string | null
  /** Minutes until `scheduledTime`. */
  scheduledMinutes: number | null
  /** The same moment as an instant, so a client in any timezone agrees. */
  scheduledAt: string | null
  /**
   * Our own estimate from the nearest approaching vehicle. Upstream publishes
   * no predictions at all, so this is a derivation and is labelled as one.
   */
  estimate: ArrivalEstimate | null
}

export interface ArrivalEstimate {
  /** Whole minutes, for a caller that only wants a number. */
  minutes: number
  /**
   * When we expect it, as an instant. The client counts down to this rather
   * than to `minutes`, so the number keeps ticking between polls instead of
   * standing still for ten seconds and then jumping.
   */
  arrivesAt: string
  /**
   * How much to trust it. `live` is a bus we can see and time; `slow` is one
   * we can see but that is barely moving, so the number is soft.
   */
  confidence: 'live' | 'slow'
  vehicleId: string
  /** Road distance still to run, along the route shape. */
  distanceMeters: number
  /** How many stops it still has to serve before this one. */
  stopsAway: number
}
