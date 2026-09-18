<template>
  <div :class="$style.root">
    <ol :class="$style.steps">
      <li v-for="(step, index) in steps" :key="index" :class="stepClasses(step)" :style="step.style">
        <i :class="$style.mark" aria-hidden="true" />

        <template v-if="step.kind === 'place'">
          <span :class="$style.body">
            <b :class="$style.title">{{ step.label }}</b>
          </span>
          <time :class="$style.time">{{ step.time }}</time>
        </template>

        <template v-else-if="step.kind === 'stop'">
          <span :class="$style.body">
            <!-- A stop in a plan is a stop like any other: its arrivals are one
                 press away, and a back arrow brings the plan back. -->
            <button type="button" :class="$style.stopButton" @click="emit('selectStop', step.stopId)">
              {{ step.label }}
            </button>
            <span :class="$style.detail">{{ step.detail }}</span>
          </span>
          <time :class="$style.time">{{ step.time }}</time>
        </template>

        <template v-else-if="step.kind === 'walk'">
          <span :class="$style.body">
            <span :class="$style.detail">
              <Icon :icon="Footprints" :size="14" />
              {{ step.label }}
            </span>
          </span>
        </template>

        <template v-else>
          <span :class="$style.body">
            <span :class="$style.rideHead">
              <RouteChip :short-name="step.shortName" :hue="step.hue" size="sm" />
              <span :class="$style.headsign">{{ step.headsign }}</span>
            </span>
            <span :class="$style.detail">{{ step.detail }}</span>
            <span v-if="step.live" :class="$style.live">
              <i :class="$style.liveDot" />
              {{ step.live }}
            </span>
            <span v-if="step.later" :class="$style.detail">{{ step.later }}</span>
          </span>
        </template>
      </li>
    </ol>

    <p v-if="journey.estimated" :class="$style.note">{{ locale.t("estimatedTimesNote") }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, useCssModule } from "vue";
import { Footprints } from "lucide";
import { Icon } from "@surstromming/icon";
import RouteChip from "@/components/RouteChip.vue";
import { useJourneyFormat } from "@/composables/useJourneyFormat";
import { useNow } from "@/composables/useNow";
import type { Journey, RideLeg } from "@/planner/plan";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

/** The nearest bus of the first ride's line, as the live feed sees it. */
export interface JourneyLive {
  arrivesAt: string;
  confidence: "live" | "slow";
}

const props = withDefaults(
  defineProps<{ journey: Journey; fromLabel: string; toLabel: string; live?: JourneyLive | null }>(),
  { live: null },
);
const emit = defineEmits<{ selectStop: [stopId: string] }>();

const locale = useLocale();
const transit = useTransit();
const format = useJourneyFormat();
const now = useNow();
const $style = useCssModule();

type Step =
  | { kind: "place"; mark: "start" | "end"; label: string; time: string; style?: undefined }
  | { kind: "stop"; stopId: string; label: string; detail: string; time: string; style: Record<string, string> }
  | { kind: "walk"; label: string; style?: undefined }
  | {
      kind: "ride";
      shortName: string;
      hue: number;
      headsign: string;
      detail: string;
      live: string;
      later: string;
      style: Record<string, string>;
    };

/** Under this the bus is at the kerb, as on the arrival board. */
const DUE_SECONDS = 45;

// The same reading as the arrival board's countdown: a word once it is due, the
// ≈ once the bus is barely moving, and nothing once it has been and gone.
const liveLabel = computed(() => {
  if (!props.live) return "";
  const seconds = (Date.parse(props.live.arrivesAt) - now.value) / 1000;
  if (seconds < -90) return "";
  if (seconds <= DUE_SECONDS) return `${locale.t("nextLive")}: ${locale.t("approaching").toLowerCase()}`;
  const soft = props.live.confidence === "slow" ? "≈" : "";
  return `${locale.t("nextLive")}: ${soft}${Math.ceil(seconds / 60)} ${locale.t("minutesShort")}`;
});

const stopStep = (stopId: string, time: string, hue: number): Step => {
  const stop = transit.stopById.get(stopId);
  return {
    kind: "stop",
    stopId,
    label: stop ? locale.name(stop.name) : "",
    detail: stop ? `${locale.t("stopNumber")} ${stop.code}` : "",
    time,
    style: { "--hue": String(hue) },
  };
};

const rideStep = (leg: RideLeg, first: boolean): Step => {
  const route = transit.routeById.get(leg.routeId);
  const headsign = route?.directions.find((candidate) => candidate.direction === leg.direction)?.to;
  const hops = leg.stopIds.length - 1;
  const approx = leg.estimated ? "≈ " : "";
  return {
    kind: "ride",
    shortName: route?.shortName ?? "?",
    hue: route?.hue ?? 0,
    headsign: headsign ? `→ ${locale.name(headsign)}` : "",
    detail: `${approx}${locale.plural(hops, "stops")} · ${format.span(leg.depart, leg.arrive)}`,
    // Live only for the first bus: that is the one the reader is deciding
    // whether to run for; the later ones depend on it anyway.
    live: first ? liveLabel.value : "",
    later: leg.later.length ? `${locale.t("alsoAt")} ${leg.later.map(format.departTime).join(", ")}` : "",
    style: { "--hue": String(route?.hue ?? 0) },
  };
};

