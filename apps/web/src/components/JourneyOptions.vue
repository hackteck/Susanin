<template>
  <div :class="$style.root">
    <ul v-if="rows.length" :class="$style.list">
      <li v-for="row in rows" :key="row.key">
        <button
          type="button"
          :class="optionClasses(row.key)"
          :aria-current="row.key === selectedKey ? 'true' : undefined"
          :aria-label="row.label"
          @click="emit('select', row.key)"
        >
          <span :class="$style.top">
            <span :class="$style.times">{{ row.times }}</span>
            <b :class="$style.duration">{{ row.duration }}</b>
          </span>
          <LegStrip :legs="row.legs" />
          <span :class="$style.meta">{{ row.meta }}</span>
        </button>
      </li>
    </ul>

    <!-- Apart from the timed options and never ranked against them: nothing
         says when these buses come, so "fastest" would be a guess. -->
    <section v-if="untimedRows.length" :class="$style.untimed">
      <h3 :class="$style.untimedTitle">{{ locale.t("untimedTitle") }}</h3>
      <ul :class="$style.list">
        <li v-for="row in untimedRows" :key="row.key" :class="$style.untimedRow">
          <RouteChip :short-name="row.shortName" :hue="row.hue" size="sm" />
          <span :class="$style.untimedText">
            <span :class="$style.stops">{{ row.stops }}</span>
            <span :class="$style.meta">{{ row.meta }}</span>
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, useCssModule } from "vue";
import LegStrip from "@/components/LegStrip.vue";
import RouteChip from "@/components/RouteChip.vue";
import { useJourneyFormat } from "@/composables/useJourneyFormat";
import type { Journey, PlanResult, RideLeg } from "@/planner/plan";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const props = defineProps<{ result: PlanResult; selectedKey: string | null }>();
const emit = defineEmits<{ select: [key: string] }>();

const locale = useLocale();
const transit = useTransit();
const format = useJourneyFormat();
const $style = useCssModule();

const stopName = (id: string) => {
  const stop = transit.stopById.get(id);
  return stop ? locale.name(stop.name) : "";
};

// The line under the chips answers "when do I have to be where": the stop the
// first bus leaves from, and when. The changes are already the chips above it,
// and saying them twice pushed the stop name — the part that matters at a
// kerb — off the end of the line.
const metaFor = (journey: Journey) => {
  if (journey.kind === "walk") return format.distance(journey.walkMetres);
  const first = journey.legs.find((leg): leg is RideLeg => leg.kind === "ride");
  return first ? `${stopName(first.fromStopId)} · ${format.departTime(first.depart)}` : "";
};

// Read aloud, the row's own text is "4 16": a walk's minutes and a chip. Said
// in words instead — the lines, and how many changes they take.
const spokenFor = (journey: Journey, times: string, duration: string, meta: string) => {
  const lines = journey.legs
    .filter((leg): leg is RideLeg => leg.kind === "ride")
    .map((leg) => `${locale.t("routeLabel")} ${transit.routeById.get(leg.routeId)?.shortName ?? ""}`);
  const changes =
    journey.kind === "walk"
      ? locale.t("walk")
      : journey.rides > 1
        ? locale.plural(journey.rides - 1, "transfers")
        : locale.t("direct");
  return [times, duration, ...lines, changes, meta].filter(Boolean).join(", ");
};

const rows = computed(() =>
  props.result.journeys.map((journey) => {
    // One ≈ for the whole row: somewhere in it a time is ours, not upstream's.
    const times = `${journey.estimated ? "≈ " : ""}${format.departTime(journey.depart)} – ${format.arriveTime(journey.arrive)}`;
    const duration = format.span(journey.depart, journey.arrive);
    const meta = metaFor(journey);
    return { key: journey.key, legs: journey.legs, times, duration, meta, label: spokenFor(journey, times, duration, meta) };
  }),
);

const untimedRows = computed(() =>
  props.result.untimed.map((option) => {
    const route = transit.routeById.get(option.routeId);
    return {
      key: `${option.routeId}:${option.direction}`,
      shortName: route?.shortName ?? "?",
      hue: route?.hue ?? 0,
      stops: `${stopName(option.ride.fromStopId)} → ${stopName(option.ride.toStopId)}`,
      meta: `≈ ${format.duration(option.ride.minutes)} ${locale.t("riding")} ${locale.t("plusWait")}`,
    };
  }),
);

const optionClasses = (key: string) => [$style.option, { [$style.isSelected]: key === props.selectedKey }];
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(3);
}

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

.times {
  font-size: 0.9375rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.duration {
  font-size: 0.9375rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.meta {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  text-wrap: pretty;
}

.untimed {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1.5);
}

.untimedTitle {
  margin: 0;
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
}

.untimedRow {
  display: grid;
  gap: design.spacing(2);
  align-items: center;
  grid-template-columns: auto 1fr;
  padding: design.spacing(1) design.spacing(1);
}

.untimedText {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stops {
  overflow: hidden;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
