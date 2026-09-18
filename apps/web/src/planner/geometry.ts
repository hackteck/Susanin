import { metresBetween, type LatLon } from './geo.ts'

/**
 * The stretch of a route's line between two distances along it, as the map
 * draws it. `along` comes from the API's own match of each stop to the shape,
 * and both sides measure the shape with the same haversine, so the cut lands
 * where the server placed the stop rather than on the nearest vertex.
 */
export function sliceLine(shape: [number, number][], from: number, to: number): [number, number][] {
  if (shape.length < 2 || to <= from) return []

  const point = (index: number): LatLon => ({ lat: shape[index]![0], lon: shape[index]![1] })
  const cut: [number, number][] = []
  let travelled = 0

  for (let index = 1; index < shape.length; index++) {
    const start = travelled
    const length = metresBetween(point(index - 1), point(index))
    travelled += length
    if (travelled < from) continue
    if (start > to) break

    const at = (distance: number): [number, number] => {
      const t = length ? Math.min(1, Math.max(0, (distance - start) / length)) : 0
      const [lat1, lon1] = shape[index - 1]!
      const [lat2, lon2] = shape[index]!
      return [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t]
    }

    if (!cut.length) cut.push(at(from))
    if (travelled <= to) cut.push(shape[index]!)
    else {
      cut.push(at(to))
      break
    }
  }

  return cut
}
