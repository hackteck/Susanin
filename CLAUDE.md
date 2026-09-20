# Susanin

A live bus-tracking web app for **Batumi, Georgia**. It has its own
Node/TypeScript API in front of the city's real-time bus feed, and a Vue 3
frontend built from the **surstromming** component library, consumed from npm.
It is named for Ivan Susanin, who was famously good at leading people somewhere.

This file holds the rules. Findings (what was measured, what was ruled out, and
the traps) live in [`docs/`](docs/README.md). Read the doc for an area before
changing it. Record new findings there, briefly, and keep this file generic.

## Layout

npm workspaces:

- `apps/api` — `@susanin/api`, Hono on Node. The only thing that talks upstream.
- `apps/web` — `@susanin/web`, Vue 3 + Vite SPA. Talks only to our own `/api`.
- `api/index.ts` — the Vercel function. It mounts the same Hono app.
- `tools/` — build-time scripts: basemap, names, places, icons, and a stub
  upstream.

Each app's README maps its own files.

```bash
npm run dev          # API :8787, web :5173 (Vite proxies /api)
npm test             # node --test in both workspaces
npm run typecheck
npm run basemap      # generate the map tiles; predev does this on a fresh clone
```

## Data and the API

- Only `apps/api` calls upstream, and only through the TTL + single-flight cache
  in `lib/cache.ts`. Never call it directly from a handler. Every response sends
  `s-maxage` equal to its TTL. See [data-source.md](docs/data-source.md).
- Call the origin, never the community proxy. Don't re-probe sources that were
  already ruled out ([data-source.md](docs/data-source.md)).
- The frontend never sees an upstream shape.
- Don't take feed fields at face value: `Status`, the direction of route lines
  and the "English" names are all unreliable. See [feed.md](docs/feed.md) and
  [names.md](docs/names.md).
- Everything we compute (arrivals, heading, direction, repaired times) is
  labelled as an estimate, with the scheduled time beside it. Don't build UI for
  data the feed doesn't have, such as weekday timetables, occupancy or alerts.
  See [arrivals.md](docs/arrivals.md).
- Live positions and arrivals are never cached anywhere, because a cached bus
  looks current.
- Generated data (`names.data.json`, `places.data.json`, the basemap) is fixed in
  its `tools/` script and rebuilt, never edited by hand.
- Never leave a deployment pointed at `tools/stub-upstream.mjs`.

## Frontend

The frontend consumes `@surstromming/*` from npm, as any other consumer would. It
does not vendor, fork or alias them.

**surstromming's CLAUDE.md is authoritative for UI work.** It ships in the
[surstromming repo](https://github.com/hackteck/surstromming). In short:

- SFC order, and `<style module lang="scss">` always.
- `:class` arrays or objects, never a `cn()` joiner. `$style` in templates, and
  `useCssModule()` named `$style` in script. Hyphenated dynamic class families.
- Tokens only through `design.color()` / `spacing()` / `radius()` / `screen()` /
  `z-index()`. Mobile-first.
- No `provide`/`inject`. `defineModel()` for two-way state.
- Data-driven components, with slots as the escape hatch. No logic-heavy
  template expressions.

App conventions mirrored from surstromming's demo app:

- `main.ts` imports `font-list.scss`, then `reset.scss`, runs `initTheme()`
  before mount, and installs Pinia and the router.
- `App.vue` carries `@include design.layout(...)`. Pages go in the `default`
  view, and their sidebar in the named `sidebar` view.
- Pages lazy-load through `lazyPage()` inside `<Suspense>`, with `PageLoader` as
  the fallback.
- App-wide state is Pinia (`stores/*`), with one `Toaster` in `App.vue`.
- The theme is `data-theme` on `<html>`, with dark token values in
  `public/globals.css`.

**One deliberate deviation:** every page root is `<ScrollArea as="main">` except
the map page's. That one is a plain `<main>` that fills the shell and clips,
because a map handles its own gestures.

- Only `components/map/TransitMap.vue` imports Leaflet: data comes in as props,
  intent goes out as events. Never bind a reactive `:class` to Leaflet's element,
  and never call `setIcon`. See [map.md](docs/map.md).
- Routes carry a hue from the API, and theme tokens supply lightness and chroma.
  No colour is hardcoded in a component.
- Motion follows `src/styles/_motion.scss`, including its list of what must not
  animate.
- Every UI string exists in Russian (the default), Georgian and English. Counts
  go through `Intl.PluralRules` and numbers through `Intl.NumberFormat`. See
  [names.md](docs/names.md).
- A direction is shown as `→ terminal`, never as outbound or inbound.
- A first visit is offered a quick tour, and on a phone the menu button is
  highlighted until it has been used. See [onboarding.md](docs/onboarding.md).

If a surstromming package has a bug: flag it, add `../surstromming/packages/*` to
this repo's root `workspaces`, fix it there, re-verify against the source, and
publish only after review. Don't patch around it here.

## Testing and verification

- `npm test` runs Node's built-in runner, with no framework and no config. Tests
  are `*.test.ts` files next to the code they cover.
- The API is tested, and so are three web folders: `planner/`, `places/` and
  `sensors/`. Those folders stay free of Vue and the DOM, and their relative
  imports carry `.ts`. `tsconfig.test.json` type-checks the tests.
- The UI is not unit-tested. Verify it in the browser over the Chrome DevTools
  Protocol on port 9222. Tests are for what is invisible when wrong, such as a
  bus on the wrong leg or a leftover Georgian letter. Screenshots are for what
  is visible.
- **Watch every test fail before trusting it.** Break the thing it guards and
  confirm it goes red. A guard that cannot fail proves nothing: the first
  map-matching test stayed green with the whole fix deleted.
- Live tests skip, with a reason, when upstream is asleep (after about 20:00). A
  suite that goes red every night teaches people to ignore it.
- Smoke tests call `app.fetch` directly. That exercises the real routing, cache
  and upstream, with no server or port to manage.
- Comments explain a non-obvious *why*. They never narrate the code.

## Deploy

A push to `master` deploys to production through `.github/workflows/vercel.yml`,
after typecheck and tests. Some Vercel settings that look harmless break
production; [deploy.md](docs/deploy.md) lists them.
