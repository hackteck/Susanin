<template>
  <div :class="$style.root">
    <ul v-if="showSkeleton" :class="$style.list" aria-hidden="true">
      <li v-for="row in 3" :key="row" :class="[$style.row, $style.skeleton]">
        <span :class="$style.skeletonChip" />
        <span :class="$style.skeletonText" />
        <span :class="$style.skeletonEta" />
      </li>
    </ul>

    <p v-else-if="!rows.length" :class="$style.state">{{ emptyMessage }}</p>

    <!-- A board that already has rows keeps showing them when the feed dies,
         and their countdowns keep ticking — so the fact that nothing behind
         them is still arriving has to be said out loud, not only when the
         board happens to be empty. -->
    <p v-else-if="failed" :class="$style.stale">{{ locale.t("liveUnavailable") }}</p>

    <ul v-if="rows.length && !showSkeleton" :class="$style.list">
      <li v-for="row in rows" :key="row.key" :class="$style.row" :style="{ '--hue': row.hue }">
        <RouteChip :short-name="row.shortName" :hue="row.hue" />

        <span :class="$style.destination">
          <span :class="$style.headsign">{{ row.headsign }}</span>
          <span :class="$style.meta">{{ row.meta }}</span>
        </span>

        <span v-if="row.countdown" :class="etaClasses(row)">
          <i v-if="row.isFirstLive" :class="$style.pulse" />
          <i v-else-if="row.isLive" :class="$style.dot" />
          <span class="visually-hidden">{{ locale.t("liveLabel") }}</span>
          <b :class="numberClasses(row)">{{ row.countdown.value }}</b>
          <i v-if="row.countdown.unit" :class="$style.unit">{{ row.countdown.unit }}</i>
        </span>
        <span v-else :class="$style.scheduledOnly">{{ row.scheduledLabel }}</span>
      </li>
    </ul>

    <p v-if="hasEstimates" :class="$style.note">{{ locale.t("estimateNote") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, useCssModule, watch } from "vue";
import RouteChip from "@/components/RouteChip.vue";
import type { Arrival } from "@/api/types";
import { useNow } from "@/composables/useNow";
import { useLocale } from "@/stores/locale";

const props = withDefaults(
  defineProps<{
    arrivals: Arrival[];
    loading?: boolean;
    /** The stop serves no routes at all, which is a different nothing. */
    servesNothing?: boolean;
    /** The feed could not be reached — which is not the same as no service. */
    failed?: boolean;
  }>(),
  { loading: false, servesNothing: false, failed: false },
);

const locale = useLocale();
const now = useNow();
const $style = useCssModule();

/** Under this, the bus is at the kerb — a countdown of "0 min" is not a thing. */
const DUE_SECONDS = 45;
/** Past this the next departure is tomorrow's first, not a wait worth counting. */
const TOMORROW_THRESHOLD_MINUTES = 240;

// A skeleton that flashes for 80ms is worse than no skeleton, so it only
// appears if the answer is actually slow to arrive.
const slowToLoad = ref(false);
let slowTimer: number | undefined;

watch(
  () => props.loading,
  (loading) => {
    window.clearTimeout(slowTimer);
    if (!loading) {
      slowToLoad.value = false;
      return;
    }
    slowTimer = window.setTimeout(() => (slowToLoad.value = true), 180);
  },
  { immediate: true },
);

onScopeDispose(() => window.clearTimeout(slowTimer));

const showSkeleton = computed(() => slowToLoad.value && !props.arrivals.length);

const rows = computed(() => {
  // Only the soonest live row breathes: a dozen pulsing rings at a busy
  // interchange stops reading as "alive" and starts reading as restless.
  let firstLiveSeen = false;

  return props.arrivals.map((arrival) => {
    const countdown = countdownFor(arrival);
    const isLive = countdown !== null;
    const isFirstLive = isLive && !firstLiveSeen;
    if (isFirstLive) firstLiveSeen = true;

    return {
      key: `${arrival.routeId}-${arrival.direction}`,
      shortName: arrival.shortName,
      hue: arrival.hue,
      headsign: `→ ${locale.name(arrival.headsign)}`,
      meta: metaFor(arrival),
      countdown,
      isLive,
      isFirstLive,
      isSoon: countdown !== null && countdown.soon,
      isSoft: arrival.estimate?.confidence === "slow",
      scheduledLabel: scheduledLabel(arrival),
    };
  });
});

const hasEstimates = computed(() => props.arrivals.some((arrival) => arrival.estimate));

const emptyMessage = computed(() => {
  // Order matters: a stop with no answer at all must not be told the service
  // has ended, which is what an unreachable feed looked like offline.
  if (props.failed) return locale.t("liveUnavailable");
  if (props.servesNothing) return locale.t("noRoutesHere");
  return locale.t("noService");
});

function countdownFor(arrival: Arrival) {
  if (!arrival.estimate) return null;

  const seconds = (Date.parse(arrival.estimate.arrivesAt) - now.value) / 1000;
  // A bus whose estimate has run well past due has been and gone, or stopped
  // reporting; either way there is nothing left to count.
  if (seconds < -90) return null;

  if (seconds <= DUE_SECONDS) return { value: locale.t("approaching"), unit: "", soon: true };

  const minutes = Math.ceil(seconds / 60);
  // The tilde is the whole of the uncertainty signal — a fabricated ± range
  // would look like calibration we have not earned.
  const prefix = arrival.estimate.confidence === "slow" ? "≈" : "";
  return { value: `${prefix}${minutes}`, unit: locale.t("minutesShort"), soon: minutes <= 3 };
}

/**
 * The supporting line under the destination. The scheduled time lives here
 * rather than beside the countdown: one number is the point of the row, and
 * "First tomorrow 07:06" sitting next to it was wide enough to squeeze the
 * destination — the thing a rider actually navigates by — down to an ellipsis.
 */
function metaFor(arrival: Arrival) {
  const scheduled = scheduledLabel(arrival);

  if (arrival.estimate) {
    const stops = arrival.estimate.stopsAway > 0 ? locale.plural(arrival.estimate.stopsAway, "stops") : "";
    return [stops, scheduled].filter(Boolean).join(" · ");
  }

  return arrival.scheduledTime ? locale.t("scheduled") : locale.t("noTimetable");
}

// The scheduled column stays honest about which day it means: "in 494 minutes"
// is a true statement and a useless one.
function scheduledLabel(arrival: Arrival) {
  if (!arrival.scheduledTime) return "";
  if ((arrival.scheduledMinutes ?? 0) > TOMORROW_THRESHOLD_MINUTES) {
    return `${locale.t("firstBusTomorrow")} ${arrival.scheduledTime}`;
  }
  return arrival.scheduledTime;
}

const etaClasses = (row: { isSoon: boolean; isSoft: boolean }) => [
  $style.live,
  { [$style.isSoon]: row.isSoon, [$style.isSoft]: row.isSoft },
];

// "Подъезжает" is a word, not a figure. Set at the number's size it dominates
// the row and pushes the destination out; a word only has to be readable.
const numberClasses = (row: { countdown: { unit: string } | null }) => [
  $style.minutes,
  { [$style.isWord]: !row.countdown?.unit },
];
</script>

<style module lang="scss">
@use "@surstromming/design" as design;
@use "../styles/motion" as motion;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(3);
}

