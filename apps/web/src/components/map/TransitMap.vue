<template>
  <!--
    Two elements, and the split is load-bearing. The outer one is Vue's: it
    carries the reactive tier classes. The inner one is Leaflet's, and nothing
    reactive is ever bound to it — Leaflet adds `leaflet-container` and friends
    imperatively, and a Vue `:class` patch on the same element removes them
    again. Measured: every tile kept its src and lost its width, so the map went
    blank while the markers stayed exactly where they belonged.
  -->
  <div :class="classes">
    <div ref="container" :class="$style.canvas" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useCssModule, useTemplateRef, watch } from "vue";
import L from "leaflet";
import { leafletLayer } from "protomaps-leaflet";
import type { ArchiveSource } from "./archives";
import "leaflet/dist/leaflet.css";
import { useResizeObserver } from "@surstromming/util";
import type { Stop, Vehicle } from "@/api/types";

export interface MapShape {
  id: string;
  hue: number;
  points: [number, number][];
}

export interface MapPoint {
  lat: number;
  lon: number;
}

export interface MapUser extends MapPoint {
  /** Metres. Drawn as a halo, because a bare dot claims a precision GPS has not got. */
  accuracy: number;
}

/**
 * A request to move the view, expressed as data rather than as a method call —
 * bump `nonce` to re-fire the same destination. The alternative is `defineExpose`,
 * which would make the map imperative from outside and is the thing this
 * component exists to avoid.
 */
export interface MapFlyTo extends MapPoint {
  zoom?: number;
  nonce: number;
}

export interface MapView {
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
}

/** A planned trip, already cut to shape: walks as dotted ink, rides in their line's colour. */
export interface MapJourney {
  legs: ({ kind: "walk"; points: [number, number][] } | { kind: "ride"; hue: number; points: [number, number][] })[];
  /** Where the reader gets on and off — ringed in the line's colour so a change of bus is visible. */
  stops: (MapPoint & { hue: number })[];
}

/** The two ends of a trip. "Me" is drawn by the location dot already, so a caller passes null for it. */
export interface MapEndpoints {
  from: MapPoint | null;
  to: MapPoint | null;
}

/**
 * A request to show an area, as data with a nonce — the same contract as
 * `MapFlyTo`. It carries the room to leave for whatever the page has laid over
 * the map, measured by the page, because only the page knows its sheet.
 */
export interface MapFit {
  south: number;
  west: number;
  north: number;
  east: number;
  /** Pixels covered on the left (the desktop card) and at the bottom (the phone's sheet). */
  left: number;
  bottom: number;
  nonce: number;
}

const props = withDefaults(
  defineProps<{
    stops: Stop[];
    vehicles: Vehicle[];
    shapes: MapShape[];
    /** Pans to this stop when it changes. */
    focusStopId?: string | null;
    userPosition?: MapUser | null;
    /** Dims the dot: the fix is old enough that it may no longer be true. */
    userStale?: boolean;
    /** Which way the reader is facing, degrees clockwise from north; null draws no beam. */
    userHeading?: number | null;
    /** Armed for a point pick — the next tap on the map means "here". */
    picking?: boolean;
    journey?: MapJourney | null;
    endpoints?: MapEndpoints | null;
    flyTo?: MapFlyTo | null;
    fitTo?: MapFit | null;
    /** Which `name:` tag the basemap labels streets from. */
    lang?: string;
    dark?: boolean;
    /**
     * Where the two archives are read from — a stored copy when the browser has
     * one, otherwise their URLs. Resolved by the page so the map stays a thing
     * that is handed its data rather than one that goes looking for it.
     */
    sources?: { detail: ArchiveSource; overview: ArchiveSource } | null;
    /** The stops of the one route being shown, drawn in its colour at every zoom. */
    routeStops?: { ids: string[]; hue: number } | null;
    /** Milliseconds between polls — how long a bus has to glide to its new fix. */
    glideMs?: number;
    /** Room to leave at the bottom when flying to a stop, for the mobile sheet. */
    bottomInset?: number;
  }>(),
  {
    focusStopId: null,
    userPosition: null,
    userStale: false,
    userHeading: null,
    picking: false,
    journey: null,
    endpoints: null,
    flyTo: null,
    fitTo: null,
    lang: "ru",
    dark: false,
    sources: null,
    routeStops: null,
    glideMs: 5000,
    bottomInset: 0,
  },
);

const emit = defineEmits<{
  selectStop: [id: string];
  selectVehicle: [id: string];
  pickPoint: [point: MapPoint];
  /** A view fact. What it means — "is the user's dot off screen" — is the page's business. */
  viewChange: [view: MapView];
}>();

const $style = useCssModule();

// Batumi's centre, and the box the network actually occupies — panning to
// Tbilisi from a bus map is never what anyone meant to do.
const CENTRE: L.LatLngExpression = [41.641, 41.63];
const BOUNDS = L.latLngBounds([41.5, 41.5], [41.77, 41.78]);
/** Below this, 578 stop dots are a smear rather than information. */
const STOPS_FROM_ZOOM = 15;
/** Below this a route number cannot be read, so a bus becomes a coloured dot. */
const PILL_FROM_ZOOM = 13;
/** Only this close is there room for a glyph beside the number. */
const GLYPH_FROM_ZOOM = 16;
/**
 * A halo wider than this stops being information and becomes a blue wash over
 * the city, so it is clamped and the dot says "approximate" instead.
 */
