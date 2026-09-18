<template>
  <main ref="root" :class="$style.root">
    <TransitMap
      :stops="transit.stops"
      :vehicles="transit.visibleVehicles"
      :shapes="shapes"
      :focus-stop-id="selectedStopId"
      :user-position="userPosition"
      :user-stale="userStale"
      :picking="picking"
      :journey="journeyOnMap"
      :endpoints="endpoints"
      :fly-to="flyTo"
      :fit-to="fitTo"
      :sources="basemapSources"
      :route-stops="routeStops"
      :lang="locale.locale"
      :dark="theme === 'dark'"
      :glide-ms="transit.POLL_MS"
      :bottom-inset="sheetInset"
      @select-stop="selectStop"
      @select-vehicle="toggleVehicleRoute"
      @pick-point="onPickPoint"
      @view-change="view = $event"
    />

    <!-- Armed for a point pick. A keyboard or screen-reader user cannot see a
         crosshair cursor, so the mode change has to be said out loud. -->
    <Transition
      :enter-from-class="$style.bannerHidden"
      :leave-to-class="$style.bannerHidden"
      :enter-active-class="$style.bannerMoving"
      :leave-active-class="$style.bannerMoving"
    >
      <div v-if="picking" :class="$style.banner" role="status" aria-live="polite">
        <Icon :icon="MapPin" :size="16" />
        <p :class="$style.bannerText">{{ locale.t(pickHint) }}</p>
        <Button variant="ghost" size="sm" :class="$style.bannerCancel" @click="planner.disarm()">
          {{ locale.t("cancel") }}
        </Button>
      </div>
    </Transition>

    <div :class="$style.controls">
      <Button
        variant="secondary"
        size="icon"
        :aria-label="locale.t(locateLabel)"
        :title="locateTitle"
        :disabled="proximity.locating"
        @click="onLocate"
      >
        <Spinner v-if="proximity.locating" :size="16" />
        <Icon v-else :icon="locateIcon" :class="{ [$style.isTracking]: meInView }" />
      </Button>
    </div>

    <!-- One sheet, three modes: a stop's arrivals, a planned trip, or nothing —
         swapping contents inside it never animates. -->
    <Transition
      :enter-from-class="$style.sheetHidden"
      :leave-to-class="$style.sheetHidden"
      :enter-active-class="$style.sheetMoving"
      :leave-active-class="$style.sheetMoving"
    >
      <aside v-if="mode !== 'none'" ref="panel" :class="$style.panel">
        <i :class="$style.grip" aria-hidden="true" />

        <div :class="$style.panelHead">
          <!-- Back and close are different intents, so they get different
               glyphs. Back exists only when there is something to go back to:
               the trip a stop was opened from, or the options a step list
               was opened from. -->
          <Button v-if="backKey" variant="ghost" size="icon" :aria-label="locale.t(backKey)" @click="goBack">
            <Icon :icon="ArrowLeft" />
          </Button>

          <div :class="$style.panelTitle">
            <template v-if="mode === 'stop' && selectedStop">
              <h2 :class="$style.stopName">{{ locale.name(selectedStop.name) }}</h2>
              <p :class="$style.stopCode">{{ locale.t("stopNumber") }} {{ selectedStop.code }}</p>
            </template>
            <template v-else>
              <h2 :class="$style.stopName">{{ locale.t("planTrip") }}</h2>
              <p :class="$style.tripEnds">{{ tripEnds }}</p>
            </template>
          </div>

          <!-- On a phone the fields are behind the drawer; this is the way back
               to them without closing the trip. -->
          <Button
            v-if="mode === 'plan' && isMobile"
            variant="ghost"
            size="icon"
            :aria-label="locale.t('editTrip')"
            @click="sidebar.toggle()"
          >
            <Icon :icon="Pencil" />
          </Button>
          <Button variant="ghost" size="icon" :aria-label="locale.t('close')" @click="closeSheet">
            <Icon :icon="X" />
          </Button>
        </div>

        <!-- "Directions" on a stop, as on any place card: the stop becomes one
             end of a trip, and the other end is what the reader fills in. -->
        <div v-if="mode === 'stop' && selectedStop" :class="$style.endButtons">
          <Button variant="outline" size="sm" @click="useStopAs('from')">{{ locale.t("directionsFrom") }}</Button>
          <Button variant="outline" size="sm" @click="useStopAs('to')">{{ locale.t("directionsTo") }}</Button>
        </div>

        <Alert v-if="mode === 'plan' && usesMe && proximity.coarse" :title="locale.t('coarseFix')" />

        <ScrollArea :class="$style.panelBody">
          <!-- On the map the board doubles as the route filter: each row already
               names a line and where it is going, so pressing it draws that line
               rather than adding a second list of the same numbers above. -->
          <ArrivalBoard
            v-if="mode === 'stop' && selectedStop"
            :arrivals="arrivals"
            :loading="loading"
            :serves-nothing="!selectedStop.routeIds.length"
            :failed="failed"
            selectable
            :selected-route-ids="transit.selectedRouteIds"
            @select-route="transit.toggleRoute"
          />

          <template v-else-if="mode === 'plan'">
            <div v-if="planState === 'loading'" :class="$style.planState">
              <Spinner :size="16" />
              {{ locale.t("loading") }}
            </div>

            <div v-else-if="planState === 'failed'" :class="$style.planState">
              <p>{{ locale.t("loadFailed") }}</p>
              <Button variant="outline" size="sm" @click="planner.loadTimetable()">{{ locale.t("retry") }}</Button>
            </div>

            <div v-else-if="planState === 'locating'" :class="$style.planState">
              <Spinner v-if="proximity.locating" :size="16" />
              {{ locale.t(proximity.locating ? "locating" : "needLocation") }}
            </div>

            <div v-else-if="planState === 'nothing'" :class="$style.planState">
              <p :class="$style.planStateTitle">{{ locale.t(nothingKey) }}</p>
              <!-- Somewhere nearby can help a trip no bus makes; nothing helps an
                   end with no stop anywhere near it, and the title says which. -->
              <p v-if="nothingKey === 'noJourney'">{{ locale.t("noJourneyDetail") }}</p>
            </div>

            <JourneySteps
              v-else-if="planner.showSteps && journey"
              :journey="journey"
              :from-label="format.place(planner.from)"
              :to-label="format.place(planner.to)"
              :live="live"
              @select-stop="selectStop"
            />

            <JourneyOptions
              v-else-if="planner.result"
              :result="planner.result"
              :selected-key="journey?.key ?? null"
              :live="liveByKey"
              @select="planner.selectJourney"
            />
          </template>
        </ScrollArea>

        <p v-if="mode === 'plan' && planState === 'ready'" :class="$style.planNote">{{ locale.t("planNote") }}</p>

        <RouterLink
          v-if="mode === 'stop' && selectedStop"
          :to="`/stops/${selectedStop.id}`"
          :class="$style.panelLink"
          @click="proximity.clearOrigin()"
        >
          {{ locale.t("timetable") }} →
        </RouterLink>
      </aside>
    </Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { RouterLink } from "vue-router";
