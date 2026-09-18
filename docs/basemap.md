# Basemap

The map is Leaflet with a self-hosted Protomaps vector basemap. It needs no API
key and no vendor account.

**Vector tiles are here for language.** Raster OSM tiles are labelled only in
Georgian, which most readers of the Russian UI cannot read. In Batumi, `name:ru`
is on all 1,556 named roads and `name:en` on 1,554. `protomaps-leaflet` reads
`name:<lang>` and falls back to `name`, so Georgian readers see what is on the
street sign. Georgian renders because the app already loads Noto Sans Georgian.
The dark map is Protomaps' own dark style, not a CSS invert, so route colours
stay true.

Already ruled out:

- **MapLibre.** Its styles hide scripts it can't shape, and Georgian is one of
  them.
- **Wikimedia's localised `osm-intl` tiles.** They return a hard 403 to anyone
  outside Wikimedia projects. Don't check again.

## Two archives

`npm run basemap` (`tools/build-basemap.mjs`) cuts two `.pmtiles` files, about
12 MB together, out of a pinned Protomaps planet build:

- **Detail**, up to z15, over the network box (41.50–41.77°N), about 6.5 MiB.
  The box has to contain every stop, with a margin. When it stopped at 41.55°N,
  seven stops (Sarpi, Ioane Lazi Street and others) had no tiles under them. The
  margin matters too: `maxBounds` clamps every move, and a phone's sheet covers
  the bottom 60%, so a trip fitted above the sheet got pushed back under it.
- **Overview**, z0–12, over the surrounding region, so zooming out doesn't show a
  grey void. Stopping at z12 is what makes it affordable: z0–13 is about 12 MB,
  while z0–12 is 4.97 MB and scales up to z13 fine. It is hidden from z14 up.

**Set the map's `maxZoom` explicitly.** Without it, Leaflet takes the range its
layers declare. The overview declares 13, so nothing past z13 could be reached.

## Generated, not committed

The archives are gitignored; the build script is committed. The script pins
the planet date and fails unless a decoded Batumi tile really carries `name:ru`.
It also writes `tiles/manifest.json` with each archive's sha256. The cost is
that a deploy needs `build.protomaps.com` to be reachable. That failure is loud,
which beats a binary of several megabytes in every diff.

**A missing archive fails quietly.** The tile request falls through to
`index.html`, and the map shows `Wrong magic number for PMTiles archive` while
every build step is green. So:

- `npm run basemap` is part of `vercel.json`'s `buildCommand`, which covers every
  deploy path and `vercel dev`;
- both workflows check that the built file starts with `PMTiles`;
- `predev` builds it on a fresh clone.

**The pinned build stops being downloadable.** Protomaps keeps about a week of
daily builds (checked 2026-09-18). The workflows cache `.cache/basemap` and
`public/tiles`, keyed on the build script's hash, so an unchanged pin never asks
Protomaps for anything. If the pinned build is gone and nothing is cached, the
script uses the newest build that exists and notes both dates on the run.
**Re-pin when you see that note.**