const MAX_HALO_M = 750;

const container = useTemplateRef<HTMLElement>("container");
const zoom = ref(14);
const zooming = ref(false);

// Tier is a class on the wrapper, not a per-marker decision: 150 markers should
// not each be asked what zoom it is.
const classes = computed(() => [
  $style.root,
  zoom.value < PILL_FROM_ZOOM ? $style.tierDot : $style.tierPill,
  {
    [$style.tierGlyph]: zoom.value >= GLYPH_FROM_ZOOM,
    [$style.isZooming]: zooming.value,
    [$style.isPicking]: props.picking,
  },
]);

let map: L.Map | undefined;
let basemap: ReturnType<typeof leafletLayer> | undefined;
let overview: ReturnType<typeof leafletLayer> | undefined;
let shapeLayer: L.LayerGroup | undefined;
let journeyLayer: L.LayerGroup | undefined;
let accuracyLayer: L.LayerGroup | undefined;
let stopLayer: L.LayerGroup | undefined;
let journeyStopLayer: L.LayerGroup | undefined;
let vehicleLayer: L.LayerGroup | undefined;
let userHalo: L.Circle | undefined;
let userMarker: L.Marker | undefined;
let userBeam: L.Marker | undefined;
let startMarker: L.Marker | undefined;
let endMarker: L.Marker | undefined;

interface Painted {
  marker: L.Marker;
  /** The pill itself, inside the element Leaflet moves. */
  pill: HTMLElement;
  label: HTMLElement;
  /**
   * Bearing as a running total rather than a compass reading. 359° → 1° must
   * turn 2° forward, not 358° backward, or the nose spins around the pill
   * every time a bus crosses north.
   */
  turned: number;
}

// Markers are kept and mutated, never rebuilt. This is the whole reason the
// glide works: `setIcon` replaces the DOM node, and a brand-new node has no
// previous transform to animate from, so every bus teleported.
const painted = new Map<string, Painted>();

// Drawn inline rather than taken from the icon set: this is the map's own
// furniture, and it has to carry a CSS-module class name that only exists here.
const busGlyph =
  `<svg class="${$style.glyph}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ` +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 17h14M5 6h14M5 6v11M19 6v11M9 6v5h6V6"/>' +
  '<circle cx="8" cy="19" r="1.4"/><circle cx="16" cy="19" r="1.4"/></svg>';

const markerHtml = (vehicle: Vehicle) =>
  `<div class="${$style.pill}"><i class="${$style.nose}"></i>${busGlyph}<b>${escapeHtml(vehicle.shortName)}</b></div>`;

// The route number comes from the feed, so it is never trusted into innerHTML.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Shortest signed turn from one bearing to another, in degrees. */
const shortestTurn = (from: number, to: number) => {
  const delta = ((to - from) % 360 + 540) % 360 - 180;
  return delta;
};

const applyVehicle = (entry: Painted, vehicle: Vehicle) => {
  const { pill, label } = entry;

  pill.style.setProperty("--hue", String(vehicle.hue));
  pill.classList.toggle($style.hasHeading!, vehicle.heading !== null);
  // A bus that has been parked for ten minutes is not "live" — it is still
  // there, and dimming says so without hiding something that exists.
  pill.classList.toggle($style.isParked!, !vehicle.inService);

  if (vehicle.heading !== null) {
    entry.turned += shortestTurn(((entry.turned % 360) + 360) % 360, vehicle.heading);
    pill.style.setProperty("--heading", `${entry.turned}deg`);
  }

  if (label.textContent !== vehicle.shortName) label.textContent = vehicle.shortName;
};

// Leaflet writes colours as SVG *presentation attributes*, and `var()` is not
// dependably resolved there across browsers. A class is, because a CSS rule
// both beats a presentation attribute and is a place custom properties really
// work — so the colours below are named in the stylesheet, and only the route's
// own hue is set per element.
const drawShapes = () => {
  if (!shapeLayer) return;
  shapeLayer.clearLayers();

  for (const shape of props.shapes) {
    // Two lines, not one: a casing under the colour is what keeps a route
    // legible where it crosses another of a similar hue.
    L.polyline(shape.points, { className: $style.casing, weight: 7 }).addTo(shapeLayer);

    const line = L.polyline(shape.points, { className: $style.line, weight: 4 }).addTo(shapeLayer);
    const element = line.getElement() as SVGElement | undefined;
    element?.style.setProperty("--hue", String(shape.hue));
  }
};

/** The view, widened so nothing pops into existence at the edge mid-glide. */
const paddedBounds = () => map?.getBounds().pad(0.2);