import { ArrowLeft, Locate, LocateFixed, LocateOff, MapPin, Pencil, X } from "lucide";
import { Alert } from "@surstromming/alert";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { Spinner } from "@surstromming/spinner";
import { isMobile } from "@surstromming/util";
import TransitMap, {
  type MapEndpoints,
  type MapFit,
  type MapFlyTo,
  type MapJourney,
  type MapShape,
  type MapView,
} from "@/components/map/TransitMap.vue";
import { cacheArchives, loadManifest, openArchive, type ArchiveSource } from "@/components/map/archives";
import ArrivalBoard from "@/components/ArrivalBoard.vue";
import JourneyOptions from "@/components/JourneyOptions.vue";
import JourneySteps from "@/components/JourneySteps.vue";
import { nextBus, useArrivals, useArrivalsAt, type NextBus } from "@/composables/useArrivals";
import { useJourneyFormat } from "@/composables/useJourneyFormat";
import { useNow } from "@/composables/useNow";
import { useTheme } from "@/composables/useTheme";
import { metresBetween } from "@/planner/geo";
import { sliceLine } from "@/planner/geometry";
import type { Journey, RideLeg } from "@/planner/plan";
import { useLocale } from "@/stores/locale";
import { usePlanner, type PlaceField } from "@/stores/planner";
import { useProximity, STALE_AFTER_MS } from "@/stores/proximity";
import { useSidebar } from "@/stores/sidebar";
import { useToasts } from "@/stores/toasts";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const toasts = useToasts();
const locale = useLocale();
const proximity = useProximity();
const planner = usePlanner();
const sidebar = useSidebar();
const format = useJourneyFormat();
const now = useNow();
// The basemap labels streets from the selected locale and ships its own dark
// flavor, so both are data the map is given rather than state it looks up.
const { theme } = useTheme();

