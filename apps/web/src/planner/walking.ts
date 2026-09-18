/**
 * How long a walk takes, from nothing better than a straight line.
 *
 * There is no pedestrian graph here and no routing service behind the app, so
 * a walk is the straight-line distance scaled by how much longer Batumi's
 * streets make it. Both numbers are measured, not assumed: 30 stop pairs from
 * 150 m to 1.5 km apart, routed on foot over OpenStreetMap (FOSSGIS's OSRM),
 * came out a median 1.25× the straight line (quartiles 1.17 and 1.37 — short
 * hops across a road run highest), at the router's own effective pace of
 * 75 m a minute. The river, the rail line and the port are why the tail is
 * long, and why the UI still says a distance is straight-line.
 */
export const CIRCUITY = 1.25
export const METRES_PER_MINUTE = 75

/** Street metres for a straight-line distance. */
export const walkingMetres = (straightMetres: number) => straightMetres * CIRCUITY

/** Minutes on foot for a straight-line distance, unrounded. */
export const walkingMinutes = (straightMetres: number) => walkingMetres(straightMetres) / METRES_PER_MINUTE