const drawStops = () => {
  if (!map || !stopLayer) return;
  stopLayer.clearLayers();

  // Only what is on screen: the network is 578 stops and the reader is looking
  // at a street.
  const view = paddedBounds();
  const crowded = map.getZoom() < STOPS_FROM_ZOOM;

  // With a single route drawn, the question stops being "where are the stops"
  // and becomes "where does *this* one stop" — so its stops are drawn at every
  // zoom, in its own colour. Following a line you cannot see the stops of is
  // reading a route without its answer.
  const onRoute = props.routeStops ? new Set(props.routeStops.ids) : null;

  const draw = (stop: Stop, kind: "plain" | "onRoute" | "selected") => {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: kind === "selected" ? 8 : kind === "onRoute" ? 5.5 : 4,
      weight: kind === "plain" ? 2 : 3,
      className:
        kind === "selected" ? $style.stopSelected : kind === "onRoute" ? $style.stopOnRoute : $style.stop,
    })
      .on("click", () => emit("selectStop", stop.id))
      .addTo(stopLayer!);

    // Same trick as the route line: Leaflet writes colours as presentation
    // attributes, where `var()` is not dependably resolved, so the rule lives in
    // the stylesheet and only the hue is set per element.
    if (kind === "onRoute" && props.routeStops) {
      (marker.getElement() as SVGElement | undefined)?.style.setProperty("--hue", String(props.routeStops.hue));
    }
    return marker;
  };

  let chosen: Stop | undefined;

  for (const stop of props.stops) {
    if (stop.id === props.focusStopId) {
      chosen = stop;
      continue;
    }
    const highlighted = onRoute?.has(stop.id) ?? false;
    // A highlighted stop ignores the crowding rule: there are at most a few
    // dozen on one route, which is a shape rather than a smear.
    if (crowded && !highlighted) continue;
    if (!view?.contains([stop.lat, stop.lon])) continue;
    draw(stop, highlighted ? "onRoute" : "plain");
  }

  // Last, so it sits above the ordinary stop that may be a few metres away —
  // and at every zoom, because a highlight that disappears when you zoom out,
  // while its arrival panel stays open, reads as the map losing track of it.
  if (chosen && view?.contains([chosen.lat, chosen.lon])) draw(chosen, "selected");
};

const drawVehicles = () => {
  if (!vehicleLayer) return;

  const view = paddedBounds();
  const seen = new Set<string>();

  for (const vehicle of props.vehicles) {
    // Culling matters more here than for stops: every uncculled bus holds a
    // promoted compositor layer, whether or not anyone can see it.
    if (view && !view.contains([vehicle.lat, vehicle.lon])) continue;
    seen.add(vehicle.id);

    const existing = painted.get(vehicle.id);
    if (existing) {
      existing.marker.setLatLng([vehicle.lat, vehicle.lon]);
      applyVehicle(existing, vehicle);
      continue;
    }

    const marker = L.marker([vehicle.lat, vehicle.lon], {
      icon: L.divIcon({ className: $style.icon, html: markerHtml(vehicle), iconSize: [0, 0] }),
      keyboard: false,
      // Above the stop dots: a bus is the thing that moves and the thing
      // people are looking for.
      zIndexOffset: 1000,
    }).on("click", () => emit("selectVehicle", vehicle.id));

    marker.addTo(vehicleLayer);

    const outer = marker.getElement();
    const pill = outer?.firstElementChild as HTMLElement | null;
    const label = pill?.querySelector("b");
    if (!outer || !pill || !label) continue;

    const entry: Painted = { marker, pill, label, turned: vehicle.heading ?? 0 };
    applyVehicle(entry, vehicle);
    painted.set(vehicle.id, entry);

    // A frame later, or the marker glides in from wherever its transform
    // started rather than simply being where it is.
    requestAnimationFrame(() => outer.classList.add($style.isGliding!));
  }

  for (const [id, entry] of painted) {
    if (seen.has(id)) continue;
    entry.marker.remove();
    painted.delete(id);
  }
};

/**
 * "Me", in two pieces that belong to two different panes.
 *
 * The halo is `L.circle`, whose radius is in METRES and therefore scales with
 * zoom; `circleMarker`'s radius is pixels, which would claim 40 m of accuracy at
 * z18 and 4 km at z11 — the same number meaning something different at every
 * zoom is worse than not drawing it.
 *
 * The dot is a marker, not a circle, because Leaflet's marker pane sits above
 * the overlay pane unconditionally — as a `circleMarker` it could never clear a
 * bus pill, and "which bus is nearest me" is the question it exists to answer.
 *
 * The beam — which way the reader is facing — is a third piece, and a marker of
 * its own rather than a child of the dot's, because it belongs *under* the
 * buses: a translucent wedge washed over the pill of the bus beside you would
 * tint the one thing you are trying to read. So stops < beam < buses < dot.
 *
 * Nothing here moves the map. Deciding to fly because a fix arrived is app
 * logic, and doing it in here is exactly why the dot could never be re-centred:
 * the old code refused to fly a second time, by design.
 */
