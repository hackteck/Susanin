// Mirrors @susanin/api's public model. Hand-written rather than shared through
// a package: two apps deployed together are not a reason to invent a third.

/** Russian and English are OpenStreetMap's where it has them; transliteration is the fallback — see the API's names.ts. */
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
  /** Metres along `shape` for each stop — where to cut the line between two of them. */
  along: number[]
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
  /** Ours, not upstream's: the published times here are physically impossible. */
  estimated: boolean
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
  /** The scheduled time is our repair of an impossible published one. */
  scheduledEstimated: boolean
  /** Ours, derived from live positions — never presented as a published time. */
  estimate: ArrivalEstimate | null
}

/**
 * One direction's timetable as trips: the time at stop i of a trip is its
 * departure plus `offsets[i]`, in minutes after midnight in Batumi.
 */
export interface TimetablePattern {
  routeId: string
  direction: Direction
  stopIds: string[]
  offsets: number[]
  /** Empty when the line publishes no timetable — then only ride times are known. */
  departures: number[]
  /** Per stop: the time is our estimate, not upstream's. */
  estimated: boolean[]
}
