# Timetable

Upstream gives each stop a bare list of `"HH:MM"` times. In every direction,
every stop carries the same number of times, and the k-th time always increases
along the route. So the k-th entries are the k-th trip (`domain/schedule.ts`,
`inferTrips`). A direction is then one set of offsets plus the departures from
its first stop.

## Impossible times

Checked against the route lines, some intermediate times cannot be real:

- Route 8 inbound runs 38 stops and 13.8 km in 3 minutes.
- Route 12 outbound runs 34 stops in 8 minutes.
- Routes 6, 10A and others have stretches at 108–186 km/h.

These are repaired when the network is built:

- **If a trip averages over 45 km/h end to end**, its intermediate times are
  recalculated from distance, at the network's median scheduled speed (19.6 km/h,
  measured on each build).
- **Otherwise, times are only ever pushed later**, and only far enough to keep
  every stretch under 60 km/h. A 2-minute allowance absorbs whole-minute
  rounding. With less, seven directions got a one-minute "correction" that was
  only rounding.
- **The first stop's times are never changed.**

Three directions are recalculated and seven are capped. Repaired times are
flagged (`StopSchedule.estimated`, `Arrival.scheduledEstimated`) and shown with
`≈`, on the stop page and the arrival board alike. Directions upstream got right
keep its strings exactly. `network.test.ts` checks both.

## Missing times

Seven route-directions publish no times at all: 22, 26, 33, 35 and 37 in both
directions, and 7 and 7A inbound. Their buses do run. The trip planner doesn't
read departure times, so it isn't affected.