await transit.loadNetwork();

// The archives are read from the browser's own storage once they have been there
// once. Resolved before the map is built — an IndexedDB lookup, not a download —
// so the map never starts on the network and then swaps underneath the reader.
const base = import.meta.env.BASE_URL;
const manifest = await loadManifest(base);
const basemapSources = ref<{ detail: ArchiveSource; overview: ArchiveSource } | null>(null);

if (manifest) {
  basemapSources.value = {
    detail: await openArchive(base, manifest.archives.detail!),
    overview: await openArchive(base, manifest.archives.overview!),
  };
}

const stopWatching = transit.watchVehicles();
onUnmounted(stopWatching);

// The map is the one screen where a live dot earns its battery: it is a claim
// rendered beside a live bus, and the decision it supports is made while
// walking. The watch stops with the page and pauses with the tab.
const stopLocating = proximity.watchPosition();
onUnmounted(stopLocating);

const root = useTemplateRef<HTMLElement>("root");
const panel = useTemplateRef<HTMLElement>("panel");

const selectedStopId = ref<string | null>(null);
const selectedStop = computed(() =>
  selectedStopId.value ? transit.stopById.get(selectedStopId.value) : undefined,
);

const { arrivals, loading, failed } = useArrivals(selectedStopId);

const view = ref<MapView | null>(null);
const flyTo = ref<MapFlyTo | null>(null);
let flight = 0;

const flyToPoint = (lat: number, lon: number, zoom?: number) => {
  flight += 1;
  flyTo.value = { lat, lon, zoom, nonce: flight };
};

const userPosition = computed(() =>
  proximity.fix ? { lat: proximity.fix.lat, lon: proximity.fix.lon, accuracy: proximity.fix.accuracy } : null,
);

const userStale = computed(() => !!proximity.fix && now.value - proximity.fix.at > STALE_AFTER_MS);

// Shrunk on each axis, so a dot pinned to the very edge still counts as lost —
// a "you are here" you have to hunt for at the border is not showing you.
const meInView = computed(() => {
  const box = view.value;
  const fix = proximity.fix;
  if (!box || !fix) return false;
  const padLat = (box.north - box.south) * 0.12;
  const padLon = (box.east - box.west) * 0.12;
  return (
    fix.lat > box.south + padLat &&
    fix.lat < box.north - padLat &&
    fix.lon > box.west + padLon &&
    fix.lon < box.east - padLon
  );
});

const locateIcon = computed(() => {
  if (proximity.denied) return LocateOff;
  return meInView.value ? LocateFixed : Locate;
});

const locateLabel = computed<"followMe" | "centreOnMe" | "locationDenied">(() => {
  if (proximity.denied) return "locationDenied";
  return proximity.fix && !meInView.value ? "centreOnMe" : "followMe";
});

// Composed here rather than in messages.ts: one interpolated string is not worth
// growing the message format for.
const locateTitle = computed(() =>
  proximity.fix && Number.isFinite(proximity.fix.accuracy)
    ? `${locale.t("accuracyLabel")} ±${Math.round(proximity.fix.accuracy)} ${locale.t("metresAway")}`
    : locale.t(locateLabel.value),
);

