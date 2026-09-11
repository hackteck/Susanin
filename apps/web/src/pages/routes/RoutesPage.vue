<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <header :class="$style.head">
        <h1 :class="$style.title">{{ locale.t("routes") }}</h1>
        <p :class="$style.subtitle">
          {{ locale.plural(transit.routes.length, "routes") }} ·
          {{ locale.plural(transit.stops.length, "stops") }}
        </p>
      </header>

      <ul :class="$style.list">
        <li v-for="route in transit.routes" :key="route.id">
          <RouterLink :to="`/routes/${route.id}`" :class="$style.card">
            <RouteChip :short-name="route.shortName" :hue="route.hue" />

            <span :class="$style.legs">
              <span v-for="leg in route.directions" :key="leg.direction" :class="$style.leg">
                {{ locale.name(leg.from) }} → {{ locale.name(leg.to) }}
              </span>
            </span>

            <span :class="$style.count">{{ busesOn(route.id) }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { onUnmounted } from "vue";
import { RouterLink } from "vue-router";
import { ScrollArea } from "@surstromming/scroll-area";
import RouteChip from "@/components/RouteChip.vue";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const locale = useLocale();

await transit.loadNetwork();

// The live count is the one thing that makes this a list of running lines
// rather than a table of numbers.
const stopWatching = transit.watchVehicles();
onUnmounted(stopWatching);

// In service only, matching the header count and the route page. The feed keeps
// reporting a depot full of buses overnight, and counting those here would have
// this list disagree with every other number in the app.
const busesOn = (routeId: string) =>
  transit.vehicles.filter((vehicle) => vehicle.routeId === routeId && vehicle.inService).length;
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(6);
  max-width: design.spacing(240);
  margin: 0 auto;
  padding: design.spacing(6) design.spacing(4);
}

.head {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1);
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.subtitle {
  color: design.color(muted-foreground);
  font-size: 0.875rem;
}

.list {
  display: grid;
  gap: design.spacing(2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.card {
  display: grid;
  gap: design.spacing(3);
  align-items: center;
  grid-template-columns: auto 1fr auto;
  padding: design.spacing(3);
  border: 1px solid design.color(border);
  border-radius: design.radius(md);
  background-color: design.color(card);
  color: design.color(card-foreground);
  text-decoration: none;

  &:hover {
    background-color: design.color(accent);
  }
}

.legs {
  display: flex;
  flex-direction: column;
  gap: design.spacing(0.5);
  min-width: 0;
}

.leg {
  overflow: hidden;
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}
</style>