const drawUser = () => {
  if (!map || !accuracyLayer) return;

  const fix = props.userPosition;

  if (!fix) {
    userHalo?.remove();
    userMarker?.remove();
    userBeam?.remove();
    userHalo = undefined;
    userMarker = undefined;
    userBeam = undefined;
    return;
  }

  const at: L.LatLngExpression = [fix.lat, fix.lon];
  // A desktop network fix sometimes reports 0, and `L.circle` with radius 0
  // renders nothing at all rather than nothing visible.
  const halo = Number.isFinite(fix.accuracy) ? Math.min(fix.accuracy, MAX_HALO_M) : MAX_HALO_M;
  const coarse = !Number.isFinite(fix.accuracy) || fix.accuracy > MAX_HALO_M;

  if (userHalo) {
    userHalo.setLatLng(at);
    userHalo.setRadius(halo);
  } else if (halo > 0) {
    userHalo = L.circle(at, { radius: halo, className: $style.accuracy, interactive: false }).addTo(
      accuracyLayer,
    );
  }

  if (!userMarker) {
    userMarker = L.marker(at, {
      icon: L.divIcon({ className: $style.userIcon, html: `<i class="${$style.userDot}"></i>`, iconSize: [0, 0] }),
      interactive: false,
      keyboard: false,
      // Above the buses, which are at 1000.
      zIndexOffset: 2000,
    }).addTo(map);
  } else {
    userMarker.setLatLng(at);
  }

  if (!userBeam) {
    userBeam = L.marker(at, {
      icon: L.divIcon({ className: $style.userIcon, html: `<i class="${$style.beam}"></i>`, iconSize: [0, 0] }),
      interactive: false,
      keyboard: false,
      // Below the buses at 1000, so a pill beside the reader stays its own colour.
      zIndexOffset: 0,
    }).addTo(map);
  } else {
    userBeam.setLatLng(at);
  }

  // Toggled on the element rather than through the icon: replacing a divIcon is
  // the same mistake as `setIcon` on a vehicle — a new node, and the CSS state
  // it was carrying goes with the old one.
  const dot = userMarker.getElement()?.firstElementChild;
  dot?.classList.toggle($style.isStale!, props.userStale);
  dot?.classList.toggle($style.isCoarse!, coarse);
  // It starts from the dot, so it inherits the dot's doubt about where that is.
  userBeam.getElement()?.firstElementChild?.classList.toggle($style.isStale!, props.userStale);
  drawHeading();
};

/**
 * Written straight to the element, up to once a frame while the phone turns.
 * No transition: the composable has already smoothed the reading, and easing it
 * a second time would make the beam trail a turn the reader can feel themselves
 * making.
 */
const drawHeading = () => {
  const beam = userBeam?.getElement()?.firstElementChild as HTMLElement | null | undefined;
  if (!beam) return;
  const heading = props.userHeading;
  beam.classList.toggle($style.hasHeading!, heading !== null);
  if (heading !== null) beam.style.setProperty("--heading", `${heading}deg`);
};

/**
 * A planned trip. Walks are dotted and neutral, because a straight dotted line
 * says "about this way, on foot" and a solid one would claim a path we do not
 * have; rides are the line's own colour over a casing, exactly as a route is.
 * Nothing here animates — the polylines rule in _motion.scss covers these too.
 */
const drawJourney = () => {
  if (!journeyLayer || !journeyStopLayer) return;
  journeyLayer.clearLayers();
  journeyStopLayer.clearLayers();

  const journey = props.journey;
  if (!journey) return;

  for (const leg of journey.legs) {
    if (leg.points.length < 2) continue;
    if (leg.kind === "walk") {
      L.polyline(leg.points, { className: $style.walkLine, weight: 4, interactive: false }).addTo(journeyLayer);
      continue;
    }
    L.polyline(leg.points, { className: $style.casing, weight: 9, interactive: false }).addTo(journeyLayer);
    const line = L.polyline(leg.points, { className: $style.line, weight: 6, interactive: false }).addTo(journeyLayer);
    (line.getElement() as SVGElement | undefined)?.style.setProperty("--hue", String(leg.hue));
  }

  // Above the ordinary stop dots, which may sit a metre away: these are the
  // few stops in the whole city the reader actually needs.
  for (const stop of journey.stops) {
    const marker = L.circleMarker([stop.lat, stop.lon], {
      radius: 6,
      weight: 3,
      className: $style.journeyStop,
      interactive: false,
    }).addTo(journeyStopLayer);
    (marker.getElement() as SVGElement | undefined)?.style.setProperty("--hue", String(stop.hue));
  }
};

/**
 * Where the trip starts and ends — a hollow ring and a filled dot, the pair the
 * sidebar's fields and the step list draw. Drawn instantly: a fade after a tap
 * on the map reads as a tap that missed.
 */
const placeEndpoint = (existing: L.Marker | undefined, point: MapPoint | null, dotClass: string) => {
  if (!map || !point) {
    existing?.remove();
    return undefined;
  }
  const at: L.LatLngExpression = [point.lat, point.lon];
  if (existing) {
    existing.setLatLng(at);
    return existing;
  }
  return L.marker(at, {
    icon: L.divIcon({ className: $style.endpointIcon, html: `<i class="${dotClass}"></i>`, iconSize: [0, 0] }),
    // Never interactive: a marker that ate the next tap would make a second
    // pick at the same place impossible.
    interactive: false,
    keyboard: false,
    zIndexOffset: 1500,
  }).addTo(map);
};