// A position we already hold goes on screen now; the refresh that follows is
// silent. Waiting twenty seconds for a fix before moving to the dot we are
// already drawing is the thing that made this button feel broken.
//
// It asks for a fix and nothing else. It used to set the stop page's "back to
// stops near you" origin as well, so a stop opened from the map after pressing
// it offered a way back to a list the reader had never seen.
const onLocate = () => {
  if (!proximity.fix) {
    proximity.locate();
    return;
  }
  proximity.locate({ silent: true });
  if (!nearTheNetwork(proximity.fix)) {
    toasts.push({ title: locale.t("farFromBatumi"), duration: 4000 });
    return;
  }
  flyToPoint(proximity.fix.lat, proximity.fix.lon);
};

/**
 * Whether a fix is somewhere this map can show. The map is held inside Batumi's
 * bounds, so flying to a fix in Tbilisi — or to the 0°, 0° a browser with no
 * real position reports — stops at the edge of the bounds over open sea, and the
 * reader is left looking at water with no idea why.
 */
const NEAR_THE_NETWORK_METRES = 5000;
const nearTheNetwork = (point: { lat: number; lon: number }) =>
  transit.stops.some((stop) => metresBetween(stop, point) <= NEAR_THE_NETWORK_METRES);

type SheetMode = "none" | "stop" | "plan";
const mode = computed<SheetMode>(() => {
  // Asked to tap the map, the reader gets the whole of it: on a phone the sheet
  // is half the screen, and half the city is not somewhere they can point.
  if (planner.picking) return "none";
  if (selectedStopId.value) return "stop";
  return planner.active ? "plan" : "none";
});

const selectStop = (id: string) => {
  selectedStopId.value = id;
};

// One end chosen while the other is still being chosen. A stop — from its own
// sheet's «Отсюда»/«Сюда» — keeps its arrivals open, since they are the useful
// thing to show meanwhile. A place found by name is flown to, because where it
// is, is the first thing to check about an address picked from a list. Both
// ends chosen: the trip is the answer, and a stop left open over it would hide it.
watch(
  () => [planner.from, planner.to] as const,
  ([from, to], previous) => {
    if (from && to) {
      selectedStopId.value = null;
      return;
    }
    const only = from ?? to;
    if (only?.kind === "stop") selectedStopId.value = only.stopId;
    // Only a place just chosen: not one left behind when the other end was
    // cleared by typing over it, and not the same place moved by a swap.
    const [oldFrom, oldTo] = previous ?? [];
    if (only?.kind === "place" && only !== oldFrom && only !== oldTo) flyToPoint(only.place.lat, only.place.lon, 17);
  },
  { immediate: true },
);

const backKey = computed<"backToTrip" | "backToOptions" | null>(() => {
  if (mode.value === "stop" && planner.active) return "backToTrip";
  if (mode.value === "plan" && planner.showSteps) return "backToOptions";
  return null;
});

const goBack = () => {
  if (mode.value === "stop") selectedStopId.value = null;
  else planner.backToOptions();
};

// Closing a stop returns to whatever was under it. Closing a trip ends it — the
// fields empty with it — because a plan with nowhere to show it is a plan the
// map would keep drawing for no one.
const closeSheet = () => {
  if (mode.value === "stop") selectedStopId.value = null;
  else planner.clear();
};

const useStopAs = (field: PlaceField) => {
  if (!selectedStop.value) return;
  planner.setPlace(field, { kind: "stop", stopId: selectedStop.value.id });
  // Still one end short: the fields are where the reader goes next, and on a
  // phone they are behind the drawer.
  if (!planner.active && isMobile.value) sidebar.open = true;
};

const picking = computed(() => !!planner.picking);
const pickHint = computed<"pickFromHint" | "pickToHint">(() =>
  planner.picking === "from" ? "pickFromHint" : "pickToHint",
);

