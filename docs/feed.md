# The feed

## The dataset (`getDbData`)

It holds 578 stops, 28 routes and 80,568 departure times.

- **Stops**: `BusStopIdGeoGps` (a Mongo ObjectId), `BusStopNumber` (the code
  painted on the pole), Georgian and "English" names, coordinates, and
  `routes[routeId] = { Status, Order, times }`.
- **`Order` runs across both directions.** Route 2 is 1–50 outbound, then 51–91
  inbound. Split by `Status` (1 = out, 2 = in) and sort by `Order` to get each
  direction's chain of stops.
- **`routesNames`**: the line number, `RouteIsCircle`, `RouteSortOrder`.
- **`routeCoordinatesGrouped`**: one line per route covering the whole round
  trip. The first and last points are within 20 m of each other. There is no
  geometry per direction.
- **`routeStatusInfo`**: the terminals of each direction. We use it only to name
  headsigns.

## Positions (`getBusLocsOnRoute`)

Each vehicle is `{ Lat, Lon, Status, Name }`. `Name` is the licence plate and
stays stable, so it is the vehicle id. The feed sends no heading, speed or
timestamp. We derive heading from consecutive samples (`domain/vehicles.ts`), so
a bus seen only once has no heading yet.

## Where it is wrong

- **`Status` is -1 for about nine buses in ten.** At 23:52 it was -1 for 137 of
  152 vehicles; re-measure at midday before drawing conclusions. If anything
  that isn't 2 is read as outbound, most buses land on the wrong leg. So
  direction is inferred from geometry (`inferDirection`): we project the bus onto
  each direction's stretch of the line and keep the one that is close and points
  the way the bus is moving. A bus with no heading gets `null`. A real 1 or 2
  from upstream is still trusted.
- **Route lines are stored in an arbitrary frame.** Some are drawn backwards, and
  some are closed loops that start halfway round. `alignToChain` tries every
  candidate and keeps the tightest fit. A test caught this: route 12's inbound
  stops had been matched 7.4 km from where they belong, so that direction never
  showed an arrival.
- **A bus in the feed is not necessarily running.** Buses that have finished for
  the day keep reporting. `inService` turns false after 10 minutes without
  moving, with 2 minutes' grace for a bus we have only just seen. Parked buses
  are drawn dimmed, not hidden, and are left out of bus counts and arrival
  estimates.
- **A silent feed doesn't mean the fleet has stopped.** After one missed poll the
  markers stay where they were. After three in a row they are cleared, and the
  header says «Нет живых данных».
- **After about 20:00, every route returns `[]`.** That is correct, because the
  fleet has stopped. To see live buses in the evening, point `UPSTREAM_BASE` at
  `tools/stub-upstream.mjs`. It serves the real dataset with synthetic buses
  that drive the real route lines and report `Status: -1`. Never deploy with it.

## What the feed doesn't have

There are no arrival predictions, no trip ids, no per-weekday service (one
timetable covers every day), no occupancy, no fares, no alerts and no
accessibility data. Don't build UI that implies any of them.
