# The map

`components/map/TransitMap.vue` is the only file that imports Leaflet. It takes
data as props and emits intent. The map page's root is a plain `<main>` that
clips, not a `ScrollArea`, because a map handles its own gestures.

## Leaflet owns its DOM, so Vue keeps its hands off

- **Don't bind a reactive `:class` to the element Leaflet mounts into.** Vue's
  class patch removes the classes Leaflet added, the tiles lose their width, and
  the map goes blank. So there are two elements: an outer one for Vue and an
  inner one for Leaflet.
- **Don't call `setIcon` to update a marker.** It replaces the DOM node, which
  leaves the CSS glide nothing to animate from, and buses teleport. Markers are
  created once and changed in place.
- **Leaflet only re-measures on a window resize.** Collapsing the sidebar is not
  a window resize, so a `ResizeObserver` calls `invalidateSize`.

## Buses

- A bus is a pill in its route's colour showing the route number, with a nose
  that points its heading. From z16 there is room for a bus icon. Below z13 it
  shrinks to a dot.
- Bearings accumulate rather than wrap, so 359° → 1° turns 2° forward instead of
  spinning 358° back.
- Markers glide over one poll interval (`--glide`, from `POLL_MS`), except during
  a zoom. The cost is that a bus trails reality by up to one poll. That is
  accepted: predicting motion along the line would drive buses through red
  lights and then snap them back.
- `src/styles/_motion.scss` lists what may animate and what must not.

## Route colours

The feed has no route colours, and 28 routes are far more than the design
palette holds. The API gives each route a hue, spread round the colour wheel by
`sortOrder`. The theme supplies lightness and chroma:
`oklch(var(--route-l) var(--route-c) <hue>)`.

## You are here

- The accuracy halo is an `L.circle`, whose radius is in metres. A
  `circleMarker` measures in pixels, so it would show a different accuracy at
  every zoom.
- The dot is a marker, so it sits above bus pills.
- The map never decides to fly by itself. The page asks through a `flyTo` prop
  carrying a nonce, so it can ask for the same place twice. It only asks for a
  fix near the network: the map is held inside Batumi, so flying to Tbilisi, or
  to the 0°, 0° a browser reports when it has no position, stopped over open sea.
- On the map page, the position comes from `watchPosition`, which pauses when the
  tab is hidden.
- The facing beam is described in [compass.md](compass.md).

## Route selection

- **The selection lasts for the session only.** Saving it meant that reopening
  the app the next morning showed four buses instead of forty, with nothing on
  screen saying the rest of the city was hidden.
- **Tapping a bus toggles its route.** It runs the same toggle as the sidebar
  chip (`toggleRoute`), so tapping the pill again undoes it. The cost is that
  with several routes selected, tapping a bus removes its route, and that bus
  disappears with it.
- **While a trip is shown**, the live feed narrows to the trip's lines through
  `focusRouteIds`, without changing the selection. Tapping a bus does nothing
  then.

## Stops and picking a point

- **The chosen stop is bigger and drawn in inverted colours**, not a new colour,
  because the 28 route colours already fill the map. It is drawn last and at
  every zoom.
- **A trip's two ends** are a hollow ring (start) and a filled dot (end). They
  look the same in the fields, the step list and on the map.
- **The pin after each trip field arms the map** for that end, and the next tap
  on the map sets it. While armed:
  - The overlay and marker panes, and everything inside them, get
    `pointer-events: none`. Leaflet sets `auto` on each interactive marker, so a
    rule on the panes alone let the bus pills keep catching taps.
  - Double-tap zoom is off, because Leaflet fires `click` on the first tap of a
    double tap.
- **A picked point is named** after the house or place within 40 m of it.