const onPickPoint = (point: { lat: number; lon: number }) => {
  planner.pickAt(point.lat, point.lon);
  if (!planner.active && isMobile.value) sidebar.open = true;
};

// Escape cancels the pick, and only the pick — never stolen from the sidebar
// drawer or a menu, which own it when nothing is armed.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !planner.picking) return;
  planner.disarm();
};

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  // After the map is up, never before it: this is for the next visit.
  if (manifest) void cacheArchives(base, manifest);
  // Only ever acts when permission is already granted — an automatic prompt is
  // how an app teaches people to press Block.
  void proximity.init();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  // Arriving on another page still armed would leave a mode nobody can see.
  planner.disarm();
  // The feed goes back to the reader's own selection on every other page.
  transit.setFocus(null);
});

// The first fix of a session goes on screen without being asked for; later ones
// must not yank the map away from wherever the reader has panned to. Nor must
// the first, when a trip is already on the map: the trip is what was asked for.
let flownToFirstFix = false;
watch(
  () => proximity.fix,
  (fix) => {
    if (!fix || flownToFirstFix) return;
    flownToFirstFix = true;
    if (planner.active || !nearTheNetwork(fix)) return;
    flyToPoint(fix.lat, fix.lon, 16);
  },
  { immediate: true },
);

// On a phone the sheet covers the bottom half, so flying a stop to the centre
// of the map puts it underneath. The map is told how much room to leave.
const sheetInset = computed(() => (isMobile.value ? window.innerHeight * 0.5 : 0));

// Clicking a bus is a question about its line, and the pill answers it exactly
// as the sidebar chip does — the line goes on, or comes off again. Two ways to
// pick a route that disagreed about what a second press means would be worse
// than either rule alone, and the pill is the only undo a thumb is already on.
//
// Not while a trip is on the map: the selection is hidden then, so a press would
// change something the reader cannot see and find changed later.
const toggleVehicleRoute = (vehicleId: string) => {
  if (planner.active) return;
  const vehicle = transit.vehicles.find((candidate) => candidate.id === vehicleId);
  if (vehicle) transit.toggleRoute(vehicle.routeId);
};

// Only when exactly one route is drawn. With two the colours would compete and
// with none it is every stop in the city, which the zoom rule already handles —
// this answers "where does this line stop", which is only a question when there
// is one line. A trip on the map draws its own.
const routeStops = computed(() => {
  if (planner.active || transit.selectedRouteIds.length !== 1) return null;
  const id = transit.selectedRouteIds[0]!;
  const route = transit.routeById.get(id);
  if (!route) return null;
  return { ids: transit.stops.filter((stop) => stop.routeIds.includes(id)).map((stop) => stop.id), hue: route.hue };
});

// Only selected routes are drawn; with nothing selected the map is the live
// fleet over a plain city, which is the view most people open it for. A trip
// replaces them with the stretches of line it actually rides.
const shapes = computed<MapShape[]>(() =>
  planner.active
    ? []
    : transit.selectedRouteIds
        .map((id) => transit.routeDetails.get(id))
        .filter((detail) => detail !== undefined)
        .map((detail) => ({ id: detail.id, hue: detail.hue, points: detail.shape })),
);

watch(
  () => transit.selectedRouteIds,
  (ids) => ids.forEach((id) => void transit.loadRouteDetail(id)),
  { immediate: true },
);

/* The trip. */

const journey = computed(() => (planner.active ? planner.selectedJourney : null));
const rides = computed(() => journey.value?.legs.filter((leg): leg is RideLeg => leg.kind === "ride") ?? []);
const usesMe = computed(() => planner.from?.kind === "me" || planner.to?.kind === "me");

const tripEnds = computed(() => `${format.place(planner.from)} → ${format.place(planner.to)}`);

type PlanState = "loading" | "failed" | "locating" | "nothing" | "ready";
const planState = computed<PlanState>(() => {
  if (planner.waitingForFix) return "locating";
  if (planner.timetableFailed && !planner.timetable) return "failed";
  const result = planner.result;
  if (!result) return "loading";
  if (result.noStopsNear || !result.journeys.length) return "nothing";
  return "ready";
});