const drawEndpoints = () => {
  startMarker = placeEndpoint(startMarker, props.endpoints?.from ?? null, $style.startDot!);
  endMarker = placeEndpoint(endMarker, props.endpoints?.to ?? null, $style.endDot!);
};

/**
 * The basemap, in two layers over one style.
 *
 * Raster tiles could only ever be labelled in one language — Georgian — and
 * every localized raster service is either keyed or, in Wikimedia's case, a hard
 * 403 for anyone outside their projects. A vector cut we host ourselves has no
 * provider and no key, which is the condition the recorded rejection of vector
 * tiles was actually about. `lang` picks the `name:<lang>` tag and falls back to
 * `name`, so Georgian is served by the fallback rather than a translation —
 * `name` being what is painted on the street sign.
 *
 * The detail archive stops at the network's edge, because cutting z15 over
 * anything wider is thousands of tiles. That left a grey void around the city
 * for anyone who zoomed out: at z11 a wide screen asks for 1.76° of longitude
 * against the network's 0.28°. So a second, coarse archive sits underneath and
 * fills the surround. It stops at z12 and is overzoomed for z13, which is what
 * makes it affordable — measured, that one level is the difference between
 * 4.97 MB and about 12.
 *
 * They never both draw the same pixel at a zoom where it matters: the overview
 * is hidden from z14 up, by which point the detail archive covers the viewport
 * on its own.
 *
 * Rebuilt rather than mutated on a locale or theme change: the alternative
 * reaches into the layer's paint and label rules and needs a Flavor object out
 * of a package we only have transitively. Both change on a deliberate press, so
 * a rebuild costs nothing anyone can feel — and swapping a Leaflet layer is a
 * Leaflet operation, not a Vue patch on Leaflet's DOM.
 */
const BASEMAP_ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> &copy; ' +
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** The zoom at which the detail archive alone covers any viewport we support. */
const DETAIL_FROM_ZOOM = 13;

const drawBasemap = () => {
  if (!map) return;

  overview?.remove();
  basemap?.remove();

  const flavor = props.dark ? "dark" : "light";
  const base = import.meta.env.BASE_URL;

  overview = leafletLayer({
    url: props.sources?.overview ?? `${base}tiles/batumi-overview.pmtiles`,
    flavor,
    lang: props.lang,
    maxDataZoom: 12,
    // Hidden once the detail archive can carry the whole viewport, so the two
    // are never both rasterising at the zooms people actually read the map at.
    maxZoom: DETAIL_FROM_ZOOM,
    attribution: BASEMAP_ATTRIBUTION,
  });
  overview.addTo(map);

  basemap = leafletLayer({
    url: props.sources?.detail ?? `${base}tiles/batumi.pmtiles`,
    flavor,
    lang: props.lang,
    // The archive stops at z15 and the renderer overzooms above it; because it
    // is vector, the labels stay sharp rather than turning to porridge.
    maxDataZoom: 15,
    minZoom: DETAIL_FROM_ZOOM,
    // The same string as the overview, deliberately: Leaflet's attribution
    // control counts identical entries and prints them once, whereas leaving
    // this off let the layer fall back to its own wording and the bar read
    // "Protomaps © OpenStreetMap contributors, Protomaps © OpenStreetMap".
    attribution: BASEMAP_ATTRIBUTION,
  });
  basemap.addTo(map);
};

const reportView = () => {
  if (!map) return;
  const bounds = map.getBounds();
  emit("viewChange", {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
    zoom: map.getZoom(),
  });
};

onMounted(() => {
  if (!container.value) return;

  container.value.style.setProperty("--glide", `${props.glideMs}ms`);
  map = L.map(container.value, {
    center: CENTRE,
    zoom: 14,
    minZoom: 11,
    // Both ends are stated, and stating maxZoom is not optional: Leaflet falls
    // back to the widest range its *layers* declare whenever the map itself
    // leaves one undefined (`getMaxZoom` → `_layersMaxZoom`). The overview layer
    // declares maxZoom 13 so it stops drawing under the detail layer — and with
    // no map ceiling of its own that silently became the whole map's ceiling,
    // making every zoom past 13 unreachable. The raster layer used to supply
    // this and took it with it when it went.
    maxZoom: 19,
    maxBounds: BOUNDS,
    maxBoundsViscosity: 0.7,
    zoomControl: false,
    attributionControl: true,
  });

  drawBasemap();

  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Insertion order is paint order within the overlay pane, so the halo goes in
  // before the stops — a translucent disc over a stop dot hides it.
  shapeLayer = L.layerGroup().addTo(map);
  journeyLayer = L.layerGroup().addTo(map);
  accuracyLayer = L.layerGroup().addTo(map);
  stopLayer = L.layerGroup().addTo(map);
  journeyStopLayer = L.layerGroup().addTo(map);
  vehicleLayer = L.layerGroup().addTo(map);

  // A zoom rewrites every marker transform at once, and animating that reads as
  // the fleet sliding off the map — so the glide is dropped for the duration.
  map.on("zoomstart", () => (zooming.value = true));
  map.on("zoomend", () => {
    zooming.value = false;
    zoom.value = map?.getZoom() ?? zoom.value;
    drawStops();
    drawVehicles();
    reportView();
  });
  map.on("moveend", () => {
    drawStops();
    drawVehicles();
    reportView();
  });

  map.on("click", (event) => {
    // Which gesture means what is the map's business; what a point is *for* is
    // not, so the coordinate goes out and the component learns nothing else.
    if (!props.picking) return;
    emit("pickPoint", { lat: event.latlng.lat, lon: event.latlng.lng });
  });

  zoom.value = map.getZoom();
  drawShapes();
  drawJourney();
  drawStops();
  drawVehicles();
  drawUser();
  drawEndpoints();
  reportView();
});

