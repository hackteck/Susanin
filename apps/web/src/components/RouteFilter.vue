<template>
  <div :class="$style.root">
    <div :class="$style.head">
      <span :class="$style.label">{{ locale.t("routes") }}</span>
      <Button
        v-if="transit.selectedRouteIds.length"
        variant="ghost"
        size="sm"
        @click="transit.clearSelection"
      >
        {{ locale.t("clearSelection") }}
      </Button>
    </div>

    <p :class="$style.hint">{{ hint }}</p>

    <div :class="$style.grid">
      <button
        v-for="route in transit.routes"
        :key="route.id"
        type="button"
        :class="chipClasses(route.id)"
        :style="{ '--hue': route.hue }"
        :aria-pressed="isSelected(route.id)"
        :title="routeTitle(route)"
        @click="transit.toggleRoute(route.id)"
      >
        {{ route.shortName }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useCssModule } from "vue";
import { Button } from "@surstromming/button";
import type { Route } from "@/api/types";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const locale = useLocale();
const $style = useCssModule();

const isSelected = (id: string) => transit.selectedRouteIds.includes(id);

const chipClasses = (id: string) => [$style.chip, { [$style.isSelected]: isSelected(id) }];

// Guarded on the route list being loaded: with the network unreachable this
// otherwise read "2 / 0", which is a saved selection divided by nothing.
const hint = computed(() => {
  if (!transit.routes.length) return "";
  if (!transit.selectedRouteIds.length) return locale.t("allRoutes");
  return `${transit.selectedRouteIds.length} / ${transit.routes.length}`;
});

// The terminals are what tell two similarly numbered lines apart.
const routeTitle = (route: Route) => {
  const outbound = route.directions[0];
  if (!outbound) return route.shortName;
  return `${route.shortName}: ${locale.name(outbound.from)} → ${locale.name(outbound.to)}`;
};
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
  padding: design.spacing(2);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: design.spacing(8);
}

.label {
  padding-left: design.spacing(2);
  color: design.color(sidebar-foreground);
  font-size: 0.75rem;
  font-weight: 600;
}

.hint {
  padding-left: design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

// A grid of numbers, not a list of rows: 28 lines are identified by their
// number and their colour, and both fit in a chip.
.grid {
  display: grid;
  gap: design.spacing(1.5);
  grid-template-columns: repeat(auto-fill, minmax(design.spacing(12), 1fr));
}

.chip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: design.spacing(9);
  border: 1px solid design.color(sidebar-border);
  border-radius: design.radius(md);
  background-color: design.color(sidebar);
  color: design.color(sidebar-foreground);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;

  // The route's own colour, always present as an edge so an unselected chip
  // still says which line it is.
  border-left: design.spacing(1) solid oklch(var(--route-l) var(--route-c) var(--hue));

  &:hover {
    background-color: design.color(sidebar-accent);
  }

  &:focus-visible {
    outline: 2px solid design.color(sidebar-ring);
    outline-offset: 2px;
  }
}

.isSelected {
  border-color: oklch(var(--route-l) var(--route-c) var(--hue));
  background-color: oklch(var(--route-l) var(--route-c) var(--hue));
  color: var(--route-label);

  // `.chip:hover` is two classes and this is one, so without a hover of its own
  // the grey wins on specificity and a selected chip loses its colour while
  // keeping the white label it was given *because* it had one — white on pale
  // grey, and the line you picked reads as the only one you didn't.
  // Hover stays the route's colour and darkens it, so the feedback never costs
  // the chip its identity.
  &:hover {
    background-color: oklch(calc(var(--route-l) - 0.06) var(--route-c) var(--hue));
    border-color: oklch(calc(var(--route-l) - 0.06) var(--route-c) var(--hue));
  }
}
</style>