const nothingKey = computed<"noStopsNearFrom" | "noStopsNearTo" | "noJourney">(() => {
  const near = planner.result?.noStopsNear;
  if (near === "from") return "noStopsNearFrom";
  if (near === "to") return "noStopsNearTo";
  return "noJourney";
});

// A plan with an end at "me" and no fix yet asks for one — the reader chose
// "my location", so this is the press that is allowed to prompt.
watch(
  () => planner.waitingForFix,
  (waiting) => {
    if (waiting && !proximity.locating && !proximity.denied) proximity.locate();
  },
  { immediate: true },
);

// The lines a trip rides are the buses worth seeing; the other forty are noise
// while you are looking for yours.
watch(
  rides,
  (list) => {
    const ids = [...new Set(list.map((leg) => leg.routeId))];
    transit.setFocus(ids.length ? ids : null);
    ids.forEach((id) => void transit.loadRouteDetail(id).catch(() => {}));
  },
  { immediate: true },
);

// Every option's first bus, as the live feed sees it. A plan is timed by
// distance, not by the timetable, so when the next bus comes is the feed's to
// say — beside each option, and in the steps of the one chosen. One poll over
// the few stops the options get on at; only the first bus, because it is the
// one someone decides whether to run for, and the rest depend on it anyway.
const firstRide = (trip: Journey) => trip.legs.find((leg): leg is RideLeg => leg.kind === "ride");
const boardingStops = computed(() =>
  mode.value === "plan"
    ? (planner.result?.journeys ?? []).map(firstRide).flatMap((leg) => (leg ? [leg.fromStopId] : []))
    : [],
);
const { boards } = useArrivalsAt(boardingStops);
const liveByKey = computed(() => {
  const found: Record<string, NextBus | null> = {};
  for (const trip of planner.result?.journeys ?? []) {
    const first = firstRide(trip);
    const board = first ? boards.value.get(first.fromStopId) : undefined;
    if (!first || !board) continue;
    found[trip.key] = nextBus(board, [{ routeId: first.routeId, direction: first.direction }, ...(first.also ?? [])]);
  }
  return found;
});
const live = computed(() => (journey.value ? (liveByKey.value[journey.value.key] ?? null) : null));

const stopPoint = (id: string | null): [number, number] | null => {
  const stop = id ? transit.stopById.get(id) : undefined;
  return stop ? [stop.lat, stop.lon] : null;
};

// The stretch of line between getting on and getting off. Cut from the route's
// own shape where it has loaded and still agrees with the plan; until then — or
// from a cached copy older than `along` — the stops themselves, joined, which
// run along the same streets.
const ridePoints = (leg: RideLeg): [number, number][] => {
  const detail = transit.routeDetails.get(leg.routeId);
  const direction = detail?.directions.find((candidate) => candidate.direction === leg.direction);
  const along = direction?.along;
  if (detail && along && direction.stopIds[leg.board] === leg.fromStopId) {
    if (direction.stopIds[leg.alight] === leg.toStopId) {
      const cut = sliceLine(detail.shape, along[leg.board]!, along[leg.alight]!);
      if (cut.length > 1) return cut;
    }
    // On through the terminal: to the end of this direction, then along the
    // other one to the stop. Two cuts of the same round-trip shape.
    const other = detail.directions.find((candidate) => candidate.direction !== leg.direction);
    const at = other?.stopIds.indexOf(leg.toStopId) ?? -1;
    if (other?.along && at >= 0) {
      const before = sliceLine(detail.shape, along[leg.board]!, along.at(-1)!);
      const after = sliceLine(detail.shape, other.along[0]!, other.along[at]!);
      const joined = [...(before.length > 1 ? before : []), ...after];
      if (joined.length > 1) return joined;
    }
  }
  return leg.stopIds.map(stopPoint).filter((point) => point !== null);
};