// Leaflet caches its container's size and only re-reads it on a *window*
// resize. The sidebar collapsing is not one: it changes the map's width with
// the window untouched, and Leaflet then lays tiles out for a box that is no
// longer there — measured, every tile loaded and positioned off screen, leaving
// the markers floating on blank white.
useResizeObserver(
  () => [container.value],
  () => {
    map?.invalidateSize({ animate: false });
    drawStops();
    drawVehicles();
  },
);

onBeforeUnmount(() => {
  map?.remove();
  map = undefined;
  painted.clear();
});

watch(() => props.shapes, drawShapes, { deep: true });
watch(() => props.stops, drawStops);
watch(() => props.routeStops, drawStops);
watch(() => props.vehicles, drawVehicles);
watch(() => props.userPosition, drawUser);
watch(() => props.userStale, drawUser);
watch(() => props.userHeading, drawHeading);
watch(() => props.journey, drawJourney);
watch(() => props.endpoints, drawEndpoints);
watch(
  () => props.glideMs,
  (ms) => container.value?.style.setProperty("--glide", `${ms}ms`),
);

// Leaflet fires `click` on the first tap of a double-tap-to-zoom, so a pick
// could land because someone was zooming rather than choosing.
watch(
  () => props.picking,
  (armed) => (armed ? map?.doubleClickZoom.disable() : map?.doubleClickZoom.enable()),
);

watch(() => [props.lang, props.dark], drawBasemap);

// The page asks for a move; the nonce is what lets it ask for the same place
// twice, which is exactly what "centre on me again" is.
watch(
  () => props.flyTo?.nonce,
  () => {
    const target = props.flyTo;
    if (!map || !target) return;
    map.flyTo([target.lat, target.lon], target.zoom ?? Math.max(map.getZoom(), 16), { duration: 0.8 });
  },
);

// Showing a whole trip is the page's decision, like a fly: the map only knows
// how to leave room for whatever the page has put over it.
watch(
  () => props.fitTo?.nonce,
  () => {
    const area = props.fitTo;
    if (!map || !area) return;
    const edge = 32;
    map.flyToBounds(
      [
        [area.south, area.west],
        [area.north, area.east],
      ],
      {
        paddingTopLeft: [area.left + edge, edge],
        paddingBottomRight: [edge, area.bottom + edge],
        maxZoom: 17,
        duration: 0.6,
      },
    );
  },
);

watch(
  () => props.focusStopId,
  (id) => {
    // Redraw whether or not the map moves: selecting a stop already in view
    // fires no `moveend`, and the highlight would then only appear once
    // something else happened to nudge the map.
    drawStops();

    if (!map || !id) return;
    const stop = props.stops.find((candidate) => candidate.id === id);
    if (!stop) return;

    const targetZoom = Math.max(map.getZoom(), 16);
    // Centring puts the stop under the bottom sheet on a phone. Shifting the
    // target up by half the sheet lands it in the part of the map still visible.
    const point = map.project([stop.lat, stop.lon], targetZoom).add([0, props.bottomInset / 2]);
    map.flyTo(map.unproject(point, targetZoom), targetZoom, { duration: 0.6 });
  },
);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;
@use "../../styles/motion" as motion;

