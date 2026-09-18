# Offline and the PWA

The web app is a PWA (`vite-plugin-pwa`, Workbox). Its point is the **offline
timetable**, not installation. At a pole with one bar of signal, "when is the
last bus?" should not need the network.

| What | Strategy | Why |
|---|---|---|
| `/api/routes`, `/api/stops`, `/api/stops/:id`, `/api/timetable` | stale-while-revalidate, 14 days | Changes about once a year; also makes trip planning work offline |
| Address table (`places.data-<hash>.json`) | cache-first, not precached | 192 KB is too much to push on every visitor; the content hash means it is never stale |
| Basemap archives | IndexedDB, keyed by sha256 | See below |
| Live positions and arrivals | **never cached** | A cached bus looks current |

When the feed is unreachable, the arrival board says so (`liveUnavailable`)
instead of "no more buses today".

## The basemap in IndexedDB

- **Archives are keyed by the sha256 from the build, not by URL.** The URL never
  changes, so a URL key would serve last year's streets forever.
- **A first visit draws from the network** using range requests. The full 11 MB
  is downloaded afterwards in the background, but not on `saveData` or 2g. A
  second visit fetches only `manifest.json` (300 bytes).
- **The manifest is also kept in `localStorage`.** Otherwise, offline, the
  archives can't be looked up and the map goes grey.
- **Archives are requested with the sha in the query string.** `/tiles/` is
  cached as immutable for a year under a fixed file name, so a rebuilt archive
  would otherwise come out of the HTTP cache.
- **Storage is not guaranteed.** `storage.persist()` is often refused, and
  WebKit deletes script storage after 7 days without interaction. Every storage
  failure falls back to the network silently.

## Deploys and open tabs

A deploy changes every hashed chunk, and `vercel remove --safe` deletes the old
ones, so an open tab's next lazy import fails. `main.ts` catches
`vite:preloadError` and reloads, at most once every 30 seconds.

## System bars

The app never draws under the phone's status and navigation bars. The viewport
meta has no `viewport-fit=cover`, and iOS gets
`apple-mobile-web-app-status-bar-style: default`.

Edge-to-edge was tried first. Every surface had to inset itself, and two failed
silently on a real phone: the drawer sat under the clock, and landscape clipped
the route grid.

**On Android, the status bar colour can't follow the theme.** This was checked on
Android 16 with Chrome 152, as an installed PWA, by screenshotting over adb:

- The bar colour comes from the manifest's `theme_color`, fixed at install.
- `<meta name="theme-color">` only switches the icons between light and dark.
- `viewport-fit=cover` doesn't extend the page under the bar.

So the manifest colour and the meta are one fixed light colour. Dark theme gets
a white bar with dark icons: mismatched, but readable. Revisit when Chrome
changes this.

## Icons

Icons are generated. `tools/icon.html` renders them, and the browser screenshots
the element, not the window, because a window has a minimum width.
