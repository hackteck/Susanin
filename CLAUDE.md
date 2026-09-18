# Project decisions & requirements

**Susanin** — a live bus-tracking web app for **Batumi, Georgia**. A Node/TypeScript
API of our own in front of the city's real-time bus feed, and a Vue 3 frontend
built entirely from the **surstromming** component library, consumed from npm.

Named for Ivan Susanin, who was famously good at leading people somewhere.

## Repo layout

- **npm workspaces**, two apps:
  - `apps/api` — `@susanin/api`, Hono on Node. The only thing that talks upstream.
  - `apps/web` — `@susanin/web`, Vue 3 + Vite SPA. Talks only to our own API.
- The frontend consumes `@surstromming/*` **from npm**, exactly as any consumer
  would. It does not vendor, fork or alias them.

## The data source

This took a six-angle search to settle, so the conclusions are written down
rather than re-derived.

- **Batumi is not on the Georgian `pis-gateway` platform.** That platform
  (`transit.ttc.com.ge/pis-gateway/api/{v2,v3}`, header `X-api-key`) is real,
  live and complete — and it serves **Tbilisi only**. It is single-feed, not
  multi-tenant: no `?city=`, no tenant header, `/agencies`, `/feeds` and
  `/cities` all 404, every stop id carries the one feed prefix `1:`, and the
  vendor's own per-city asset tree has `tbilisi/`, `kutaisi/` and `rustavi/`
  branding but **no `batumi/`**. Every plausible Batumi tenant hostname is
  NXDOMAIN. Don't re-probe it.
- **No GTFS exists for Batumi.** Not in the Mobility Database (3513 feeds; the
  single `GE` row is Georgian Railway), not in Transitous, not anywhere. A live
  MOTIS query over the Batumi bounding box returns four stops, all rail. So
  there is no standards-based feed to consume and none to publish against.
- **The two existing Batumi bus apps are dead backends.**
  `crm.geogps.ge/batsite/engine/engine.php` (com.thatapp.batumibus) serves a
  styled 404; `bus.kosourov.ge/get-routes` serves its hosting panel's default
  page. Both apps still ship on the stores. Don't chase them.
- **What is live** is a .NET/IIS + MongoDB service behind two JSON endpoints,
  found by extracting the string table from the `world.newdigital.getbus` APK:

  ```
  https://thetamaps.site:54321/api/getDbData
  https://thetamaps.site:54321/api/getBusLocsOnRoute?routeId=<RouteIdGeoGps>
  ```

  It is **the origin**, not a proxy — `X-Powered-By: ARR/3.0`, its own
  `Cache-Control` (`max-age=600` for the dataset, `max-age=4` for positions),
  and a payload byte-identical to what the one community proxy in front of it
  returns. Its TLS validates, so `fetch` needs no special handling.
  One layer deeper sits an internal service that these two endpoints front; it
  is firewalled off from the public internet and we have no use for it, so its
  address is deliberately not recorded here.
- **We call the origin, never the community proxy.** A public Cloudflare Worker
  (`bus-proxy.raf003771.workers.dev`) mirrors both endpoints and is what the
  community PWA uses. It is one person's free-tier account. Building on it would
  spend a stranger's quota — 1.27 MB per dataset call — for nothing we can't get
  ourselves. `UPSTREAM_BASE` can be pointed at it as an emergency fallback; that
  is the only reason it is mentioned in the code.
- **Load discipline is a requirement, not an optimisation.** The origin is a
  small municipal-contractor box, the dataset is 1.27 MB **uncompressed** (it
  serves no gzip), and positions exist only per-route — "show every bus" is 28
  upstream calls. Every upstream request therefore goes through one TTL cache
  with **single-flight** (`lib/cache.ts`), so a hundred simultaneous viewers
  cost one upstream request per key per TTL. Never call upstream from a request
  handler directly.

  **Failures are cached too**, briefly. Caching only successes is the trap: an
  outage then costs *more* than healthy traffic, because every poll re-tries all
  28 routes and the fetch helper retries each of those again — measured at 56
  upstream requests per five-second poll against a healthy ceiling of 28 per
  four. `cache.test.ts` guards it.

  **That ceiling is per process**, because the cache is a module singleton — on
  Vercel each warm instance has its own, so the real bound is multiplied by
  however many are running.

  **The shared cache that fixes it is the CDN, not a database.** Every response
  now carries `s-maxage` matching its own TTL, so one origin response answers
  every viewer in a region for that window whatever the instance count. The live
  routes used to send `no-cache`, which meant every poll of every open tab
  reached a function — the 28-way fan-out included — and measured on production,
  `/api/vehicles` was `X-Vercel-Cache: MISS` every single time while
  `/api/routes` was already collapsing to `HIT`. `max-age=0` keeps the *browser*
  out of it, which is the only place a genuinely stale bus could come from;
  Vercel strips `s-maxage` before the response reaches it, so one header serves
  both. `app.test.ts` guards the pair, and it was checked by putting `no-cache`
  back and watching it go red.

  `fluid: true` in `vercel.json` belongs to the same problem rather than to
  billing: fluid compute lets one instance serve concurrent requests, so there
  are fewer instances and therefore fewer duplicate caches. It is the default for
  new projects and is stated anyway, because here it is load-bearing.

  What remains after that is a cold instance fetching the 1.27 MB dataset once
  per TTL, which the CDN cannot help with. If this ever takes traffic that makes
  *that* hurt, the fix is to stop being serverless — `apps/api/src/server.ts`
  already mounts the same Hono app for a long-running process, so it is a deploy
  change and not a rewrite, and one process means the bound above becomes
  literally true. A shared KV cache is the obvious-sounding answer and the wrong
  one: at a four-second TTL it adds a network hop and a second failure mode to do
  a job the CDN already does for nothing.

### What the feed does and does not give us

`getDbData` (578 stops, 28 routes, 80,568 departure times) gives:

- **stops** — `BusStopIdGeoGps` (Mongo ObjectId), `BusStopNumber` (the physical
  code painted on the pole), `BusStopNameKA`, `BusStopNameEN`,
  `BusStopLatitude`/`Longitude`, and a `routes` map.