const steps = computed<Step[]>(() => {
  const list: Step[] = [
    { kind: "place", mark: "start", label: props.fromLabel, time: format.departTime(props.journey.depart) },
  ];
  let lastStop: string | null = null;
  let firstRide = true;

  for (const leg of props.journey.legs) {
    if (leg.kind === "walk") {
      list.push({ kind: "walk", label: `${locale.t("walk")} ${format.walk(leg)}` });
      lastStop = null;
      continue;
    }

    const hue = transit.routeById.get(leg.routeId)?.hue ?? 0;
    const approx = leg.estimated ? "≈" : "";
    // Changing at the same pole is one stop in the list, not an arrival and a
    // departure pretending to be two places.
    if (lastStop === leg.fromStopId) {
      const previous = list.at(-1);
      if (previous?.kind === "stop") previous.time = `${previous.time} → ${approx}${format.departTime(leg.depart)}`;
    } else {
      list.push(stopStep(leg.fromStopId, `${approx}${format.departTime(leg.depart)}`, hue));
    }
    list.push(rideStep(leg, firstRide));
    list.push(stopStep(leg.toStopId, `${approx}${format.arriveTime(leg.arrive)}`, hue));
    lastStop = leg.toStopId;
    firstRide = false;
  }

  list.push({ kind: "place", mark: "end", label: props.toLabel, time: format.arriveTime(props.journey.arrive) });
  return list;
});

const stepClasses = (step: Step) => [
  $style.step,
  $style[`kind-${step.kind}`],
  { [$style.isStart]: step.kind === "place" && step.mark === "start", [$style.isEnd]: step.kind === "place" && step.mark === "end" },
];
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(3);
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

// One column of marks on the left, drawn by the rows themselves, so the trip
// reads as one line with things happening along it.
.step {
  display: grid;
  position: relative;
  gap: design.spacing(3);
  align-items: start;
  grid-template-columns: design.spacing(4) 1fr auto;
  min-height: design.spacing(8);
  padding: design.spacing(1) 0;
}

.mark {
  justify-self: center;
  margin-top: design.spacing(1);
}

// Rides and walks are the connecting segments: a solid line in the line's
// colour, a dotted one in ink.
.kind-ride .mark,
.kind-walk .mark {
  align-self: stretch;
  width: 0;
  margin: calc(-1 * design.spacing(1)) 0;
}

.kind-ride .mark {
  border-left: 4px solid oklch(var(--route-l) var(--route-c) var(--hue));
}

.kind-walk .mark {
  border-left: 3px dotted design.color(muted-foreground);
}

.kind-stop .mark {
  width: design.spacing(3);
  height: design.spacing(3);
  border: 3px solid oklch(var(--route-l) var(--route-c) var(--hue));
  border-radius: 50%;
  background-color: var(--stop-fill);
}

// The same two marks the map and the sidebar draw at either end.
.isStart .mark {
  width: design.spacing(3.5);
  height: design.spacing(3.5);
  border: 3px solid var(--stop-selected-fill);
  border-radius: 50%;
  background-color: var(--stop-fill);
}

.isEnd .mark {
  width: design.spacing(3.5);
  height: design.spacing(3.5);
  border: 2px solid var(--stop-selected-ring);
  border-radius: 50%;
  background-color: var(--stop-selected-fill);
}

.body {
  display: flex;
  flex-direction: column;
  gap: design.spacing(0.5);
  min-width: 0;
}

.title {
  font-size: 0.875rem;
  font-weight: 600;
}

.stopButton {
  padding: 0;
  overflow: hidden;
  border: none;
  background: none;
  color: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: 2px solid design.color(ring);
    outline-offset: 2px;
  }
}

.detail {
  display: inline-flex;
  gap: design.spacing(1);
  align-items: center;
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.rideHead {
  display: flex;
  gap: design.spacing(2);
  align-items: center;
  min-width: 0;
}

.headsign {
  overflow: hidden;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  color: design.color(foreground);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.live {
  display: inline-flex;
  gap: design.spacing(1.5);
  align-items: center;
  font-size: 0.75rem;
  font-weight: 600;
}

// The live-data green, as on the arrival board and in the header — and still,
// because the board's pulse is the one thing allowed to loop.
.liveDot {
  width: design.spacing(1.5);
  height: design.spacing(1.5);
  border-radius: 50%;
  background-color: design.color(chart-2);
}

.note {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  line-height: 1.4;
  text-wrap: pretty;
}
</style>