const journeyOnMap = computed<MapJourney | null>(() => {
  const trip = journey.value;
  if (!trip || mode.value === "none") return null;
  const start = planner.fromPoint ? ([planner.fromPoint.lat, planner.fromPoint.lon] as [number, number]) : null;
  const end = planner.toPoint ? ([planner.toPoint.lat, planner.toPoint.lon] as [number, number]) : null;

  return {
    legs: trip.legs.map((leg) => {
      if (leg.kind === "ride") {
        return { kind: "ride" as const, hue: transit.routeById.get(leg.routeId)?.hue ?? 0, points: ridePoints(leg) };
      }
      const from = stopPoint(leg.fromStopId) ?? start;
      const to = stopPoint(leg.toStopId) ?? end;
      return { kind: "walk" as const, points: from && to ? [from, to] : [] };
    }),
    stops: rides.value.flatMap((leg) =>
      [leg.fromStopId, leg.toStopId].map((id) => {
        const stop = transit.stopById.get(id)!;
        return { lat: stop.lat, lon: stop.lon, hue: transit.routeById.get(leg.routeId)?.hue ?? 0 };
      }),
    ),
  };
});

// "Me" is already the blue dot; a second mark on top of it would be noise.
const endpoints = computed<MapEndpoints>(() => ({
  from: planner.from && planner.from.kind !== "me" ? planner.fromPoint : null,
  to: planner.to && planner.to.kind !== "me" ? planner.toPoint : null,
}));

const fitTo = ref<MapFit | null>(null);
let fits = 0;

// The whole trip, clear of the sheet over it. Measured off the laid-out sheet
// rather than restated from its CSS; offsets, not the bounding box, because the
// sheet may still be sliding in and a transform would report it off screen.
const fitJourney = async () => {
  await nextTick();
  const points = journeyOnMap.value?.legs.flatMap((leg) => leg.points) ?? [];
  if (points.length < 2) return;

  const lats = points.map(([lat]) => lat);
  const lons = points.map(([, lon]) => lon);
  const sheet = panel.value;
  const height = root.value?.clientHeight ?? 0;

  fits += 1;
  fitTo.value = {
    south: Math.min(...lats),
    west: Math.min(...lons),
    north: Math.max(...lats),
    east: Math.max(...lons),
    left: sheet && !isMobile.value ? sheet.offsetLeft + sheet.offsetWidth : 0,
    bottom: sheet && isMobile.value ? Math.max(0, height - sheet.offsetTop) : 0,
    nonce: fits,
  };
};

// Refitted when the trip changes — another option, another end — and not on
// the half-minute re-plan, which would snatch the map back from wherever the
// reader had moved it. "Me" moving does not count as the end changing.
const fitKey = computed(() => {
  if (!journey.value || mode.value !== "plan") return null;
  return JSON.stringify([journey.value.key, planner.from, planner.to]);
});
watch(fitKey, (key) => {
  if (key) void fitJourney();
});

// And on arrival: coming back to the map mid-trip should show the trip. Not as
// an immediate watch — during setup the map is not built to receive the request
// (it acts on a change, and a request made before it exists is no change) and
// the sheet is not laid out to be measured. Both are, by the time this runs.
onMounted(() => {
  if (fitKey.value) void fitJourney();
});
</script>

<style module lang="scss">
@use "@surstromming/design" as design;
@use "../../styles/motion" as motion;

// The shell mixin makes `#app > main` a scroller, which is right for a page of
// text and wrong for a map: a map owns its own gestures. Matching the mixin's
// own specificity is what lets this say otherwise.
:global(#app) > .root {
  position: relative;
  overflow: hidden;
}

// On a phone the stop sheet owns the bottom of the screen, so the one control
// that has to stay reachable moves to the top instead of hiding under it.
.controls {
  position: absolute;
  top: design.spacing(3);
  right: design.spacing(3);
  z-index: design.z-index(popover);

  @include design.screen(md) {
    top: auto;
    bottom: design.spacing(24);
  }
}

