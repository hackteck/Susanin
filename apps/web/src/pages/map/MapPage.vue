<template>
  <main :class="$style.root">
    <TransitMap
      :stops="transit.stops"
      :vehicles="transit.visibleVehicles"
      :shapes="shapes"
      :focus-stop-id="selectedStopId"
      :user-position="userPosition"
      :user-stale="userStale"
      :picking="proximity.pickMode"
      :picked-point="pickedPoint"
      :fly-to="flyTo"
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
      <div v-if="proximity.pickMode" :class="$style.banner" role="status" aria-live="polite">
        <Icon :icon="MapPin" :size="16" />
        <p :class="$style.bannerText">{{ locale.t("pickOnMapHint") }}</p>
        <Button variant="ghost" size="sm" :class="$style.bannerCancel" @click="proximity.disarm()">
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

    <!-- One sheet, three modes. A stop's arrivals, a proximity list, or nothing
         — swapping contents inside it never animates. -->
    <Transition
      :enter-from-class="$style.sheetHidden"
      :leave-to-class="$style.sheetHidden"
      :enter-active-class="$style.sheetMoving"
      :leave-active-class="$style.sheetMoving"
    >
      <aside v-if="mode !== 'none'" :class="$style.panel">
        <i :class="$style.grip" aria-hidden="true" />

        <div :class="$style.panelHead">
          <!-- Back and close are different intents, so they get different
               glyphs. Back only exists when a proximity list is what produced
               this selection. -->
          <Button
            v-if="mode === 'stop' && proximity.origin"
            variant="ghost"
            size="icon"
            :aria-label="locale.t(backLabel)"
            @click="backToList"
          >
            <Icon :icon="ArrowLeft" />
          </Button>

          <div :class="$style.panelTitle">
            <template v-if="mode === 'stop' && selectedStop">
              <h2 :class="$style.stopName">{{ locale.name(selectedStop.name) }}</h2>
              <p :class="$style.stopCode">{{ locale.t("stopNumber") }} {{ selectedStop.code }}</p>
            </template>
            <template v-else>
              <h2 :class="$style.stopName">{{ locale.t(listTitle) }}</h2>
              <!-- The count is read out as well as shown: a screen-reader user
                   gets no hint from a list they have not reached yet. -->
              <p :class="$style.stopCode" aria-live="polite">
                {{ locale.plural(nearby.length, "stops") }}
              </p>
            </template>
          </div>

          <Button variant="ghost" size="icon" :aria-label="locale.t('close')" @click="closeSheet">
            <Icon :icon="X" />
          </Button>
        </div>

        <Alert v-if="mode === 'list' && proximity.coarse" :title="locale.t('coarseFix')" />

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

          <p v-else-if="!nearby.length" :class="$style.empty">{{ locale.t("noStopsNearPoint") }}</p>

          <ul v-else :class="$style.list">
            <li v-for="entry in nearby" :key="entry.stop.id">
              <button type="button" :class="$style.row" @click="selectStop(entry.stop.id)">
                <StopDistanceRow :entry="entry" />
              </button>
            </li>
          </ul>
        </ScrollArea>

        <RouterLink v-if="mode === 'stop' && selectedStop" :to="`/stops/${selectedStop.id}`" :class="$style.panelLink">
          {{ locale.t("timetable") }} →
        </RouterLink>
      </aside>
    </Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { ArrowLeft, Locate, LocateFixed, LocateOff, MapPin, X } from "lucide";
import { Alert } from "@surstromming/alert";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { Spinner } from "@surstromming/spinner";
import { isMobile } from "@surstromming/util";
import TransitMap, { type MapFlyTo, type MapShape, type MapView } from "@/components/map/TransitMap.vue";
import { cacheArchives, loadManifest, openArchive, type ArchiveSource } from "@/components/map/archives";
import ArrivalBoard from "@/components/ArrivalBoard.vue";
import StopDistanceRow from "@/components/StopDistanceRow.vue";
import { useArrivals } from "@/composables/useArrivals";
import { useNearestStops } from "@/composables/useNearestStops";
import { useNow } from "@/composables/useNow";
import { useTheme } from "@/composables/useTheme";
import { useLocale } from "@/stores/locale";
import { useProximity, STALE_AFTER_MS } from "@/stores/proximity";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const locale = useLocale();
const proximity = useProximity();
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
// With no fix, `useMyLocation` has already asked for one, out loud. Asking a
// second time here made every refusal two sticky toasts.
const onLocate = () => {
  proximity.useMyLocation();
  if (!proximity.fix) return;
  flyToPoint(proximity.fix.lat, proximity.fix.lon);
  proximity.locate({ silent: true });
};

