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
import "leaflet/dist/leaflet.css";
import { useResizeObserver } from "@surstromming/util";
import type { Stop, Vehicle } from "@/api/types";

export interface MapShape {
  id: string;
  hue: number;
  points: [number, number][];
}

const props = withDefaults(
  defineProps<{
    stops: Stop[];
    vehicles: Vehicle[];
    shapes: MapShape[];
    /** Pans to this stop when it changes. */
    focusStopId?: string | null;
    userPosition?: { lat: number; lon: number } | null;
    /** Milliseconds between polls — how long a bus has to glide to its new fix. */
    glideMs?: number;
    /** Room to leave at the bottom when flying to a stop, for the mobile sheet. */
    bottomInset?: number;
  }>(),
  { focusStopId: null, userPosition: null, glideMs: 5000, bottomInset: 0 },
);

const emit = defineEmits<{
  selectStop: [id: string];
  selectVehicle: [id: string];
}>();

const $style = useCssModule();

// Batumi's centre, and the box the network actually occupies — panning to
// Tbilisi from a bus map is never what anyone meant to do.
const CENTRE: L.LatLngExpression = [41.641, 41.63];
const BOUNDS = L.latLngBounds([41.55, 41.5], [41.75, 41.78]);
/** Below this, 578 stop dots are a smear rather than information. */
const STOPS_FROM_ZOOM = 15;
/** Below this a route number cannot be read, so a bus becomes a coloured dot. */
const PILL_FROM_ZOOM = 13;
/** Only this close is there room for a glyph beside the number. */
const GLYPH_FROM_ZOOM = 16;

const container = useTemplateRef<HTMLElement>("container");
const zoom = ref(14);
const zooming = ref(false);

// Tier is a class on the wrapper, not a per-marker decision: 150 markers should
// not each be asked what zoom it is.
const classes = computed(() => [
  $style.root,
  zoom.value < PILL_FROM_ZOOM ? $style.tierDot : $style.tierPill,
  { [$style.tierGlyph]: zoom.value >= GLYPH_FROM_ZOOM, [$style.isZooming]: zooming.value },
]);

let map: L.Map | undefined;
let shapeLayer: L.LayerGroup | undefined;
let stopLayer: L.LayerGroup | undefined;
let vehicleLayer: L.LayerGroup | undefined;
let userMarker: L.CircleMarker | undefined;

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

  const draw = (stop: Stop, selected: boolean) =>
    L.circleMarker([stop.lat, stop.lon], {
      radius: selected ? 8 : 4,
      weight: selected ? 3 : 2,
      className: selected ? $style.stopSelected : $style.stop,
    })
      .on("click", () => emit("selectStop", stop.id))
      .addTo(stopLayer!);

  let chosen: Stop | undefined;

  for (const stop of props.stops) {
    if (stop.id === props.focusStopId) {
      chosen = stop;
      continue;
    }
    if (crowded) continue;
    if (!view?.contains([stop.lat, stop.lon])) continue;
    draw(stop, false);
  }

  // Last, so it sits above the ordinary stop that may be a few metres away —
  // and at every zoom, because a highlight that disappears when you zoom out,
  // while its arrival panel stays open, reads as the map losing track of it.
  if (chosen && view?.contains([chosen.lat, chosen.lon])) draw(chosen, true);
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

const drawUser = () => {
  if (!map) return;

  if (!props.userPosition) {
    userMarker?.remove();
    userMarker = undefined;
    return;
  }

  const at: L.LatLngExpression = [props.userPosition.lat, props.userPosition.lon];

  if (userMarker) {
    userMarker.setLatLng(at);
    return;
  }

  userMarker = L.circleMarker(at, { radius: 7, weight: 3, className: $style.user }).addTo(map);
  // Only on the first fix. Pressing "my location" and being shown a dot
  // somewhere off screen is the same as being shown nothing — but a later fix
  // must not yank the map away from wherever the reader has panned to.
  map.flyTo(at, Math.max(map.getZoom(), 15), { duration: 0.8 });
};

onMounted(() => {
  if (!container.value) return;

  container.value.style.setProperty("--glide", `${props.glideMs}ms`);
  map = L.map(container.value, {
    center: CENTRE,
    zoom: 14,
    minZoom: 11,
    maxBounds: BOUNDS,
    maxBoundsViscosity: 0.7,
    zoomControl: false,
    attributionControl: true,
  });

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    // "contributors" is not decoration — it is the wording ODbL attribution asks for.
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  L.control.zoom({ position: "bottomright" }).addTo(map);

  shapeLayer = L.layerGroup().addTo(map);
  stopLayer = L.layerGroup().addTo(map);
  vehicleLayer = L.layerGroup().addTo(map);

  // A zoom rewrites every marker transform at once, and animating that reads as
  // the fleet sliding off the map — so the glide is dropped for the duration.
  map.on("zoomstart", () => (zooming.value = true));
  map.on("zoomend", () => {
    zooming.value = false;
    zoom.value = map?.getZoom() ?? zoom.value;
    drawStops();
    drawVehicles();
  });
  map.on("moveend", () => {
    drawStops();
    drawVehicles();
  });

  zoom.value = map.getZoom();
  drawShapes();
  drawStops();
  drawVehicles();
  drawUser();
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
watch(() => props.vehicles, drawVehicles);
watch(() => props.userPosition, drawUser);
watch(
  () => props.glideMs,
  (ms) => container.value?.style.setProperty("--glide", `${ms}ms`),
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

  // OSM ships one set of raster tiles and they are light. Inverting the tile
  // pane alone — not the markers drawn over it — is what keeps a dark map from
  // turning every route colour into its complement. Desaturated and dimmed a
  // little further than a straight inversion, so the map recedes and the route
  // colours are what lead.
  #{design.$darkThemeSelector} & :global(.leaflet-tile-pane) {
    filter: invert(1) hue-rotate(180deg) brightness(0.86) contrast(0.88) saturate(0.55);
  }
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
.stopSelected {
  stroke: var(--stop-selected-ring);
  fill: var(--stop-selected-fill);
  fill-opacity: 1;
  cursor: pointer;
  filter: drop-shadow(0 1px 3px var(--stop-selected-shadow));
}

.user {
  stroke: var(--user-ring);
  fill: var(--user-fill);
  fill-opacity: 1;
  pointer-events: none;
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
}
</style>
