<template>
  <!-- The shape of a trip at a glance: walk, bus, walk. Minutes on foot, the
       line's own chip for a ride — several, when any of them makes the ride. -->
  <ol :class="$style.root">
    <li v-for="(item, index) in items" :key="index" :class="$style.item">
      <Icon v-if="index > 0" :icon="ChevronRight" :size="12" :class="$style.separator" />
      <span v-if="item.kind === 'walk'" :class="$style.walk">
        <Icon :icon="Footprints" :size="14" />
        {{ item.minutes }}
      </span>
      <span v-else :class="$style.lines">
        <RouteChip v-for="line in item.lines" :key="line.shortName" :short-name="line.shortName" :hue="line.hue" size="sm" />
      </span>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ChevronRight, Footprints } from "lucide";
import { Icon } from "@surstromming/icon";
import RouteChip from "@/components/RouteChip.vue";
import { wholeMinutes } from "@/composables/useJourneyFormat";
import type { JourneyLeg } from "@/planner/plan";
import { useTransit } from "@/stores/transit";

const props = defineProps<{ legs: JourneyLeg[] }>();

const transit = useTransit();

const line = (routeId: string) => ({
  shortName: transit.routeById.get(routeId)?.shortName ?? "?",
  hue: transit.routeById.get(routeId)?.hue ?? 0,
});

// A walk under a minute is a stop that was the start or the end itself, or the
// kerb across the road: real, and not worth a glyph.
const items = computed(() =>
  props.legs
    .filter((leg) => leg.kind === "ride" || leg.minutes >= 1)
    .map((leg) =>
      leg.kind === "walk"
        ? { kind: "walk" as const, minutes: wholeMinutes(leg.minutes) }
        : { kind: "ride" as const, lines: [leg.routeId, ...(leg.also ?? []).map((other) => other.routeId)].map(line) },
    ),
);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(1);
  align-items: center;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  gap: design.spacing(1);
  align-items: center;
}

.separator {
  color: design.color(muted-foreground);
}

.lines {
  display: inline-flex;
  flex-wrap: wrap;
  gap: design.spacing(0.5);
}

.walk {
  display: inline-flex;
  gap: design.spacing(0.5);
  align-items: center;
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
</style>