.root {
  width: 100%;
  height: 100%;
  background-color: design.color(muted);

  // Leaflet stacks its own panes from 200 (tiles) to 800 (controls). Those are
  // internal numbers, but without a stacking context of its own they compete
  // with the app's ladder in the page — measured: the map painted straight over
  // the stop panel and the locate button, both of which sit on `popover` (30).
  // Isolating keeps Leaflet's ladder Leaflet's, so the app's still means
  // something.
  isolation: isolate;

  // Leaflet paints its own chrome; these pull it onto the app's tokens.
  :global(.leaflet-container) {
    font: inherit;
    background-color: design.color(muted);
  }

  // Buttons are for pointers. A phone pinches, and the pair would sit under
  // the stop sheet anyway, so below md they aren't drawn at all.
  :global(.leaflet-control-zoom) {
    display: none;
    border: 1px solid design.color(border);
    border-radius: design.radius(md);
    box-shadow: design.shadow(sm);
    overflow: hidden;

    @include design.screen(md) {
      display: block;
    }
  }

  :global(.leaflet-control-zoom a) {
    width: design.spacing(9);
    height: design.spacing(9);
    line-height: design.spacing(9);
    border: none;
    background-color: design.color(background);
    color: design.color(foreground);

    &:hover {
      background-color: design.color(accent);
    }
  }

  :global(.leaflet-control-attribution) {
    padding: 0 design.spacing(1.5);
    border-radius: design.radius(sm) 0 0 0;
    background-color: design.with-alpha(background, 80%);
    color: design.color(muted-foreground);
    font-size: 0.6875rem;

    a {
      color: design.color(muted-foreground);
    }
  }

  // Armed for a point pick. The crosshair has to beat Leaflet's own
  // .leaflet-grab, which is why these are as specific as they are.
  &.isPicking :global(.leaflet-container),
  &.isPicking :global(.leaflet-grab) {
    cursor: crosshair;
  }

  // While armed, every tap means "here" — including one that lands on a stop dot
  // or a bus pill. Making the two panes inert is one rule; branching every
  // marker's click handler would be twelve. The controls live in their own pane,
  // so zooming still works — picking a point you cannot see is not picking.
  //
  // The rule has to reach inside the panes. Leaflet gives every interactive
  // marker and path `pointer-events: auto` of its own, which beats the `none`
  // it would otherwise inherit, so a rule on the panes alone left each bus and
  // stop dot answering taps — measured: a pick made on the city centre landed on
  // the bus pill there and chose nothing. Three classes here against Leaflet's two.
  &.isPicking :global(.leaflet-overlay-pane),
  &.isPicking :global(.leaflet-marker-pane),
  &.isPicking :global(.leaflet-overlay-pane *),
  &.isPicking :global(.leaflet-marker-pane *) {
    pointer-events: none;
  }

  // No dark-mode filter here any more. The raster basemap had exactly one set of
  // tiles, both light, so dark meant inverting the tile pane and living with a
  // hue-rotate; the vector basemap ships a real dark flavor, and it is rendered
  // rather than filtered, so the route colours over it stay the colours we chose.
}

