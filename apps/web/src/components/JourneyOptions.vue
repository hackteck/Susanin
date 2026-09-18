<template>
  <ul :class="$style.list">
    <li v-for="row in rows" :key="row.key">
      <button
        type="button"
        :class="optionClasses(row.key)"
        :aria-current="row.key === selectedKey ? 'true' : undefined"
        :aria-label="row.label"
        @click="emit('select', row.key)"
      >
        <span :class="$style.top">
          <b :class="$style.duration">{{ row.duration }}</b>
          <span v-if="row.live" :class="$style.live">
            <i :class="$style.liveDot" aria-hidden="true" />
            {{ row.live }}
          </span>
          <span v-else-if="row.unseen" :class="$style.unseen">{{ locale.t("notSeenNow") }}</span>
        </span>
        <LegStrip :legs="row.legs" />
        <span :class="$style.meta">{{ row.meta }}</span>
      </button>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed, useCssModule } from "vue";
import LegStrip from "@/components/LegStrip.vue";
import type { NextBus } from "@/composables/useArrivals";
import { useJourneyFormat } from "@/composables/useJourneyFormat";
import { useNow } from "@/composables/useNow";
import type { Journey, PlanResult, RideLeg } from "@/planner/plan";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const props = withDefaults(
  defineProps<{
    result: PlanResult;
    selectedKey: string | null;
    /**
     * The first bus of each option, by its key: a bus, `null` when the feed
     * answered and shows none coming, absent while that is not known.
     */
    live?: Record<string, NextBus | null>;
  }>(),
  { live: () => ({}) },
);
const emit = defineEmits<{ select: [key: string] }>();

const locale = useLocale();
const transit = useTransit();
const format = useJourneyFormat();
const now = useNow();
const $style = useCssModule();

const stopName = (id: string) => {
  const stop = transit.stopById.get(id);
  return stop ? locale.name(stop.name) : "";
};

// The line under the chips answers "where do I get on": the changes are already
// the chips above it, and saying them twice pushed the stop name — the part
// that matters at a kerb — off the end of the line.
const metaFor = (journey: Journey) => {
  if (journey.kind === "walk") return format.distance(journey.walkMetres);
  const first = journey.legs.find((leg): leg is RideLeg => leg.kind === "ride");
  return first ? stopName(first.fromStopId) : "";
};

const lineNames = (leg: RideLeg) =>
  [leg.routeId, ...(leg.also ?? []).map((other) => other.routeId)]
    .map((id) => `${locale.t("routeLabel")} ${transit.routeById.get(id)?.shortName ?? ""}`)
    .join(` ${locale.t("or")} `);

// Read aloud, the row's own text is "4 16": a walk's minutes and a chip. Said
// in words instead — the lines, and how many changes they take.
const spokenFor = (journey: Journey, duration: string, live: string, meta: string) => {
  const lines = journey.legs.filter((leg): leg is RideLeg => leg.kind === "ride").map(lineNames);
  const changes =
    journey.kind === "walk"
      ? locale.t("walk")
      : journey.rides > 1
        ? locale.plural(journey.rides - 1, "transfers")
        : locale.t("direct");
  const next = live ? `${locale.t("nextLive")}: ${live}` : "";
  return [duration, ...lines, changes, next, meta].filter(Boolean).join(", ");
};

const rows = computed(() =>
  props.result.journeys.map((journey) => {
    // Every duration here is distance at an average speed, and one ≈ says so.
    const duration = `≈ ${format.duration(journey.minutes)}`;
    const bus = props.live[journey.key];
    const live = bus ? format.countdown(bus, now.value) : "";
    const meta = metaFor(journey);
    return {
      key: journey.key,
      legs: journey.legs,
      duration,
      live,
      // Said only when the feed answered: "none coming" and "cannot see" are
      // different, and at night the first is the thing worth knowing.
      unseen: journey.kind === "transit" && bus === null,
      meta,
      label: spokenFor(journey, duration, live, meta),
    };
  }),
);

const optionClasses = (key: string) => [$style.option, { [$style.isSelected]: key === props.selectedKey }];
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.list {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.option {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1.5);
  width: 100%;
  padding: design.spacing(2.5) design.spacing(3);
  border: 1px solid design.color(border);
  border-radius: design.radius(md);
  background-color: design.color(card);
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

// The one on the map. An edge in the foreground ink rather than a colour: the
// route hues already own colour here.
.isSelected {
  border-color: design.color(foreground);
}

.top {
  display: flex;
  gap: design.spacing(2);
  align-items: baseline;
  justify-content: space-between;
}

.duration {
  font-size: 0.9375rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.live {
  display: inline-flex;
  gap: design.spacing(1.5);
  align-items: center;
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

// The live-data green, as on the arrival board and in the header — and still,
// because the board's pulse is the one thing allowed to loop.
.liveDot {
  width: design.spacing(1.5);
  height: design.spacing(1.5);
  border-radius: 50%;
  background-color: design.color(chart-2);
}

.unseen {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  white-space: nowrap;
}

.meta {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  text-wrap: pretty;
}
</style>
