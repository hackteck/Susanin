# Susanin

Live bus tracking for **Batumi, Georgia** — 28 routes, 578 stops, and every bus
currently on the road, on a map that updates every five seconds.

A Node/TypeScript API of our own in front of Batumi's live bus data, and a
Vue 3 frontend built entirely from the [surstromming](https://github.com/hackteck/surstromming)
component library, consumed from npm.

> **Unofficial.** This project is not affiliated with Batumi City Hall, with
> Batumi Avtotransporti, or with any transport operator. It is an independent
> client. Arrival times shown here are computed by this software and are not
> official predictions — see [What the data is, and isn't](#what-the-data-is-and-isnt).

## Running it

```bash
npm install
npm run dev          # API on :8787, web on :5173 (Vite proxies /api)
```

Nothing to configure — every setting has a working default. See `.env.example`
for what can be changed and why.

```bash
npm run build        # typecheck both apps, build the SPA
npm run typecheck
npm test             # node --test — no framework, no config
```

The tests cover the API, where being wrong is invisible: map-matching a bus to
the right leg of its route, transliterating a name without leaving Georgian
behind, publishing a countdown that counts down. They run against the real
upstream through `app.fetch`, so there is no server to start — and they skip
with a reason rather than failing when the fleet has stopped for the night.

The UI is verified by looking at it. See `CLAUDE.md` for why the line is drawn
there.

## What it does

- **A live map** of every bus running, with the route number on each and a nose
  showing which way it is pointing. Filter to the routes you care about.
- **Arrival countdowns** that tick down second by second and never count up,
  with the scheduled time beside them.
- **Nearby stops**, sorted by distance, with a walk time.
- **Search** by the number on the pole or by name — in Russian, Georgian or
  English, whichever you happen to type.
- **Timetables that work offline.** Install it, and the schedules, routes and
  stops stay readable with no signal. Live positions do not, and the app says so
  rather than showing you a bus that is not there.
- Russian, Georgian and English; light and dark.

## Layout

```
apps/api    @susanin/api — Hono. The only thing that talks upstream.
apps/web    @susanin/web — Vue 3 + Vite SPA. Talks only to our own API.
api/        Vercel entry point; mounts the same Hono app.
```

## Deploying

Pushing to `master` runs `.github/workflows/vercel.yml`: typecheck and tests
first, then Vercel's prebuilt flow, then a curl of `/api/health` on the new
deployment — because the static frontend will happily ship while the API
function is broken.

It needs one secret, `VERCEL_TOKEN`, and no environment variables. Two settings
worth reading `CLAUDE.md` about before changing: the function's `maxDuration`
has to stay above `UPSTREAM_TIMEOUT_MS`, and the project's region should be set
near Georgia rather than left at US East.

`.github/workflows/build-android.yml` wraps the same build with Capacitor into
an installable APK. Run it manually and give it the deployed API's absolute URL
— a packaged app has no origin of its own to serve `/api` from.

## Endpoints the frontend uses

These exist for this app's own SPA. They are not a stable public API and not a
licence to redistribute the underlying data — the data is not ours to license.

```
GET /api/health                 liveness, and whether upstream is answering
GET /api/routes                 all routes, sorted, each with its terminals
GET /api/routes/:id             + both directions' stop chains and the shape
GET /api/stops                  all stops (optionally ?bbox=south,west,north,east)
GET /api/stops/:id              + this stop's timetable, per route and direction
GET /api/stops/:id/arrivals     next scheduled departures and live estimates
GET /api/vehicles?routes=a,b    live positions; omit `routes` for the whole city
```

Ids are opaque strings. Names come back as `{ ka, en, ru }` — Russian is a
transliteration of the Georgian, since seven stops in ten have no Latin name. A
route carries a `hue` rather than a colour, so the client's theme decides how
dark it is. An arrival carries `arrivesAt` as an instant, not just a minute
count, so the client can count down against it.

## What the data is, and isn't

Batumi has **no GTFS feed** — not in the Mobility Database, not in Transitous,
nowhere — and neither the city nor the operator publishes an open transit API or
any arrival predictions.

What does exist is an **undocumented JSON service** that also backs a third-party
mobile app, giving the network, the timetables, and raw bus positions. This
project reads it. There is no agreement, no API key and no published terms
behind that access, which is the single most important thing to understand
before depending on this app or forking it: **the source can change or close at
any time, and it is not ours.** `CLAUDE.md` says where it is and how it was
found.

So this app derives what the feed doesn't provide:

- **Arrival estimates** are computed by projecting each bus onto its route's
  polyline and measuring the distance it still has to run, plus a dwell for each
  stop on the way and any time the bus has already spent standing still. They
  count down second by second, never upward, and are labelled as estimates
  everywhere they appear with the scheduled time beside them.
- **Heading and speed** come from watching a licence plate move between
  samples; upstream sends neither.
- **Direction** is inferred from geometry, because upstream's own `Status` field
  reports -1 for about nine vehicles in ten.
- **Whether a bus is running at all** — the feed keeps reporting vehicles that
  finished hours ago, so anything that has not moved for ten minutes is drawn
  dimmed and excluded from the counts and the estimates.
- **Russian stop names**, transliterated from the Georgian at build time.

And it does not pretend to have what nobody has: no per-weekday timetables (the
source keeps one schedule for every day), no occupancy, no service alerts.

`CLAUDE.md` records how the data source was found, what was ruled out, and why
the upstream is called the way it is — read it before changing anything about
how this app fetches.

## Load discipline

The upstream is a small service that owes us nothing. It serves the 1.27 MB
dataset **uncompressed** and exposes positions only per-route, so "show every
bus" is 28 requests. Every upstream call therefore goes through one TTL cache
with single-flight, so a hundred simultaneous viewers of one server cost one
upstream request per route per interval; failures are cached too, so an outage
costs less than healthy traffic rather than more.

**That bound is per process, not global** — on Vercel each serverless instance
holds its own cache, so the raw ceiling is multiplied by however many instances
are warm. The shared cache that fixes it is the CDN: every response carries
`s-maxage` matching its own TTL, so one origin response answers every viewer in
a region for that window however many instances exist. The live routes used to
send `no-cache`, which meant every poll of every open tab reached a function.
`max-age=0` keeps the browser out of it, because a bus the browser kept is the
one that would actually be stale.

What that cannot help with is a cold instance fetching the 1.27 MB dataset. If
this ever takes traffic that makes *that* hurt, the fix is to stop being
serverless — `apps/api/src/server.ts` already mounts the same app for a
long-running process, so it is a deploy change rather than a rewrite.

Please keep it that way.

## Credits

Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

Copyright © 2026 Evgeniy Mnatsakanov. GPL-3.0-or-later — see [LICENSE](LICENSE).
