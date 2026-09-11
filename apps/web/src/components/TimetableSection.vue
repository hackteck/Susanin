<template>
  <article :class="$style.root" :style="{ '--hue': schedule.hue }">
    <header :class="$style.head">
      <RouteChip :short-name="schedule.shortName" :hue="schedule.hue" size="sm" />
      <span :class="$style.headsign">→ {{ locale.name(schedule.headsign) }}</span>
    </header>

    <p v-if="!schedule.times.length" :class="$style.note">{{ locale.t("noTimetable") }}</p>

    <template v-else>
      <p :class="$style.service">{{ serviceLine }}</p>

      <ul :class="$style.times">
        <li v-for="time in shown" :key="time" :class="timeClasses(time)">{{ time }}</li>
      </ul>

      <Button v-if="canExpand" variant="ghost" size="sm" @click="expanded = !expanded">
        {{ expanded ? locale.t("showLess") : `${locale.t("timetable")} · ${schedule.times.length}` }}
      </Button>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, useCssModule } from "vue";
import { Button } from "@surstromming/button";
import RouteChip from "@/components/RouteChip.vue";
import type { StopSchedule } from "@/api/types";
import { useLocale } from "@/stores/locale";

const props = defineProps<{ schedule: StopSchedule; nowHHMM: string }>();

const locale = useLocale();
const $style = useCssModule();

/** Enough to plan by. The rest is reference, and goes behind a press. */
const PREVIEW = 6;

const expanded = ref(false);

const upcoming = computed(() => props.schedule.times.filter((time) => time >= props.nowHHMM));

const shown = computed(() => {
  if (expanded.value) return props.schedule.times;
  // Once the day is over, showing "nothing upcoming" is less useful than
  // showing where tomorrow starts.
  const list = upcoming.value.length ? upcoming.value : props.schedule.times;
  return list.slice(0, PREVIEW);
});

const canExpand = computed(() => props.schedule.times.length > PREVIEW);

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/**
 * "every 12 min · 06:50–23:14". Most legs run one constant headway all day, so
 * that single number says more than sixty printed times — but a leg that
 * alternates (route 1A runs 3 then 9) must not be flattened into a lie, so the
 * spread is reported instead.
 */
const serviceLine = computed(() => {
  const times = props.schedule.times;
  const span = `${times[0]} – ${times.at(-1)}`;
  if (times.length < 3) return span;

  const gaps = times.slice(1).map((time, index) => toMinutes(time) - toMinutes(times[index]!));
  const usual = gaps.filter((gap) => gap > 0).sort((a, b) => a - b);
  if (!usual.length) return span;

  const low = usual[0]!;
  const high = usual.at(-1)!;
  const headway = high - low <= 2 ? `${Math.round((low + high) / 2)}` : `${low}–${high}`;

  return `${locale.t("everyMinutes")} ${headway} ${locale.t("minutesShort")} · ${span}`;
});

const timeClasses = (time: string) => [$style.time, { [$style.isPast]: time < props.nowHHMM }];
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
  align-items: flex-start;
  padding: design.spacing(3);
  border: 1px solid design.color(border);
  border-left: 3px solid oklch(var(--route-l) var(--route-c) var(--hue));
  border-radius: design.radius(md);
  background-color: design.color(card);
}

.head {
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

.service {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.note {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

.times {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.time {
  padding: design.spacing(1) design.spacing(2);
  border-radius: design.radius(sm);
  background-color: design.color(muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

// Departures that have already gone stay visible but stop competing for
// attention — a timetable you can't read backwards is half a timetable.
.isPast {
  background-color: transparent;
  color: design.color(muted-foreground);
  opacity: 0.6;
}
</style>