// Every SVG colour below is a CSS property, not a presentation attribute — a
// rule beats the attribute Leaflet writes, and custom properties resolve here.
.line {
  stroke: oklch(var(--route-l) var(--route-c) var(--hue));
  stroke-opacity: 0.95;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.casing {
  stroke: var(--route-casing);
  stroke-opacity: 0.55;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
}

.stop {
  stroke: var(--stop-ring);
  fill: var(--stop-fill);
  fill-opacity: 1;
  cursor: pointer;
}

// The inverse of an ordinary stop rather than a new colour: the 28 route hues
// already own colour on this map, so "the one you picked" has to be said with
// contrast instead — otherwise it reads as a twenty-ninth route.
// A stop on the one route being shown: its line's own colour, so the dot and the
// polyline are visibly the same thing. Bigger than an ordinary stop and smaller
// than the chosen one, which is the order of the questions they answer.
.stopOnRoute {
  stroke: oklch(var(--route-l) var(--route-c) var(--hue));
  fill: var(--stop-fill);
  fill-opacity: 1;
  cursor: pointer;
}

.stopSelected {
  stroke: var(--stop-selected-ring);
  fill: var(--stop-selected-fill);
  fill-opacity: 1;
  cursor: pointer;
  filter: drop-shadow(0 1px 3px var(--stop-selected-shadow));
}

// The halo is the honest part of "you are here": it is drawn at the accuracy the
// device reported, in metres, so it grows when the fix is poor instead of a dot
// silently asserting the same precision either way. Its radius is never
// animated — an expanding circle reads as a loop, and _motion.scss allows one.
.accuracy {
  stroke: var(--user-accuracy-ring);
  stroke-width: 1;
  fill: var(--user-accuracy-fill);
  fill-opacity: 1;
  pointer-events: none;
}

// Leaflet owns the marker's transform, so the dot inside does the centring —
// the same split as the vehicle pill.
.userIcon,
.endpointIcon {
  pointer-events: none;
}

.userDot {
  display: block;
  transform: translate(-50%, -50%);
  width: design.spacing(3.5);
  height: design.spacing(3.5);
  border: 3px solid var(--user-ring);
  border-radius: 50%;
  background-color: var(--user-fill);
  box-shadow: design.shadow(sm);
  transition: opacity motion.$standard motion.$ease-micro;
}

// Old enough that it may no longer be true. Opacity only: no size change and no
// pulse, because a second looping thing would devalue the one live pulse.
.isStale {
  opacity: 0.45;
}

// Too vague to point at a particular pole, so the dot stops pretending to.
.isCoarse {
  border-style: dashed;
  background-color: transparent;
}

// Which way the reader is facing: a wedge of the dot's own blue, fading as it
// leaves the dot. A wedge rather than an arrow, and a wide one, because a phone
// compass beside buses and railings is good to tens of degrees and an arrow
// would claim a precision the magnetometer has not got — the halo's lesson,
// applied to direction.
.beam {
  display: none;
  position: absolute;
  top: 0;
  left: 0;
  width: design.spacing(28);
  height: design.spacing(28);
  // Centre, then turn. Up is 0deg, which is north — the frame the heading is in.
  transform: translate(-50%, -50%) rotate(var(--heading, 0deg));
  background: radial-gradient(closest-side, var(--user-beam) 25%, transparent);
  // Without the mask this is a second halo pointing nowhere, so the prefixed
  // form is kept for the WebViews that still need it.
  -webkit-mask-image: conic-gradient(from -35deg, transparent, #000 10deg, #000 60deg, transparent 70deg);
  mask-image: conic-gradient(from -35deg, transparent, #000 10deg, #000 60deg, transparent 70deg);
  pointer-events: none;
  transition: opacity motion.$standard motion.$ease-micro;

  &.hasHeading {
    display: block;
  }
}

// The ends of a trip are neither stops nor buses, so they are the map's neutral
// ink — the chosen stop's inverted pair — rather than a twenty-ninth colour.
.startDot,
.endDot {
  display: block;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  box-shadow: design.shadow(sm);
}

.startDot {
  width: design.spacing(4);
  height: design.spacing(4);
  border: 4px solid var(--stop-selected-fill);
  background-color: var(--stop-fill);
}

.endDot {
  width: design.spacing(4.5);
  height: design.spacing(4.5);
  border: 3px solid var(--stop-selected-ring);
  background-color: var(--stop-selected-fill);
}

// On foot: dotted, round-ended, in the ink the stop rings use. A dash pattern
// set here beats Leaflet's `dashArray` attribute, as the colours do.
.walkLine {
  stroke: var(--stop-ring);
  stroke-opacity: 0.9;
  stroke-dasharray: 0.1 9;
  stroke-linecap: round;
  fill: none;
}

.journeyStop {
  stroke: oklch(var(--route-l) var(--route-c) var(--hue));
  fill: var(--stop-fill);
  fill-opacity: 1;
}

// The element Leaflet mounts into. Nothing reactive is bound to it.
.canvas {
  width: 100%;
  height: 100%;
}

// Leaflet owns this element's transform, so the pill inside does the centring.
.icon {
  will-change: transform;
}

.pill {
  display: flex;
  position: relative;
  gap: design.spacing(0.5);
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  min-width: design.spacing(6);
  height: design.spacing(5);
  padding: 0 design.spacing(1.5);
  border: 2px solid design.color(background);
  border-radius: design.radius(lg);
  background-color: oklch(var(--route-l) var(--route-c) var(--hue));
  box-shadow: design.shadow(sm);
  color: var(--route-label);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  transition: opacity motion.$standard motion.$ease-micro;

  // A 20px pill is not a touch target. This one is 44px and invisible.
  &::before {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 44px;
    height: 44px;
    transform: translate(-50%, -50%);
    content: "";
  }
}

// Parked, laid over, or finished for the day — still there, no longer news.
.isParked {
  opacity: 0.4;
}

.glyph {
  display: none;
  width: design.spacing(3);
  height: design.spacing(3);
}

// A nose on the pill's leading edge rather than a detached arrow floating
// beside it, which reads as a compass needle instead of as a vehicle.
// The transform order is the whole trick: centre first, then rotate, then push
// out — rotating a box still offset by its own size swings it around the wrong
// point.
.nose {
  display: none;
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  transform: translate(-50%, -50%) rotate(var(--heading, 0deg)) translateY(calc(-1 * design.spacing(3)));
  border-right: 4px solid transparent;
  // Pointing up at 0deg, which is north — the same frame the bearing is in.
  border-bottom: 7px solid oklch(var(--route-l) var(--route-c) var(--hue));
  border-left: 4px solid transparent;
  filter: drop-shadow(0 0 1px design.color(background));
  transition: transform motion.$heading motion.$ease-micro;
}

// Zoom tiers, decided once on the container rather than per marker.
.tierDot .pill {
  min-width: 0;
  width: design.spacing(2.5);
  height: design.spacing(2.5);
  padding: 0;
  border-width: 1px;
  border-radius: 50%;

  b {
    display: none;
  }
}

.tierPill .hasHeading .nose {
  display: block;
}

.tierGlyph .glyph {
  display: block;
}

// Leaflet writes marker positions as transforms, so the glide belongs there —
// and it lasts a whole poll interval, so a bus moves continuously instead of
// lurching for a second and then standing still for four.
.root :global(.leaflet-marker-icon).isGliding {
  transition: transform var(--glide, 5000ms) linear;
}

.root.isZooming :global(.leaflet-marker-icon) {
  transition: none;
}

@include motion.reduced {
  // The glide is deliberately kept: a bus that teleports every five seconds is
  // worse for a motion-sensitive reader than one that moves smoothly. Only the
  // turn is dropped.
  .nose {
    transition: none;
  }

  .userDot {
    transition: none;
  }
}
</style>
