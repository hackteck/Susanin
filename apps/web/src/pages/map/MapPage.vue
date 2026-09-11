<template>
  <main :class="$style.root">
    <TransitMap
      :stops="transit.stops"
      :vehicles="transit.visibleVehicles"
      :shapes="shapes"
      :focus-stop-id="selectedStopId"
      :user-position="position"
      :glide-ms="transit.POLL_MS"
      :bottom-inset="sheetInset"
      @select-stop="selectStop"
      @select-vehicle="focusVehicleRoute"
    />

    <div :class="$style.controls">
      <Button
        variant="secondary"
        size="icon"
        :aria-label="locale.t('followMe')"
        :disabled="locating"
        @click="locate"
      >
        <Spinner v-if="locating" :size="16" />
        <Icon v-else :icon="LocateFixed" />
      </Button>
    </div>

    <Transition
      :enter-from-class="$style.sheetHidden"
      :leave-to-class="$style.sheetHidden"
      :enter-active-class="$style.sheetMoving"
      :leave-active-class="$style.sheetMoving"
    >
      <aside v-if="selectedStop" :class="$style.panel">
        <i :class="$style.grip" aria-hidden="true" />

        <div :class="$style.panelHead">
          <div :class="$style.panelTitle">
            <h2 :class="$style.stopName">{{ locale.name(selectedStop.name) }}</h2>
            <p :class="$style.stopCode">{{ locale.t("stopNumber") }} {{ selectedStop.code }}</p>
          </div>
          <Button variant="ghost" size="icon" :aria-label="locale.t('close')" @click="selectedStopId = null">
            <Icon :icon="X" />
          </Button>
        </div>

        <ScrollArea :class="$style.panelBody">
          <ArrivalBoard
            :arrivals="arrivals"
            :loading="loading"
            :serves-nothing="!selectedStop.routeIds.length"
            :failed="failed"
          />
        </ScrollArea>

        <RouterLink :to="`/stops/${selectedStop.id}`" :class="$style.panelLink">
          {{ locale.t("timetable") }} →
        </RouterLink>
      </aside>
    </Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { LocateFixed, X } from "lucide";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { Spinner } from "@surstromming/spinner";
import { isMobile } from "@surstromming/util";
import TransitMap, { type MapShape } from "@/components/map/TransitMap.vue";
import ArrivalBoard from "@/components/ArrivalBoard.vue";
import { useArrivals } from "@/composables/useArrivals";
import { useGeolocation } from "@/composables/useGeolocation";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const locale = useLocale();

await transit.loadNetwork();

const stopWatching = transit.watchVehicles();
onUnmounted(stopWatching);

const selectedStopId = ref<string | null>(null);
const selectedStop = computed(() =>
  selectedStopId.value ? transit.stopById.get(selectedStopId.value) : undefined,
);

const { arrivals, loading, failed } = useArrivals(selectedStopId);
const { position, locating, locate } = useGeolocation();

const selectStop = (id: string) => {
  selectedStopId.value = id;
};

// On a phone the sheet covers the bottom half, so flying a stop to the centre
// of the map puts it underneath. The map is told how much room to leave.
const sheetInset = computed(() => (isMobile.value ? window.innerHeight * 0.5 : 0));

// Clicking a bus is a question about its line, so the map answers by showing
// only that line — the alternative is a popup that says what the pill already does.
const focusVehicleRoute = (vehicleId: string) => {
  const vehicle = transit.vehicles.find((candidate) => candidate.id === vehicleId);
  if (vehicle) transit.selectOnly(vehicle.routeId);
};

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
  .sheetMoving {
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

.panelLink {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;

  &:hover {
    color: design.color(foreground);
  }
}
</style>
