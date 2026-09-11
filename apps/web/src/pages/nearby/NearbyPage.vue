<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <header :class="$style.head">
        <h1 :class="$style.title">{{ locale.t("nearbyStops") }}</h1>
        <p :class="$style.subtitle">{{ locale.t("straightLineNote") }}</p>
      </header>

      <Alert v-if="denied" variant="destructive" :title="locale.t('locationDenied')" />

      <Button v-if="!position" :disabled="locating" @click="locate">
        <Spinner v-if="locating" :size="16" />
        <Icon v-else :icon="LocateFixed" />
        {{ locating ? locale.t("locating") : locale.t("nearMe") }}
      </Button>

      <p v-else-if="!nearest.length" :class="$style.empty">{{ locale.t("noNearbyStops") }}</p>

      <ul v-else :class="$style.list">
        <li v-for="entry in nearest" :key="entry.stop.id">
          <RouterLink :to="`/stops/${entry.stop.id}`" :class="$style.card">
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
          </RouterLink>
        </li>
      </ul>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { LocateFixed } from "lucide";
import { Alert } from "@surstromming/alert";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { Spinner } from "@surstromming/spinner";
import RouteChip from "@/components/RouteChip.vue";
import { useGeolocation } from "@/composables/useGeolocation";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const locale = useLocale();

await transit.loadNetwork();

const { position, locating, denied, locate } = useGeolocation();

/** Beyond this it is not "nearby" any more, it is a different trip. */
const MAX_METRES = 1200;
const SHOWN = 12;
/** A brisk walk. Deliberately not a routed time — see the note under the title. */
const METRES_PER_MINUTE = 80;

const metresBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const nearest = computed(() => {
  const here = position.value;
  if (!here) return [];

  return transit.stops
    .map((stop) => ({ stop, metres: metresBetween(here, stop) }))
    .filter((entry) => entry.metres <= MAX_METRES)
    .sort((a, b) => a.metres - b.metres)
    .slice(0, SHOWN)
    .map((entry) => ({
      stop: entry.stop,
      distanceLabel:
        entry.metres < 1000
          ? `${Math.round(entry.metres / 10) * 10} ${locale.t("metresAway")}`
          : `${(entry.metres / 1000).toFixed(1)} ${locale.t("kilometresAway")}`,
      walkLabel: `${Math.max(1, Math.round(entry.metres / METRES_PER_MINUTE))} ${locale.t("walkMinutes")}`,
      routes: entry.stop.routeIds
        .map((id) => transit.routeById.get(id))
        .filter((route) => route !== undefined),
    }));
});
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(4);
  align-items: flex-start;
  max-width: design.spacing(200);
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

.subtitle,
.empty {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
}

.list {
  display: grid;
  gap: design.spacing(2);
  width: 100%;
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