- **`routes[routeId]`** on each stop — `Status` (1 = outbound, 2 = inbound),
  `Order`, and `times` (the day's scheduled departures, `"HH:MM"`).
  **`Order` is one sequence across both directions**, not per direction:
  route 2 runs 1..50 outbound then 51..91 inbound. Splitting on `Status` and
  sorting by `Order` is what yields each direction's stop chain.
- **`routesNames`** — `RouteNameKA`/`EN` (both just the line number),
  `RouteIsCircle`, `RouteSortOrder`.
- **`routeCoordinatesGrouped`** — one polyline per route. It is the **whole
  round trip**, not per direction: first and last point coincide (measured
  0.00–0.02 km apart on every route). There is no per-direction geometry.
- **`routeStatusInfo`** — per direction, the `lowestId`/`highestId` stop, i.e.
  the terminals. Redundant with `Order` and used only to name headsigns.

`getBusLocsOnRoute` gives `{ Lat, Lon, Status, Name }` per vehicle — `Name` is
the licence plate and is stable, so it is the vehicle id.

**The polylines are stored in an arbitrary frame.** Some are drawn against the
direction of travel; some are closed rings whose stored start sits halfway round
the cycle. Both have to be corrected before a stop chain can be matched to the
line, and `alignToChain` does it by trying each candidate and keeping the
tightest fit rather than by guessing what upstream "usually" does. Rotation was
found by a test, not by inspection: route 12's outbound leg was consuming the
line all the way to its last vertex, leaving every inbound stop pinned to the end
**7.4 km** from where it belonged — so that direction could never offer an
arrival time at all, and nothing on screen said so.

**`Status` is mostly a lie, and this matters more than anything else here.** It
is documented as 1 = outbound / 2 = inbound, and measured across the whole fleet
at 23:52 it was **-1 for 137 of 152 vehicles (90%)**. Reading it as a number and
letting anything that isn't 2 mean "outbound" — which is what the obvious code
does — puts nine buses in ten on the wrong leg, and the arrival board then has
nothing to offer anyone travelling the other way. So direction is **inferred
from geometry**: project the bus onto each direction's stretch of the shape and
keep whichever is both close and pointing the way the bus is going
(`vehicles.ts`, `inferDirection`). A bus with no heading yet gets `null`, which
is the honest answer and also describes a bus that is not moving and therefore
predicts nothing. Upstream's `Status` is still trusted when it actually says 1
or 2. *(The 90% figure was measured late at night, when most of the fleet is
parked; re-measure at midday before drawing conclusions about what -1 means.)*

**A reported bus is not a running bus.** The feed keeps reporting vehicles that
have finished for the day. `inService` is false once one has not moved for ten
minutes, with a two-minute grace for a bus we have only just met. Parked buses
are drawn dimmed rather than hidden — they exist — but they are excluded from
"N buses running" and from every arrival estimate.

**A feed that has stopped answering is not a fleet that has stopped moving.**
One dropped poll keeps the markers where they were — the next poll is five
seconds away. Three in a row clears them, and the header says «Нет живых
данных» instead of a count, because a bus drawn from a dead feed looks current,
which is the one thing this app promises not to do. The arrival board already
said so for itself; the map and the header used to keep a frozen fleet and a
green dot for as long as the outage lasted.

**After about 20:00 the feed returns `[]` for every route.** The fleet stops and
so does the data. That is correct behaviour, not an outage, and it means live
markers and countdowns cannot be verified in the evening. For that,
`tools/stub-upstream.mjs` serves the real dataset with synthetic buses
walking the real polylines (reporting `Status: -1`, so the inference is
exercised rather than bypassed); point `UPSTREAM_BASE` at it. **Never leave a
deployment pointed there.**

**The timetable is trips, and ten of its directions are physically impossible.**
Upstream publishes each stop's times as a bare list, but measured across the
network every stop of a direction carries the same count, the k-th time always
increases along the chain, and every trip keeps one running-time pattern — so
the k-th entries *are* the k-th trip, and a direction is one set of offsets plus
its first stop's departures (`domain/schedule.ts`, `inferTrips`). Measured
against the matched shapes, though, the intermediate times are not all real:
route 8 inbound runs 38 stops and 13.8 km in **three minutes**, route 12
outbound 34 stops in eight, and route 6, 10A and others have four-minute
stretches at 108–186 km/h. Those are repaired when the network is built and the
repair is written back into the stop schedules, so the stop page, the arrival
board and the journey planner give one time for one bus:

- a pattern averaging over **45 km/h** end to end (the same ceiling arrivals.ts
  clamps a measured speed to) has no usable intermediate times, and they are
  re-derived from distance at the network's own median scheduled speed
  (**19.6 km/h**, measured each build off the plausible patterns);
- otherwise a hop is only ever pushed *later*, and only as far as it takes to
  get under **60 km/h** between any two stops — generous, because the suburban
  lines do run on highway — with two minutes of slack for the whole-minute
  rounding at both ends. Less slack and seven directions picked up a one-minute
  "correction" that was only rounding.

The first stop is never touched; its departures are the ones the rest of the
data agrees with. Three directions are re-derived and seven capped, and each
repaired time is flagged (`StopSchedule.estimated`, `Arrival.scheduledEstimated`)
and shown with a `≈`. Directions upstream got right keep their published strings
byte for byte, and `network.test.ts` asserts both halves — each guard was broken
on purpose to watch it go red.

Seven route-directions publish **no times at all** — 22, 26, 33, 35 and 37 both
ways, and 7 and 7A inbound — though their buses run (route 33 had one live at
midday). They still get distance-derived ride times, so the planner can offer
them, but apart from the timed options and labelled as having no timetable.

**What is missing, and what the app must therefore not promise:**

- **No arrival predictions.** The feed has live GPS and a static timetable and
  nothing in between. Any "N minutes away" figure is **ours**, derived by
  projecting the vehicle onto the route polyline and measuring the remaining
  distance to the stop. It is labelled as an estimate everywhere it appears, and
  the scheduled time is always shown beside it.

  Five rules make that number honest rather than merely plausible, and each one
  exists because the naive version is wrong in a specific way:

  1. **It counts down, never up.** The API publishes `arrivesAt` as an instant
     and the client ticks against a shared one-second clock, so the figure moves
     between polls instead of standing still and then jumping. A revision that
     brings the bus *closer* is adopted at once — good news never made anyone
     miss a bus — while a worse one is eased in at α = 0.25 (`ratchet`).
  2. **Stops between here and there cost time.** A bus covering 2 km through
     eight stops is not doing 20 km/h for six minutes; each intervening stop
     adds a dwell.
  3. **Standing still is added, not modelled away.** The 10 km/h speed floor
     otherwise insists a stationary bus is still covering 167 m a minute. Time
     already spent stopped is added back, and past five minutes the estimate is
     withdrawn entirely.
  4. **A bus that has passed is not an arrival.** The distance is deliberately
     *not* measured round the loop. Batumi's routes are there-and-back, and
     letting the measurement wrap turns "it left a minute ago" into "arriving in
     40 minutes" — the same vehicle on its next run, and not the question anyone
     standing at the pole is asking.
  5. **Legs whose geometry doesn't hold up publish nothing.** Where the shape
     and the stop chain disagree — median stop-to-line distance over 120 m,
     against 5 m typical across the real network — distance along the line is
     not a quantity worth dividing by a speed.

  Uncertainty is one glyph: a `≈` for a bus we can see but cannot time — either
  because it is barely moving, or because we have not watched it long enough to
  have a speed for it yet. A ± range would need a measured error distribution we
  do not have, and inventing one would look like calibration while communicating
  nothing. Measured at midday with the tracker warm, **20%** of estimates carry
  the mark; a freshly started process marks all of them until it has seen the
  fleet move, which is worth remembering on serverless where every cold instance
  starts blind.
- **No heading, no speed, no timestamp** on a vehicle. Heading is derived
  server-side from consecutive samples, which is why vehicle polling keeps state
  (`domain/vehicles.ts`); a vehicle seen once has no heading and the marker must
  render without one.
- **No trip ids, no per-day service.** One timetable, every day. Don't render a
  weekday selector.
- **No occupancy, no fares, no alerts, no accessibility flags.**

### Names, and three locales

`BusStopNameKA` is clean Georgian. `BusStopNameEN` is only genuinely Latin for
**171 of 578** stops — the rest repeat the Georgian, often prefixed with the
stop number (`"1963 ბათუმის ყინულის არენა"`). Normalisation therefore strips a
leading stop number, trims and collapses whitespace, drops a dangling `№` whose
number was never entered, and falls back to the Georgian when the "English" name
isn't Latin.

**Russian is the default locale.** Batumi's visitors and a large share of its
residents read it; a browser that says `ka` or `en` still gets its own language.
The UI strings are translated properly, including the three plural forms Russian
needs — `Intl.PluralRules` picks the category, because «5 автобуса» is exactly
what a cheap translation looks like. The count is not the only thing a noun has
to agree with: the header counts buses across whatever is selected, so it is
«на линии» for one route and «на линиях» for several or for none, which is all
28. Georgian inflects the same way (`ხაზზე`/`ხაზებზე`) and English needs no line
noun at all to say it. Numbers follow the locale as well — «2,6 км», through
`Intl.NumberFormat` — because a decimal point there reads as a typo in exactly
the two languages most readers use.

The names are the harder half. Seven stops in ten (407 of 578) have no Latin
name at all, so
a Russian reader would otherwise see Georgian script for the stop they are
standing at. **Names come from OpenStreetMap, and transliteration is only the fallback.** This
was the second attempt. Sounding a name out gets a reader to the right syllables
and the wrong words: `ანდრიაპირველწოდებული ქუჩა` came out «Улица
Андриапирвелцодебули», where the street sign, Yandex and Google all say «Шоссе
Андрея Первозванного». `იუსტიციის სახლი` came out «Иустициис Сахли» rather than
«Дом Юстиции». Neither is a phrase anyone could repeat to a driver.

OSM turned out to carry `name:ru` and `name:en` across Batumi, as translations
rather than transliteration, and `tools/build-names.mjs` bakes them into
`api/src/domain/names.data.json` — 176 street-level keys covering **578 of 578
poles**. The table is keyed by the street, not the pole, because the feed
distinguishes poles with a trailing house number and 578 poles share 176 names
once it is taken off; the number is put back afterwards, since it is how someone
standing there knows which pole they are at. That number is itself transliterated
for Russian: Batumi subdivides with a Georgian letter (`№3ა`), and appending it
raw left Georgian script inside a Russian string on 5 poles. The house-number
rule is anchored at the *end* — a leading `№23` is a school's number and part of
its name.

**The feed spells that number two ways** — `№3` and `#3`, the hash on 308 of the
578 — and the table is keyed the first way, because the build normalises it. The
lookup has to normalise the same way or a whole name never matches the table
directly: one pole writes `#1(ავტოსადგური)`, which the house-number rule then
read as a number, sounded out, and published as «Улица Святого Севериана Ачарели
№1(автосадгури)». That is Cyrillic, so the corpus guard that watches for Georgian
*script* never saw it, and it is Georgian all the same to the only reader who
matters. The guard for it asserts the whole name.

**OSM sometimes tags one Georgian name two ways, and the majority is not always
right.** The harvest keeps the spelling the most objects agree on, which is
correct when the disagreement is a typo and wrong when it is a translation
against a transliteration — the crowd is simply bigger on the older tagging.
Ways named `წმინდა სევერიანე აჭარელის ქუჩა` carry both «улица Цминда Севериане
Ачарели» and «улица Святого Севериана Ачарели»; the transliteration won on count.
`წმინდა` is the common noun "saint" — the feed abbreviates it `წმ.` exactly as
Russian writes `св.` — so it is the kind of word the table exists to translate,
and a hand entry says so. The same goes for a handful of names the feed
misspells: a loose or fuzzy match lands on a shorter OSM object and the app then
labels one street two ways depending on which pole the reader is standing at
(`Улица Леонидзе` beside `Улица Георгия Леонидзе`). Those are hand entries too,
and a test asserts the two spellings of each resolve to the same words.

`api/src/domain/translit.ts` is still there and still matters: it renders Georgian
into Cyrillic for anything OSM has never mapped, so a stop nobody has added does
not fall back to Georgian script. 33 letters, one pass, cached with the dataset.
It is **transliteration, not translation** — it collides the aspirated pairs
(თ/ტ → т, ქ/კ → к), which is fine for matching a name against a pole. The one
thing it does translate is a short list of nouns that recur across hundreds of
names: `ქუჩა` alone appears in **408 of 578**, so "улица" is what makes the rest
of the line parse as an address. It also moves the street type to the front as
Russian expects and drops the Georgian genitive `ს` left dangling by the move —
`ფრიდონ ხალვაშის ქუჩა` becomes `Улица Фридон Халваши`. Words outside the
dictionary are simply sounded out, which is readable but occasionally clumsy;
that is the accepted cost, not a bug to chase name by name.

Direction is **never** shown as "outbound/inbound" where a destination is
available. A rider navigates by where the bus is going, and every arrival row,
timetable block and direction tab says `→ terminal` instead. This also sidesteps
the fact that Russian has no natural short pair for the two directions of a route.

Georgian script needs a font that has it — **Geist does not**. The app loads
`@fontsource-variable/noto-sans-georgian` and overrides `--font-sans` to put it
after Geist, so Latin keeps Geist and Georgian glyphs resolve properly instead
of falling back to whatever the OS has. Overriding the custom property is the
design package's documented runtime escape hatch; the font *loading* is the
app's, not the library's.

## Frontend rules

**The surstromming CLAUDE.md is authoritative for all UI work.** It ships in the
[surstromming repo](https://github.com/hackteck/surstromming). Everything there applies here — SFC order,
`<style module lang="scss">` always, `:class` arrays/objects and never a `cn()`
joiner, `$style` in templates and `useCssModule()` named `$style` in script,
hyphenated dynamic class families, tokens only through `design.color()` /
`spacing()` / `radius()` / `screen()` / `z-index()`, mobile-first, no
`provide`/`inject`, `defineModel()` for two-way state, data-driven components
with slots as the escape hatch, no logic-heavy template expressions, and short
comments that explain a *why*.

App-level conventions mirrored from surstromming's own demo app:

- `main.ts` imports `font-list.scss` then `reset.scss`, runs `initTheme()`
  before mount, installs Pinia and the router.
- `App.vue` carries `@include design.layout(...)`; pages are routed into the
  `default` view and their sidebar into the named `sidebar` view.
- Pages lazy-load through `lazyPage()` inside `<Suspense>` with `PageLoader` as
  the fallback.
- App-wide state is a Pinia store (`stores/sidebar.ts`, `stores/toasts.ts`,
  plus this app's `stores/transit.ts`); one `Toaster` in `App.vue`.
- Theme is `data-theme` on `<html>`, dark token values in `public/globals.css`.

**The one deliberate deviation:** surstromming's rule that every page root is
`<ScrollArea as="main">` is a docs-site convention and is wrong for a map. The
map page's root is a plain `<main>` that fills the shell and clips
(`overflow: hidden`) — a map owns its own gestures and must not sit in a
scroller. Every other page keeps `<ScrollArea as="main">`.

**If a bug turns up in a surstromming package:** flag it, add
`../surstromming/packages/*` to this repo's root `workspaces` (npm resolves a
relative path across repos), fix it there, re-verify against the source, and
publish only after review. Don't patch around it in this app.

## Map

**Leaflet with a self-hosted Protomaps vector basemap.** No API key and no vendor
account, which was always the constraint — the earlier note here rejected vector
tiles because they "need a keyed provider", and that was right about *providers*.
The tiles are now our own file: `npm run basemap` cuts a 6.5 MiB `.pmtiles`
archive of the network's bounding box out of a pinned Protomaps planet build and
`protomaps-leaflet` renders it to canvas inside the same Leaflet map. Leaflet
stays, and so do all three of the lessons below.

The reason it is worth a tile pipeline at all is **language**. Raster OSM tiles
are labelled in Georgian and in nothing else, so a Russian reader — the default
locale, and most of this app's audience — got the UI in Russian and every street
name in a script they cannot read. Measured on the harvest: `name:ru` is present
on 1556 of 1556 named Batumi ways, `name:en` on 1554. `protomaps-leaflet` reads
`name:<lang>` and falls back to `name`, so `ru` and `en` get real translations
and `ka` gets the local name — which is what is painted on the sign, and
therefore the right answer rather than a missing one. Georgian glyphs render
because the app already loads Noto Sans Georgian and the renderer draws with
ordinary web fonts; no SDF glyph server, no font pipeline.

MapLibre is still rejected, now for a second reason: its styles hide scripts it
cannot shape, and Georgian is one of them.

Wikimedia's localized `osm-intl` tiles are not an option and should not be
re-probed — they are a hard **403 at the CDN** for anyone outside Wikimedia
projects, not a rate limit.

The dark map is now a real dark *flavor* rather than a CSS `invert(1)
hue-rotate(180deg)` over the tile pane, so the 28 route hues sit on it as the
colours they were chosen to be.

**There are two archives, and the second one exists because of a grey rectangle.**
The detail archive stops at the network's edge, which is right for the zooms where
stops and buses are drawn and wrong the moment anyone zooms out: at z11 a wide
screen asks for 1.76° of longitude against the network's 0.28°, and the surround
came out as a grey void. Restricting zoom-out instead was tried and rejected —
it is the whole-network view that gets lost, which on a bus map is the view that
shows a route end to end.

Widening is affordable only because of where the cost sits. Measured against the
same planet build: widening the *detail* cut at z15 to the overview's extent is
3,179 tiles against the network box's 796; a z0–13 overview of the surrounding
region is about 12 MB; **a z0–12 overview is 4.97 MB**. Nearly all of it is that
one zoom level, and the renderer overzooms — so z12 data draws z13 perfectly well
and the overview stops at 12. The pair is 11,984,003 bytes. The overview is
hidden from z14 up, by which point the detail archive covers any viewport on its
own, so the two never both rasterise a zoom anyone reads the map at.

**The network box has to contain the network.** It stopped at 41.55°N, and seven
stops lie south of that — route 16's terminus at Sarpi, route 33's on Ioane Lazi
Street, four on Andrew the Apostle Highway — so the ends of two lines could not
be centred at street zoom and had no detail tiles under them. It now runs
41.50–41.77°N, 2–3 km clear of the southernmost and northernmost stops, for
0.7 MB. The margin also bought the room a trip needs: `maxBounds` clamps every
move, a phone's sheet covers the bottom 60%, and at z12 a tall screen was as
tall as the old box, so a trip fitted above the sheet was pushed straight back
under it.

**State the map's `maxZoom` explicitly.** Leaflet falls back to the widest range
its *layers* declare whenever the map leaves one undefined
(`getMaxZoom` → `_layersMaxZoom`). The overview layer declares `maxZoom: 13` so it
stops drawing under the detail layer; with no ceiling of its own the map adopted
13 as *its* ceiling and everything past z13 became unreachable. The raster layer
used to supply this and took it with it when it went.

The archives are generated, gitignored and never committed; `tools/build-basemap.mjs`
is what is committed, it pins the planet build date, and it fails loudly rather
than shipping a file that is the right size and the wrong language — it decodes a
Batumi tile from each archive and asserts `name:ru` is really on the roads, with
a lower floor for the overview because a z12 tile carries the through-roads and
little else. It also writes `tiles/manifest.json`, which is what lets the browser
tell a current archive from last year's.

**Being generated makes it the one deploy input that can go missing quietly**, and
it did: a request for a tile that is not there falls through the SPA's catch-all
rewrite to `index.html`, so the reader gets `Wrong magic number for PMTiles
archive` over a blank map while every build step reports success. So `npm run
basemap` is part of `vercel.json`'s `buildCommand` rather than a step in one
workflow — that way the deploy workflow, a git-integration deploy and `vercel dev`
all get it — the Android workflow runs it before packaging, and both workflows
then read the first seven bytes of the built artifact and fail if they are not
`PMTiles`. A `predev` script does the same for a fresh clone, because the second
way to meet this error is to run `npm run dev` on a checkout that has never built
the tiles. The cost of generating rather than committing is that a deploy now
depends on `build.protomaps.com` being reachable; that is a loud failure, and
preferable to a 6.5 MiB binary in every diff. The map is
not a surstromming component and never will be — it's an app concern.

**A pinned planet build does not stay fetchable.** Protomaps' bucket keeps about
a week of daily builds — checked on 2026-09-18, the 12th and 15th–17th answered
and the 10th and 11th were 404 — so the `20260910` pin had already made every
clean build fail, and the next deploy would have failed with nothing in the repo
changed. Two things now stand between a pin's age and a broken release: both
workflows cache `.cache/basemap` and `public/tiles` keyed on the build script's
own hash, so an unchanged pin reuses the same bytes without asking Protomaps
anything; and when the pin has gone *and* nothing is cached, the script builds
from the newest build that still exists, annotates the run with both dates, and
records them in the stamps and the manifest. Freshness is judged against the
pin, so a dead pin costs one fallback build rather than a different map on every
deploy. Re-pin when the annotation appears.

Leaflet is imperative and owns its DOM subtree, so it is wrapped in exactly one
component (`components/map/TransitMap.vue`) that takes data as props and emits
intent, like any other data-driven component here. Nothing else in the app
imports `leaflet`.

Three things that component learned the hard way, all of them the same lesson —
Leaflet owns real DOM, and a declarative framework must keep its hands off it:

- **Never bind a reactive `:class` to the element Leaflet mounts into.** Leaflet
  adds `leaflet-container` and friends imperatively; a Vue class patch on the
  same element removes them. Measured: on the first zoom every tile kept its
  `src` and lost its width, so the map went blank while the markers stayed
  exactly where they belonged. The component is therefore two elements — an
  outer one Vue styles, an inner one Leaflet owns.
- **Never call `setIcon` to update a marker.** It replaces the DOM node, and a
  new node has no previous transform to animate from, so the CSS glide silently
  never fires and every bus teleports. Markers are created once and mutated
  (`--hue`, `--heading`, the label) thereafter.
- **Leaflet only re-reads its size on a *window* resize.** The sidebar
  collapsing is not one. A `ResizeObserver` on the container calls
  `invalidateSize`.

**"You are here" is two things in two panes, and the split is load-bearing.** The
accuracy halo is an `L.circle`, whose radius is in **metres** and therefore
scales with zoom; a `circleMarker`'s radius is pixels, which would claim 40 m of
accuracy at z18 and 4 km at z11. The dot is a marker rather than a circle,
because Leaflet's marker pane sits above the overlay pane unconditionally — as a
circle it could never clear a bus pill, and "which bus is nearest me" is the
question it exists to answer. The map itself never decides to fly: that was app
logic living in the component, and it is why the dot could only ever be centred
once — the old code refused a second fix by design, so panning away lost it for
good. The page now asks, through a `flyTo` prop carrying a nonce, which is what
lets it ask for the same place twice — and asks only for a fix near the network:
the map is held inside the box, so flying to a fix in Tbilisi, or to the 0°, 0°
a browser with no real position reports, stopped at the box's edge over open sea
and left the reader looking at water. The first fix is not flown to from there,
and the locate button says the reader is far from Batumi instead. On the map
page only, the fix is a
`watchPosition` that pauses with the tab and stops with the page: a dot beside a
live bus is a claim the app has to keep true, and a stale one is wrong in the
same way a cached bus would be.

The vehicle marker is a coloured pill carrying the route number — the number is
the bus's identity, and a generic glyph would say less — with a nose on its
leading edge for heading, and a bus glyph only once there is room for it
(zoom ≥ 16). Below zoom 13 it collapses to a dot, because a route number that
cannot be read is just clutter. Bearings are accumulated rather than wrapped, so
359° → 1° turns 2° forward instead of spinning 358° backward. Markers glide for
one full poll interval (`--glide`, wired from the store's `POLL_MS`) so a bus
moves continuously; the glide is dropped during a zoom, which rewrites every
transform at once. The cost is that a bus trails reality by up to a poll, which
is accepted: dead reckoning along the polyline would sail buses through red
lights and then snap them back.

Motion tokens live in `src/styles/_motion.scss`, along with the list of what
must **not** animate — the countdown may cross-fade but never slide, route
polylines never animate at all, and only the soonest live row pulses.

**The route selection is session state, and the bus pill is its undo.** It used
to be written to `localStorage`, which is the right call for the theme and the
locale and the wrong one here: a filter is not a preference. Reopening the app
on a phone the next morning restored a narrowing nobody remembered making, and
the failure is quiet — not an empty map but a plausible one, four buses instead
of forty, with nothing on screen saying the city is being hidden. It starts
empty every session now, and the stale key is simply left unread rather than
migrated away, since a `removeItem` for a build nobody runs any more would
outlive its reason by years.

Clicking a bus therefore has to be reversible by clicking it again: the pill is
the only undo the reader has a finger on, and having to find the sidebar to
clear a filter set by tapping the map is the worse trade. It is the **same
toggle the sidebar chip runs** — `toggleRoute`, not a map-only variant — because
two ways to pick a route that disagreed about what a second press does is worse
than either rule on its own. The accepted cost is that tapping a bus while
several routes are selected removes its line and takes that bus off the map with
it: `visibleVehicles` filters by the selection. One learnable rule is worth more
than sparing that one case.

A trip on the map narrows the live feed to the lines it rides, through a
separate `focusRouteIds` that takes precedence over the selection without
changing it, and the selection's own shapes step aside for the trip's. So while
a trip is shown, pressing a bus does nothing: it would toggle a selection the
reader cannot see, and they would find it changed when the trip is closed.

## Route colours

The feed has no route colours and 28 routes is far past the 5-step categorical
palette in `design`. So the **API assigns each route a stable hue** (an integer,
spread over the wheel by `sortOrder`) and the **frontend supplies lightness and
chroma from theme tokens** — `oklch(var(--route-l) var(--route-c) <hue>)`. One
number crosses the wire, the theme still decides how dark it is, and no colour
is hardcoded in a component.

## Our API

The frontend never sees an upstream shape. `GET /api/*`:

    GET /api/health                      liveness + upstream reachability
    GET /api/routes                      all routes, sorted
    GET /api/routes/:id                  route + both directions' stop chains + shape
    GET /api/stops                       all stops (optionally ?bbox=s,w,n,e)
    GET /api/stops/:id                   stop + per-route scheduled departures
    GET /api/stops/:id/arrivals          next scheduled times + live estimates
    GET /api/timetable                   every direction as trips, for the planner
    GET /api/vehicles?routes=a,b         live vehicles, heading derived

Cache TTLs: the dataset 10 minutes (upstream says 600), vehicles 4 seconds
(upstream says 4). Both are single-flighted. `/api/timetable` is 80 KB of JSON,
9.5 KB gzipped: a pattern is its stop ids, one set of offsets and its first
stop's departures, and a route detail's directions carry each stop's `along` so
a client can cut the line between two of them.

## Installable, and offline

The web app is a PWA (`vite-plugin-pwa`, Workbox). Installing it is not the
point — **the offline timetable is**. Standing at a pole in Batumi with one bar
of signal, the useful question is "when is the last bus", and that answer does
not need the network.

What is cached, and why each choice is deliberate:

- **The network** (`/api/routes`, `/api/stops`, `/api/stops/:id`,
  `/api/timetable`) — stale-while-revalidate, 14 days. It changes about once a
  year, so serving it from cache costs nothing and buys the whole offline story,
  trip planning included: verified with the network off, a plan comes back from
  the cached timetable while the header says there is no live data.
- **The address table** (`assets/places.data-<hash>.json`) — cache-first, and
  deliberately **not** precached: 192 KB for every visitor on install, most of
  whom only glance at the map, is the wrong trade, so it is kept from the first
  time a trip field fetches it. Its name carries a content hash, so cache-first
  can never serve a stale one. Verified with the network off: after one online
  visit, «аптека» still lists pharmacies.
- **The basemap archives live in IndexedDB**, keyed by the sha256 the build
  recorded rather than by their URL — the URL never changes, so a URL key would
  serve a year-old map forever, and a stale map is not a visible fault but last
  year's streets drawn with confidence. A first visit draws from the network
  exactly as before, because `protomaps-leaflet` range-requests the few kilobytes
  of directory and tile it needs rather than the whole file; the 11 MB is fetched
  afterwards, in the background, for next time — and skipped entirely when the
  connection reports `saveData` or 2g. Measured: a second visit fetches
  `manifest.json` (300 bytes) and nothing else, and still draws the map.

  Two honest limits. `navigator.storage.persist()` is asked for and frequently
  refused — Chrome and Safari decide silently from how much the reader uses the
  site, so a fresh profile gets "best effort" storage that is evictable under
  pressure (verified: `persisted()` returns false on a first visit). And WebKit
  deletes script-written storage after seven days with no interaction, so an
  iPhone user who opens this monthly re-downloads. Both are survivable because a
  miss just falls back to the network, which is why every storage failure path —
  quota exceeded, interrupted download, storage disabled, a truncated blob — is
  caught and ignored rather than surfaced.

  Two more things the same cache needed, both found by turning the network off.
  The manifest is remembered in `localStorage`: the stored copy is keyed by the
  sha256 the manifest carries, so with the manifest unreachable the archives
  could never be opened, and the map went grey offline — on the one visit the
  cache exists for. And the archives are requested with the sha in the query
  string, because `/tiles/` is marked immutable for a year under a file name
  that never changes: a rebuilt archive would otherwise be read out of the
  browser's HTTP cache as last year's bytes, and the background download would
  fetch the same stale bytes and fail its own size check for ever.

- **A deploy breaks the tabs that are open across it**, because every hashed
  chunk changes and `vercel remove --safe` deletes the deployment the old ones
  lived in; the next lazy import fails and the reader gets the "feed is not
  answering" screen with a Retry that cannot succeed. `main.ts` listens for
  Vite's `vite:preloadError` and reloads once per half-minute, which fetches the
  new index and the chunks it names.

- **Live positions and arrivals are deliberately NOT cached.** A cached bus is
  worse than no bus, because it looks current. With the feed unreachable the
  arrival board says so in as many words (`liveUnavailable`) rather than falling
  through to "no more today" — which is what it did before, and which told a
  rider the service had ended when the truth was that we could not see.

**The app never paints under the system's own bars**, on either platform. The
viewport meta omits `viewport-fit=cover` and iOS gets
`apple-mobile-web-app-status-bar-style: default`, so the system keeps the web
view inside the safe area and draws its bars itself. The Android workflow's
viewport rewrite matches.

The opposite was tried first — edge to edge, every surface insetting itself with
`env(safe-area-inset-*)` — and it is not one fix but one per surface, each able
to fail silently. Two did, on a real phone: the header was right while the drawer
beside it sat under the clock, because the drawer is teleported to `<body>` and
the rule had been written for `#app > aside`, a selector that matches nothing and
tells no one; and in landscape the drawer's left inset shrank its content box
until the route grid clipped. The cost of not painting edge to edge is an
edge-to-edge map. The saving is that whole category of bug.

**Android's status bar cannot be made to follow the app's theme, and this was
measured rather than assumed.** On Android 16 / Chrome 152, installed to the home
screen: the bar's background comes from the manifest's `theme_color`, fixed when
the app was added; `<meta name="theme-color">` only chooses the contrast of the
clock and icons drawn on it. Three attempts, each checked by screenshotting the
device over adb and sampling the pixels:

- meta updated at runtime to the dark colour → bar stayed `#FFFFFF`, icons turned
  white, and the clock disappeared into it;
- meta set to the dark colour *statically*, in the HTML → bar stayed `#FFFFFF`;
- `viewport-fit=cover` set inline, before first layout, so the app could paint the
  strip itself → every `env(safe-area-inset-*)` still `0px`, and the viewport
  still stopped below the bar. Chrome does not extend an installed PWA under the
  status bar in this version.

So the manifest's colour and the meta are one fixed value, deliberately equal,
matching the default light theme. A dark-theme reader gets a white bar with dark
icons: mismatched, but legible, which is the best available. Chrome is changing
this for installed PWAs; when it lands, `viewport-fit=cover` becomes worth
revisiting.

Icons are generated, not hand-drawn: `tools/icon.html` renders them and the
browser screenshots the element (element-level, because a window has a minimum
width and a viewport shot came out 984 px wide). Regenerate them the same way.

## Android

`.github/workflows/build-android.yml` wraps the built SPA with Capacitor
(manual dispatch only; the web app is the product). Two things make it differ
from the web build, and both are easy to get wrong:

- **The API base must be absolute.** On the web the SPA and the API share an
  origin and the client uses a relative `/api`. Inside Capacitor the bundle is
  served from `https://localhost`, where that path resolves to nothing — so the
  workflow takes the deployed API's URL as an input, bakes it in through
  `VITE_API_BASE`, and then **greps the bundle to prove it landed**. A build
  that silently shipped without it would install fine and show nothing.
- **CORS.** The packaged app *is* cross-origin, so `https://localhost` and
  `capacitor://localhost` are in the API's default `allowedOrigins` — and they
  are now the *only* things in it. The list used to carry three dev ports as
  well, and none of them did anything: the web app is same-origin wherever it
  runs, because both Vite servers proxy `/api`, so the browser never sends an
  `Origin` at all. Measured by emptying the list of localhost and loading the
  app, which works. One of the three (`5273`) matched nothing in the repo, and
  Vite silently takes the next free port when one is busy — so the list could not
  be trusted even for the direct-to-API case it was written for. That is what
  `strictPort` in `vite.config.ts` is for: a second `npm run dev` now fails with
  "Port 5173 is already in use" instead of starting a server on an address
  nothing documents, which is how an afternoon gets spent testing the wrong
  process.

- **Location permissions are patched into the generated manifest.** Capacitor's
  template declares `INTERNET` and nothing else, `cap add android` regenerates
  `android/` on every run, and `capacitor.config.json` has no field that can add
  a permission. Undeclared is worse than it sounds: Android refuses the request
  **without drawing a dialog**, so the packaged app looks exactly as though the
  user had said no, and `/nearby` is silently dead. Capacitor's own bridge
  already asks on the app's behalf when the WebView prompts, so the declaration
  is the entire fix — `@capacitor/geolocation` would not help, because its
  Android manifest is empty in every published major. `ACCESS_COARSE_LOCATION`
  goes in beside `ACCESS_FINE_LOCATION`: Android 12 ignores a fine-only runtime
  request. Every `uses-feature` carries `required="false"`, because an implied
  feature is a required one and a required one is a Play Store device filter —
  this is a timetable first, and it should install on a phone with poor location
  hardware.

The keystore in that workflow is a throwaway for an unpublishable build. A real
release needs a keystore held as a secret; that is deliberately not wired up,
because a signing key that lives in a workflow file is not a signing key.

## Finding a place, and getting there

All of it client-side: the 578 stops already in the store, and an address table
fetched once.

The trip planner's two fields — `Откуда` and `Куда` in the sidebar, on every
page — search **addresses and named places, not stops.** Nobody's destination is
a pole; it is a house, a hotel, a pharmacy, a village. A stop is still an end of
a trip from its own sheet and page, and is found on the map, in Nearby or on its
route — looking one up by the number on the pole is no longer something the
sidebar does.

- **The table is OpenStreetMap's, baked at build time and searched on the
  device.** `tools/build-places.mjs` harvests Batumi's houses, streets, named
  places, districts and villages from Overpass into
  `apps/web/src/places/places.data.json` — 16,694 houses on 1,247 streets, 4,046
  places, 91 areas; 887 KB, 192 KB with brotli — and `places/search.ts` searches
  it: plain TypeScript with no Vue, tested with `node --test` like the planner.
  Not a geocoder behind an API, because no public one can do this job, and that
  was measured rather than assumed: Nominatim's usage policy forbids
  search-as-you-type outright, and Photon's public instance refuses `lang=ru` and
  answers a Cyrillic query with nothing — «Руставели 12» came back as a "12th
  street" in a village. OSM itself carries `name:ru` on every named street here.
  The file is committed, like `names.data.json`: a deploy that waits on a
  volunteer Overpass server fails on someone else's bad afternoon.
- **Houses spell their street differently from the street.** 3,650 of the
  harvested addresses name it another way than the road does — «შარაშიძე მიხეილის ქუჩა»
  on the houses, «მიხეილ შარაშიძის ქუჩა» on the road; «ადლიის» against
  «ადლიას»; «მე-3 შეს» against «III შესახვევი»; "Zurab Gorgiladze Street" in
  English. Taken literally, each became a second street in the results, with a
  sounded-out Russian name beside the real one. The build compares a spelling
  with the roads *near that house* — same street type, same number, the same
  words give or take a Georgian ending, within 400 m — and the nearness is what
  makes a loose comparison safe. 163 streets are still known only from their
  houses, mostly in Chakvi, whose roads OSM has not named.
- **A query matches in all three locales at once** — someone reading the Russian
  UI may type what the sign says in Georgian. A house letter matches whichever
  keyboard typed it (12ა, 12а, 12a); a number inside a street's name («26 Мая») is
  not taken for a house; «ул.», «пр-т», "st" and «ქ.» count when they match and
  are forgiven when they do not. Two second chances, each for a failure found on
  a real query: a word is also compared by its Latin sound, because the hotels
  are named in Latin script and a Russian reader types «Хилтон»; and a place's OSM
  type carries its own words in three languages, because «аптека» otherwise
  finds none of the 156 pharmacies, which are called PSP and Aversi. A match on
  the type ranks after a match on the name — «автовокзал» is one terminal's name
  and eight minibus stands' type.
- **Ranking**: a village or town first — Gonio is somewhere people go — then a
  street before its own lanes and dead ends, then a place someone has written a
  Wikipedia article about, then the fortieth café, and Batumi's districts last,
  since their names are mostly the avenues', borrowed. House numbers that only
  start the one typed come in house order, not by distance. Among equals the
  nearest to the reader leads. Every row carries its address, or the district or
  village it is in — from OSM's administrative boundaries — so two Spars are told
  apart.
- **An empty field offers "my location" first, then the ten places last
  chosen.** The recents are the one part of a trip kept in `localStorage`: a
  place someone went to is a place they go to, whereas a trip or a route
  selection reopened tomorrow is a question nobody asked. They are stored with
  their names in all three locales, so a rebuilt table does not orphan them.
  Choosing "my location" for one end when the other already is moves it there,
  rather than planning a trip from me to me.
- **The table loads when a field is first focused**, not with the page — 190 KB
  is not for a visit that only glances at the map — and the service worker keeps
  it from then on (see *Installable, and offline*).
- **Choosing moves the reader on.** A place found by name is flown to, because
  where it is, is the first thing to check about an address picked from a list,
  and the cursor moves to the other field, because the trip is only half asked;
  a stop chosen from its sheet keeps its arrivals open meanwhile. Choosing only a
  destination, with location already permitted, fills the start with "my
  location" — never with a prompt nobody asked for, and never when the
  destination *is* "my location", which used to make that trip from me to me.
- **From a stop to its routes.** The stop page opens with a chip per route
  through it, and pressing one lands on the map with **only that route** drawn.
  It sets the selection and navigates — the selection *is* the map's state, so
  there is no route id in the URL and nothing new to keep in sync.
- **On the map, the arrival row is that affordance.** The sheet needs no chip
  section of its own: every row already names a line and where it is going, and
  a second list of the same numbers above them is the same interface twice. So
  the chip *in the row* is the button (`selectable` on `ArrivalBoard`), and it
  is built like the sidebar's — the line's colour as an edge while it is off,
  the whole chip in it once it is on. A filled badge is what the row used to
  show, and nobody presses a label: looking pressable is the half that makes the
  affordance exist. The stop page keeps its own chips and passes no
  `selectable`, because there the same gesture would toggle a map nobody can
  see, and its chips already mean "take me there".
- **Every stop is a place a trip can start or end** — `Отсюда` / `Сюда` on its
  map sheet and on its page, as on any place card.
- **The chosen stop is drawn differently** — bigger, and filled with the inverse
  of an ordinary stop rather than a new colour, because the 28 route hues
  already own colour on this map and a twenty-ninth would just join them. It is
  drawn last so it sits above the ordinary stop that may be metres away, and at
  **every** zoom: a highlight that vanishes on zooming out while its arrival
  panel stays open reads as the map losing track of it. A trip's two ends use
  the same inverted pair — a hollow ring to start, a filled dot to finish — in
  the fields, the step list and on the map alike.
- **Point at the map instead.** The pin after each field — where the old stop
  search kept its own — arms the map for that end, and pressing it again
  disarms it; the sheet steps aside so the whole map is tappable, and the next
  tap is that end of the trip. The point is then named after the house or place
  within 40 m of it, from the same table, because "Точка на карте → Точка на
  карте" as a trip's title says nothing about the trip. While armed the overlay
  and marker panes are made inert — one rule, rather than branching twelve
  marker handlers — and it has to reach *inside* the panes: Leaflet gives every
  interactive marker and path `pointer-events: auto` of its own, so a rule on
  the panes alone left each bus and stop answering taps (measured: a pick on the
  city centre landed on the bus pill there and chose nothing). `doubleClickZoom`
  is disabled while armed, because Leaflet fires `click` on the first tap of a
  double-tap and a pick that lands because someone was zooming is a pick nobody
  made. The control pane is untouched, so zooming still works.
- **Where a stop was chosen from is app state, not history.** `stores/proximity`
  holds an `origin` — `me` when a stop was picked out of the stops near the
  reader, or nothing — set only by that list and cleared by every other route
  into a stop, the map sheet's timetable link included. The stop page's back row
  is derived from it, or from a trip in progress ("К маршруту"), so a reloaded or
  shared link behaves like a tap rather than guessing from `history.length`. It
  is deliberately **not** persisted, and the map's locate button no longer sets
  it: a stop opened from the map after pressing it offered a way back to a list
  the reader had never seen.
- **Nearby** (`/nearby`) sorts stops by straight-line distance, capped at the
  planner's own 1.2 km. It says **"straight-line"** in the UI and means it for the
  distance; the walk time beside it is the planner's model (below), rounded up
  the same way, so the two screens cannot give the same walk two times — it used
  to round to the nearest minute, and a 7.4-minute walk was 7 here and 8 in a
  plan. Distance leads the row, because at a kerb "how far" is the question and
  the name only matters once you have chosen.

## Planning a trip

**It runs in the browser, and that is two decisions, not one.** The fix never
leaves the device — the API client takes no coordinates, and a planner on the
server would have to — and a plan works with no signal once the timetable has
been fetched, which is the offline story this app exists for. The cost is 9.5 KB
of gzipped timetable on first use, fetched when a field is first focused rather
than on every visit. The code is `apps/web/src/planner/` — plain TypeScript with
no Vue and no DOM, so `node --test` runs it directly.

- **RAPTOR** (Delling, Pajor, Werneck 2012) over trips rebuilt from
  `/api/timetable`: round k is the earliest arrival with at most k buses, which
  makes the rounds the transfer counts. Up to three buses. One timetable serves
  every day, so each pattern carries yesterday's, today's and tomorrow's
  departures: a search at 23:40 finds the 06:30, and one at 00:05 can still catch
  a bus that left before midnight. 2–9 ms a plan on the real network.
- **Which stop a bus is boarded at is chosen, not inherited.** Plain RAPTOR
  boards a trip where the scan first meets it — measured, that sent a reader on
  a 14-minute walk to board line 10 one stop before a pole seven minutes away
  that the same bus reached a minute later. The first bus is boarded where the
  reader can leave home latest; a change, where the wait at the kerb is shortest.
- **Walking is measured, not assumed.** 30 stop pairs from 150 m to 1.5 km,
  routed on foot over OpenStreetMap (FOSSGIS's OSRM), came out a median
  **1.25×** the straight line (quartiles 1.17 and 1.37) at the router's own
  **75 m a minute** (`planner/walking.ts`). Walks are drawn as dotted straight
  lines: "about this way, on foot", not a path we do not have.
- **Slack:** a minute to be at the pole before the bus, three for a change of
  bus — the bus being left is the late one, and a connection that only works if
  it isn't is not one to send anybody to. Transfers walk up to 400 m straight.
- **Reach:** stops within the same 1.2 km as Nearby, and the nearest three from
  up to 3 km only when there is none that close. Offered beside a stop that *was*
  close, a stop 2.6 km off turned a trip to Sarpi into a bus and a 44-minute walk.
- **Options, like Google's:** everything two searches, the second starting just
  after the first option leaves, and two more after that, can find — one per
  stop it could get off at — then nothing another option beats on leaving,
  arriving, changes and walking; one per sequence of lines; ranked by arrival
  plus five minutes a change and walking counted at 1.5×; nothing over 1.5× the
  best's cost, except that the best bus option always survives, so 23:30 offers
  the 07:00 as well as the 40-minute walk that beats it. Walking alone is an
  option when it is under an hour.
- **Always from now.** Depart-at and arrive-by were offered and taken out: the
  question at a kerb is how to get there from here, now, and a control nobody
  changes is one everybody has to read past. The search is depart-only as a
  result — `PlanQuery` has no mode.
- **Lines with no timetable** are offered apart: a direct ride on one, with its
  ride time and "+ the wait", when it could beat the best timed option.
- **Live, where it helps:** the step list shows the first bus's line as the feed
  sees it ("Ближайший сейчас: 13 мин" beside a scheduled 12:31 is the timetable
  and the road disagreeing today), and the map shows only the trip's buses.
- **Stable under a thumb:** a plan is redone every 30 s while shown,
  the chosen option is tracked by its lines rather than its place in the list,
  and "me" moves only when the fix moves 50 m — the map watches the position
  every few seconds, and reshuffling the options for GPS jitter is worse than
  an access walk 40 m out of date. The map fits the trip when it changes,
  measured off the laid-out sheet, and not on the 30-second re-plan.

## Sharing

`/share` carries the link, a QR code for it, and the system share sheet.

- **`SITE_URL` is the one address** (`.env.example`, default the production
  domain). `apps/web/vite.site.ts` reads it at build time into `virtual:site`
  for the page and into `index.html`'s `og:url`/`og:image`, which used to be the
  one place the domain was typed by hand; the deploy's post-deploy check reads
  it back out of the build. `new URL` rejects anything that is not absolute, so
  a typo fails the build instead of being printed on a poster.
- **The QR code is made at build time**, by `uqr` (zero dependencies, build-time
  only): one SVG path of horizontal runs, four modules of quiet zone, ECC M —
  version 3, 29 modules, where H would need a denser code for an overlay nobody
  draws. Black on white in both themes and written into the file, because it is
  also what gets downloaded and printed, and some cameras refuse light-on-dark.
  Verified by decoding it: the on-screen code and the downloaded PNG both read
  back to the address with `jsQR`.
- **The download is a PNG** drawn from the same SVG at a whole number of pixels
  per module — a fractional scale smears module edges, and that is what makes a
  printed code fail — because galleries, messengers and print shops take PNG.
- **Share is `navigator.share`** where it exists, since the system knows which
  messengers are on the phone; closing the sheet is an answer, not an error.
  Where it is absent — desktop Firefox, and Android's WebView, which is the
  packaged app — copying the link is the primary action, and a refused clipboard
  selects the address instead. The packaged app shares `SITE_URL`, not its own
  `https://localhost`.

## Deploy

`.github/workflows/vercel.yml` — every push to `master`, plus manual dispatch
for a redeploy with no commit behind it. It follows surstromming's Vercel
prebuilt flow (`link --project <package.json name>` → `pull` → `build --prod` →
`deploy --prebuilt --prod`, then `remove --safe`) and needs the same
`VERCEL_TOKEN` secret. Three things differ, each for a reason:

- **`vercel.json` is committed here, and the workflow does not write it.** In
  surstromming it is one rewrite that only the deploy cares about. Here it
  declares the workspace build command, the SPA output directory *and* the
  serverless function that serves `/api` — that is project structure, and
  `vercel dev` should see it too. It also marks `/assets/*` immutable for a year:
  those names carry a content hash, and Vercel's default — measured on
  production — was `max-age=0, must-revalidate`, which asked again about every
  chunk on every visit.
- **Typecheck and tests gate the deploy**, in a `verify` job that also runs on
  pull requests (where it needs no token). A red suite should stop a release,
  not follow it.
- **The post-deploy check asks the production domain for `/api/health`.**
  Deployment Protection covers the *generated* deployment URL and leaves only the
  production domain public, so the URL a fresh deployment has is precisely the
  one an unauthenticated request cannot reach; measured, it answers 302 to
  `vercel.com/sso-api`. Resolving the alias out of `vercel inspect --json` and
  `vercel curl` were both tried and cost more than the check was worth. What was
  missing was the production domain written down, and `SITE_URL` is that — the
  check reads it back out of the built `index.html` rather than restating it. It
  accepts both answers the function gives, 200 and a 503 when Batumi's feed is
  down, and fails on anything that is not the function answering: Vercel's own
  `NOT_FOUND`, a timeout, or the SPA's HTML, which is how `/api` shipped
  returning nothing at all, twice, while every step was green. It runs before
  `remove --safe`, so a broken release leaves the previous deployment in place
  to roll back to.

Four settings that are easy to get wrong:

- **`api/index.ts` must default-export `{ fetch }`, not the handler itself, and
  it must be reachable at more than one path.** Both halves of this failed
  silently on the first real deploy. `handle(app)` from `hono/vercel` is a bare
  function taking a web `Request`; a default-exported *function* is exactly what
  Vercel reads as a Node `(req, res)` handler, so it was invoked with an
  `IncomingMessage`, Hono never recognised it, nothing was written to the
  response, and the invocation sat there until `maxDuration` — a 30-second
  timeout rather than an error. An object with a `fetch` method is how Vercel is
  told this is a web handler. Separately, the filesystem matches
  `api/index.ts` to the exact path `/api` and nothing else, and Vercel checks the
  filesystem *before* rewrites — so `/api/health` matched no file, fell through
  to a rewrite list that deliberately excluded `api/`, and got Vercel's own
  `NOT_FOUND`. The `/api/(.*) → /api` rewrite fixes that and keeps the URL, so
  Hono still sees `/api/health` and its `basePath` still matches. `/api` itself
  now answers Hono's own fast 404, which is correct: no route is mounted there.


- **There is a `tsconfig.json` at the repo root, and it exists solely for
  Vercel.** The function builder walks up from `api/index.ts` with
  `ts.findConfigFile`, so it finds the root config and never
  `apps/api/tsconfig.json` — which is why `npm run typecheck` was green while
  every deploy failed with TS5097 on the `.ts` import extensions. Those
  extensions are load-bearing (`node --experimental-strip-types` and
  `node --test` both need them) so they stay. The obvious fix,
  `allowImportingTsExtensions`, is a **trap**: the builder forces `noEmit` off
  and renames every compiled `.ts` to `.js`, so a surviving `'./config.ts'`
  import is `ERR_MODULE_NOT_FOUND` — a green build and a 500 in production.
  `rewriteRelativeImportExtensions` is the one that survives, because it rewrites
  the specifier at emit. There is no `tsconfig` escape hatch in `vercel.json`;
  the schema has no such field.

- **`functions.maxDuration` must exceed `UPSTREAM_TIMEOUT_MS`.** A cold
  invocation fetches the whole 1.27 MB dataset before it can answer anything.
  The default 15 s upstream budget is longer than Vercel's legacy 10 s function
  limit, so `vercel.json` sets 30 s. If the account's plan rejects that, lower
  it *and* lower `UPSTREAM_TIMEOUT_MS` with it — otherwise the platform kills
  the request mid-fetch and the caller gets a 504 instead of our 502.
- **Region.** The upstream is in Georgia and the default Vercel region is US
  East, which puts an ocean in front of every cold start. Set the project's
  region to `fra1` (or nearer) in the Vercel dashboard — `regions` in
  `vercel.json` is a paid-plan field, so it is deliberately not set here.

No environment variables are required: every value in `config.ts` has a working
default, and the frontend is same-origin with the API so no CORS entry is needed.

## Workflow

- **The API, the journey planner and the address search are tested; the UI is
  not.** `npm test` runs
  Node's built-in runner (`node --test`) in both workspaces — no framework, no
  config, no dependency, and it strips the TypeScript itself. Tests are
  `*.test.ts` beside the code they cover. The planner and the search are web
  code but the same kind of code as the API's: whether a change of bus leaves
  time to make it, or whether «Хилтон» finds the Hilton, is invisible in a
  screenshot. So `apps/web/src/planner/` and `apps/web/src/places/` stay free of
  Vue and the DOM, their relative imports carry `.ts` for Node, and `tsconfig.test.json`
  checks the tests with Node's types while the app's config excludes them.
  The UI stays manually verified in the browser over Chrome DevTools Protocol on
  port 9222, per surstromming's rule.

  The split is not arbitrary. The API's value is in things that are *invisible
  when wrong*: whether a bus is matched to the right leg of its route, whether a
  transliteration leaves Georgian behind, whether an estimate counts down. None
  of that shows up in a screenshot. What a screenshot does show — hierarchy,
  colour, motion — is where the UI's value is, and asserting on it in code is
  how you get tests that break on every honest change.

- **A test that cannot fail is documentation with a spinner.** Every guard here
  was checked by breaking the thing it guards and confirming it goes red. That
  is not a formality: the first version of the map-matching guard counted
  out-of-order stops, and deleting the entire shape-orientation fix left it
  happily green — `matchChain` walks forward only, so it *cannot* emit an
  out-of-order result however wrong the shape is. The metric became the fit
  (median metres from a stop to the line it matched to), which moves from 5 m to
  infinity under the same mutation. Do the same for anything added here.

- **Live tests skip rather than fail when upstream is asleep.** After about
  20:00 the feed returns nothing and the host is sometimes unreachable; a red
  suite at midnight teaches people to ignore the suite. `app.test.ts` and
  `network.test.ts` probe once and skip with a reason.

- The smoke tests run through `app.fetch` directly rather than over a socket. A
  Hono app is a fetch handler, so this exercises the real routing, the real
  cache and the real upstream with no server to start and no port to collide.

- Comments explain a non-obvious *why*, never narrate the code.
