<template>
  <!-- The shape of a trip at a glance: walk, bus, walk. Minutes on foot, the
       line's own chip for a ride. -->
  <ol :class="$style.root">
    <li v-for="(item, index) in items" :key="index" :class="$style.item">
      <Icon v-if="index > 0" :icon="ChevronRight" :size="12" :class="$style.separator" />
      <span v-if="item.kind === 'walk'" :class="$style.walk">
        <Icon :icon="Footprints" :size="14" />
        {{ item.minutes }}
      </span>
      <RouteChip v-else :short-name="item.shortName" :hue="item.hue" size="sm" />
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ChevronRight, Footprints } from "lucide";
import { Icon } from "@surstromming/icon";
import RouteChip from "@/components/RouteChip.vue";
import type { JourneyLeg } from "@/planner/plan";
import { useTransit } from "@/stores/transit";

const props = defineProps<{ legs: JourneyLeg[] }>();

const transit = useTransit();

// A walk under a minute is a stop that was the start or the end itself, or the
// kerb across the road: real, and not worth a glyph.
const items = computed(() =>
  props.legs
    .filter((leg) => leg.kind === "ride" || leg.minutes >= 1)
    .map((leg) =>
      leg.kind === "walk"
        ? { kind: "walk" as const, minutes: Math.round(leg.minutes) }
        : {
            kind: "ride" as const,
            shortName: transit.routeById.get(leg.routeId)?.shortName ?? "?",
            hue: transit.routeById.get(leg.routeId)?.hue ?? 0,
          },
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

.walk {
  display: inline-flex;
  gap: design.spacing(0.5);
  align-items: center;
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
</style>
