# Trip planning

The planner runs in the browser (`apps/web/src/planner/`: plain TypeScript,
tested with `node --test`). That means two things. The reader's position never
leaves the device. And once `/api/timetable` has been cached, a plan works with
no signal. That file is 9.5 KB gzipped: each direction's stops, its offsets and
its first-stop departures. It is fetched when a trip field is first focused. A
route's detail carries each stop's `along` (its distance along the route line),
so the map can cut out just the stretch a ride uses.

## Plans follow where the lines go, not the timetable

The first planner was RAPTOR over the published departures, and it gave answers
no rider would recognise. Seven directions publish no times at all. So from
School №13 to Horizon 1 it never offered line 7 or line 10, the two any rider
would name. Buses come often; the question at a kerb is *which line from which
pole*, and when the next one comes is the live feed's job.

- **A line is its chain of stops.** A ride is timed by distance: the straight
  hops between stops × **1.08** (the median ratio against the real route line,
  across 53 directions), at **19.6 km/h** (the network's median speed). Every
  duration is an estimate, shown with `≈`, and leaves out the wait.
- **A bus drives on through its terminal.** Each direction continues into the
  other when the other starts within **600 m** of where it ends; the two ends of
  a route are 9–531 m apart. Such a step says «Не выходите на конечной». Without
  this, School №13, the first stop of line 7's short inbound leg, led nowhere.
- **Walking is measured, not assumed.** Over 30 walks of 150 m to 1.5 km, routed
  on OSM paths (FOSSGIS OSRM), the median was **1.25×** the straight line, at
  **75 m a minute** (`planner/walking.ts`). Walks are drawn as dotted straight
  lines.
- **Reach:** stops within 1.2 km. Only when there is none, the nearest three
  within 3 km. Offered beside a stop that was close, a stop 2.6 km away turned a
  trip to Sarpi into a bus plus a 44-minute walk. Walking the whole way is
  offered when it takes under an hour.

## Options

- **One option per sequence of lines:** the best direct ride on each line, the
  best pair with one change (at most 400 m on foot between them), and three buses
  only when fewer won't do.
- **Score:** time, plus 5 minutes' wait for each bus and 5 more for each change,
  with walking counted at 1.5×. Anything over 1.5× the best is dropped, but the
  best bus option always stays beside a faster walk.
- **Rough estimates don't decide by a hair.** An option is dropped only when
  another is clearly better: 2 minutes faster, one bus fewer, or 2 minutes less
  walking.
- **Lines that make the same ride are one option**, such as «10 / 10A»: same
  pole on, same pole off, about as long.
- **The boarding stop is the one with the cheapest walk plus ride.**
- **Speed:** 6 ms per plan at the median and 10 ms at p90, over 40 random pairs.

## Live and stable

- **Each option shows its first bus** from one live poll of the stops the options
  board at (`useArrivalsAt`). It says «Сейчас не видно» when the feed answered
  with nothing coming. A stop that hasn't answered shows nothing, because "can't
  see" is not "none coming".
- **Always from now.** Depart-at and arrive-by were removed: nobody changed them,
  and everyone had to read past them. A plan changes only when an end changes.
- **The chosen option is tracked by its lines**, not its position in the list.
  "My location" only moves after 50 m, so GPS jitter doesn't reshuffle options.
- **The map fits the trip whenever it changes**, measured from the laid-out
  sheet.
