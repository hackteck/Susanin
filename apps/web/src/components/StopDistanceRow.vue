<template>
  <!-- Contents only: the caller owns the wrapper. The nearby page needs a real
       <a> so middle-click and open-in-new-tab keep working; the map's sheet
       needs a <button>. One row design, two affordances, no `as` guesswork. -->
  <span :class="$style.distance">
    <b>{{ entry.distanceLabel }}</b>
    <i>{{ entry.walkLabel }}</i>
  </span>

  <span :class="$style.detail">
    <span :class="$style.name">{{ locale.name(entry.stop.name) }}</span>
    <span :class="$style.code">{{ locale.t("stopNumber") }} {{ entry.stop.code }}</span>
  </span>

  <span :class="$style.chips">
    <RouteChip
      v-for="route in entry.routes"
      :key="route.id"
      :short-name="route.shortName"
      :hue="route.hue"
      size="sm"
    />
  </span>
</template>

<script setup lang="ts">
import RouteChip from "@/components/RouteChip.vue";
import type { NearestEntry } from "@/composables/useNearestStops";
import { useLocale } from "@/stores/locale";

defineProps<{ entry: NearestEntry }>();

const locale = useLocale();
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

// Distance leads: at a kerb, "how far" is the question, and the name only
// matters once you have picked which one to walk to.
.distance {
  display: flex;
  flex-direction: column;
  min-width: design.spacing(16);

  b {
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
  }

  i {
    color: design.color(muted-foreground);
    font-size: 0.6875rem;
    font-style: normal;
  }
}

.detail {
  display: flex;
  flex-direction: column;
  gap: design.spacing(0.5);
  min-width: 0;
}

.name {
  overflow: hidden;
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(1);
  justify-content: flex-end;
  max-width: design.spacing(40);
}
</style>
