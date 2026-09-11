// Mirrors @susanin/api's public model. Hand-written rather than shared through
// a package: two apps deployed together are not a reason to invent a third.

/** Russian is a transliteration of the Georgian — see the API's translit.ts. */
export interface LocalizedName {
  ka: string
  en: string
  ru: string
}

export type Direction = 1 | 2

export interface DirectionSummary {
  direction: Direction
  from: LocalizedName
  to: LocalizedName
  stopCount: number
}

export interface Route {
  id: string
  shortName: string
  isCircle: boolean
  sortOrder: number
  /** Degrees on the colour wheel; lightness and chroma come from the theme. */
  hue: number
  directions: DirectionSummary[]
}

export interface RouteDirection extends DirectionSummary {
  stopIds: string[]
}

export interface RouteDetail extends Omit<Route, 'directions'> {
  directions: RouteDirection[]
  shape: [number, number][]
}

export interface Stop {
  id: string
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
  headsign: LocalizedName
  times: string[]
}

export interface StopDetail extends Stop {
  schedules: StopSchedule[]
}

export interface Vehicle {
  id: string
  routeId: string
  shortName: string
  hue: number
  lat: number
  lon: number
  /** Null when we cannot tell — upstream reports -1 for most of the fleet. */
  direction: Direction | null
  heading: number | null
  speedKmh: number | null
  /** False once it has been parked long enough to be off duty, not just waiting. */
  inService: boolean
  standingSeconds: number
  seenAt: string
  movedAt: string
}

export interface ArrivalEstimate {
  minutes: number
  /** The instant to count down to, so the number ticks between polls. */
  arrivesAt: string
  confidence: 'live' | 'slow'
  vehicleId: string
  distanceMeters: number
  stopsAway: number
}

export interface Arrival {
  routeId: string
  shortName: string
  hue: number
  direction: Direction
  /** Where this direction ends up — what a rider actually navigates by. */
  headsign: LocalizedName
  scheduledTime: string | null
  scheduledMinutes: number | null
  scheduledAt: string | null
  /** Ours, derived from live positions — never presented as a published time. */
  estimate: ArrivalEstimate | null
}