const pickedPoint = computed(() =>
  proximity.origin?.kind === "point" ? { lat: proximity.origin.lat, lon: proximity.origin.lon } : null,
);

const { entries: nearby } = useNearestStops(
  computed(() => proximity.anchor),
  { limit: 5 },
);

// The list is open until a stop is chosen out of it or the sheet is closed.
const listOpen = ref(false);

type SheetMode = "none" | "list" | "stop";
const mode = computed<SheetMode>(() => {
  if (selectedStopId.value) return "stop";
  return listOpen.value && proximity.origin ? "list" : "none";
});

const listTitle = computed<"stopsNearPoint" | "nearbyStops">(() =>
  proximity.origin?.kind === "point" ? "stopsNearPoint" : "nearbyStops",
);

const backLabel = computed<"backToPickedPoint" | "backToNearby">(() =>
  proximity.origin?.kind === "point" ? "backToPickedPoint" : "backToNearby",
);

const selectStop = (id: string) => {
  selectedStopId.value = id;
};

const backToList = () => {
  selectedStopId.value = null;
  listOpen.value = true;
};

// Closing the list is also giving up the point it was about — leaving the marker
// behind with nothing open would be a mark on the map that means nothing.
const closeSheet = () => {
  if (mode.value === "stop") {
    selectedStopId.value = null;
    return;
  }
  listOpen.value = false;
  if (proximity.origin?.kind === "point") proximity.clearOrigin();
};

const onPickPoint = (point: { lat: number; lon: number }) => {
  proximity.pickAt(point.lat, point.lon);
  selectedStopId.value = null;
  listOpen.value = true;
};

// Escape cancels the pick, and only the pick — never stolen from the sidebar
// drawer or a menu, which own it when nothing is armed.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || !proximity.pickMode) return;
  proximity.disarm();
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
  proximity.disarm();
});

// The first fix of a session goes on screen without being asked for; later ones
// must not yank the map away from wherever the reader has panned to.
let flownToFirstFix = false;
watch(
  () => proximity.fix,
  (fix) => {
    if (!fix || flownToFirstFix) return;
    flownToFirstFix = true;
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
const toggleVehicleRoute = (vehicleId: string) => {
  const vehicle = transit.vehicles.find((candidate) => candidate.id === vehicleId);
  if (vehicle) transit.toggleRoute(vehicle.routeId);
};

// Only when exactly one route is drawn. With two the colours would compete and
// with none it is every stop in the city, which the zoom rule already handles —
// this answers "where does this line stop", which is only a question when there
// is one line.
const routeStops = computed(() => {
  if (transit.selectedRouteIds.length !== 1) return null;
  const id = transit.selectedRouteIds[0]!;
  const route = transit.routeById.get(id);
  if (!route) return null;
  return { ids: transit.stops.filter((stop) => stop.routeIds.includes(id)).map((stop) => stop.id), hue: route.hue };
});

// Only selected routes are drawn; with nothing selected the map is the live
// fleet over a plain city, which is the view most people open it for.
const shapes = computed<MapShape[]>(() =>
  transit.selectedRouteIds
    .map((id) => transit.routeDetails.get(id))
    .filter((detail) => detail !== undefined)
    .map((detail) => ({ id: detail.id, hue: detail.hue, points: detail.shape })),
);

watch(
  () => transit.selectedRouteIds,
  (ids) => ids.forEach((id) => void transit.loadRouteDetail(id)),
  { immediate: true },
);
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


.empty {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
}

.list {
  display: grid;
  gap: design.spacing(1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  gap: design.spacing(3);
  align-items: center;
  grid-template-columns: auto 1fr auto;
  width: 100%;
  padding: design.spacing(2);
  border: none;
  border-radius: design.radius(md);
  background-color: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background-color: design.color(accent);
  }

  &:focus-visible {
    outline: 2px solid design.color(ring);
    outline-offset: 2px;
  }
}

.panelLink {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;

  &:hover {
    color: design.color(foreground);
  }
}
</style>