// Says "the dot is on screen" with the same blue the dot itself uses.
.isTracking {
  color: var(--user-fill);
}

.banner {
  display: flex;
  position: absolute;
  z-index: design.z-index(popover);
  top: design.spacing(3);
  // Clears the locate button, which sits top-right on a phone.
  right: design.spacing(16);
  left: design.spacing(3);
  gap: design.spacing(2);
  align-items: center;
  padding: design.spacing(2) design.spacing(3);
  border: 1px solid design.color(border);
  border-radius: design.radius(md);
  background-color: design.color(card);
  box-shadow: design.shadow(md);
  color: design.color(card-foreground);

  @include design.screen(md) {
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    max-width: design.spacing(120);
  }
}

// Russian and Georgian run longer than the English here, so this wraps to two
// lines on a narrow phone rather than ellipsing the instruction away.
.bannerText {
  flex: 1;
  min-width: 0;
  font-size: 0.8125rem;
}

.bannerCancel {
  flex-shrink: 0;
}

.bannerHidden {
  transform: translateY(calc(-1 * design.spacing(4)));
  opacity: 0;

  @include design.screen(md) {
    transform: translateX(-50%) translateY(calc(-1 * design.spacing(4)));
  }
}

.bannerMoving {
  transition:
    transform motion.$standard motion.$ease-enter,
    opacity motion.$standard motion.$ease-enter;
}

.panel {
  display: flex;
  position: absolute;
  z-index: design.z-index(popover);
  flex-direction: column;
  gap: design.spacing(2);
  padding: design.spacing(4);
  border: 1px solid design.color(border);
  background-color: design.color(card);
  box-shadow: design.shadow(md);
  color: design.color(card-foreground);

  // A bottom sheet on a phone, a floating card once there is room beside the
  // map — the same panel, not two.
  right: 0;
  bottom: 0;
  left: 0;
  max-height: 60%;
  border-radius: design.radius(lg) design.radius(lg) 0 0;

  @include design.screen(md) {
    top: design.spacing(4);
    right: auto;
    bottom: auto;
    left: design.spacing(4);
    width: design.spacing(88);
    max-height: calc(100% - #{design.spacing(8)});
    border-radius: design.radius(lg);
  }
}

// A phone's sheet needs a handle to read as one; on desktop it is a card.
.grip {
  width: design.spacing(8);
  height: design.spacing(1);
  margin: calc(-1 * design.spacing(2)) auto design.spacing(1);
  border-radius: design.radius(lg);
  background-color: design.color(border);

  @include design.screen(md) {
    display: none;
  }
}

.sheetHidden {
  transform: translateY(100%);

  @include design.screen(md) {
    transform: translateY(design.spacing(2));
    opacity: 0;
  }
}

.sheetMoving {
  transition:
    transform motion.$emphasized motion.$ease-enter,
    opacity motion.$emphasized motion.$ease-enter;
}

@include motion.reduced {
  .sheetMoving,
  .bannerMoving {
    transition: none;
  }
}

.panelHead {
  display: flex;
  gap: design.spacing(2);
  align-items: flex-start;
  justify-content: space-between;
}

.panelTitle {
  flex: 1;
  min-width: 0;
}

.stopName {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.stopCode {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

.panelBody {
  min-height: 0;
}

// The two ends of the trip, under its title. Long stop names are the norm, so
// it may take two lines rather than cutting the destination off.
.tripEnds {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  text-wrap: pretty;
}

.endButtons {
  display: flex;
  gap: design.spacing(2);
}

// Every state the trip can be in that is not a list of options: loading,
// locating, failed, nowhere to go. Said in words, in the space the list would take.
.planState {
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
  align-items: flex-start;
  padding: design.spacing(2) 0;
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
}

.planStateTitle {
  color: design.color(foreground);
  font-weight: 600;
}

.planNote {
  color: design.color(muted-foreground);
  font-size: 0.6875rem;
  line-height: 1.4;
  text-wrap: pretty;
}

.panelLink {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;

  &:hover {
    color: design.color(foreground);
  }
}
</style>
