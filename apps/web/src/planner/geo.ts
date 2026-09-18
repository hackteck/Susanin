export interface LatLon {
  lat: number
  lon: number
}

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle metres. The one haversine in the app — every distance a reader sees comes from here. */
export function metresBetween(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}