.state {
  padding: design.spacing(6) design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.875rem;
  text-align: center;
  text-wrap: balance;
}

// Sits above rows that are still on screen but no longer being refreshed.
.stale {
  padding: design.spacing(2);
  border-radius: design.radius(sm);
  background-color: design.color(muted);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  text-wrap: pretty;
}

.list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

// One height for a real row and for the skeleton that stands in for it, so
// nothing shifts when the answer lands.
$row-height: 56px;

.row {
  display: grid;
  gap: design.spacing(3);
  align-items: center;
  grid-template-columns: auto 1fr auto;
  min-height: $row-height;
  padding: design.spacing(2) design.spacing(2) design.spacing(2) design.spacing(3);
  border-bottom: 1px solid design.color(border);

  // The route's colour as an edge. This is the whole decorative budget here —
  // the rest of the row is hierarchy, not ornament.
  border-left: 3px solid oklch(var(--route-l) var(--route-c) var(--hue));

  &:last-child {
    border-bottom: none;
  }
}

.destination {
  display: flex;
  flex-direction: column;
  gap: design.spacing(0.5);
  min-width: 0;
}

.headsign {
  overflow: hidden;
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;

  // Noto Sans Georgian sets wider than Latin at the same size.
  &:lang(ka) {
    font-size: 0.8125rem;
  }
}

.meta {
  overflow: hidden;
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live {
  display: flex;
  gap: design.spacing(1.5);
  align-items: baseline;
  justify-self: end;
  color: design.color(foreground);
  transition: color motion.$standard motion.$ease-micro;
}

.scheduledOnly {
  justify-self: end;
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

// The number is the whole point of the screen, so it is the biggest thing on it.
.minutes {
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.isWord {
  font-size: 0.9375rem;
  letter-spacing: -0.01em;
}

.unit {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  font-style: normal;
}

// Three minutes out is when someone decides whether to run.
.isSoon .minutes {
  color: design.color(chart-3);
}

.isSoft .minutes {
  color: design.color(muted-foreground);
}

.dot,
.pulse {
  position: relative;
  align-self: center;
  width: design.spacing(1.5);
  height: design.spacing(1.5);
  border-radius: 50%;
  background-color: design.color(chart-2);
}

.pulse::after {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background-color: design.color(chart-2);
  animation: breathe motion.$pulse motion.$ease-micro infinite;
  content: "";
}

// Transform and opacity only, so the ring never costs a layout.
@keyframes breathe {
  from {
    transform: scale(1);
    opacity: 0.45;
  }
  to {
    transform: scale(2.1);
    opacity: 0;
  }
}

@include motion.reduced {
  // The dot stays — it carries meaning. The ring was decoration.
  .pulse::after {
    animation: none;
  }
}

.note {
  padding: 0 design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  line-height: 1.4;
  text-wrap: pretty;
}

.skeleton {
  border-left-color: design.color(border);
}

.skeletonChip,
.skeletonText,
.skeletonEta {
  border-radius: design.radius(sm);
  background-color: design.color(muted);
  animation: shimmer 1400ms motion.$ease-micro infinite;
}

.skeletonChip {
  width: design.spacing(9);
  height: design.spacing(7);
}

.skeletonText {
  width: 60%;
  height: design.spacing(4);
}

.skeletonEta {
  width: design.spacing(12);
  height: design.spacing(6);
}

@keyframes shimmer {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@include motion.reduced {
  .skeletonChip,
  .skeletonText,
  .skeletonEta {
    animation: none;
  }
}
</style>
