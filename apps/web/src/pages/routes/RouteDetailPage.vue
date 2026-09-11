<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <header :class="$style.head">
        <RouteChip :short-name="detail.shortName" :hue="detail.hue" />
        <div :class="$style.headText">
          <h1 :class="$style.title">{{ locale.t("routeLabel") }} {{ detail.shortName }}</h1>
          <p :class="$style.subtitle">
            {{ locale.plural(runningNow.length, "buses") }} {{ locale.t("onTheLine") }}
          </p>
        </div>
        <Button variant="outline" size="sm" @click="showOnMap">{{ locale.t("map") }}</Button>
      </header>

      <Alert v-if="!runningNow.length" variant="info" :title="locale.t('noBuses')" />

      <Tabs v-model="activeDirection" :tabs="directionTabs" variant="line" />

      <ol :class="$style.chain">
        <li v-for="stop in chain" :key="stop.id" :class="$style.stop">
          <RouterLink :to="`/stops/${stop.id}`" :class="$style.stopLink">
            <span :class="$style.marker" :style="{ '--hue': detail.hue }" />
            <span :class="$style.stopName">{{ locale.name(stop.name) }}</span>
            <span :class="$style.stopCode">{{ stop.code }}</span>
          </RouterLink>
        </li>
      </ol>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { Alert } from "@surstromming/alert";
import { Button } from "@surstromming/button";
import { ScrollArea } from "@surstromming/scroll-area";
import { Tabs, type TabItem } from "@surstromming/tabs";
import RouteChip from "@/components/RouteChip.vue";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";

const route = useRoute();
const router = useRouter();
const transit = useTransit();
const locale = useLocale();

const routeId = String(route.params.id);

await transit.loadNetwork();
const detail = await transit.loadRouteDetail(routeId);

const stopWatching = transit.watchVehicles();
onUnmounted(stopWatching);

const activeDirection = ref(String(detail.directions[0]?.direction ?? 1));

const directionTabs = computed<TabItem[]>(() =>
  detail.directions.map((leg) => ({
    label: `${locale.t(leg.direction === 1 ? "outbound" : "inbound")} · ${locale.name(leg.to)}`,
    value: String(leg.direction),
  })),
);

const chain = computed(() => {
  const leg = detail.directions.find((candidate) => String(candidate.direction) === activeDirection.value);
  return (leg?.stopIds ?? []).map((id) => transit.stopById.get(id)).filter((stop) => stop !== undefined);
});

// Buses actually working the route, not ones parked in the depot that the feed
// still reports against it.
const runningNow = computed(() =>
  transit.vehicles.filter((vehicle) => vehicle.routeId === routeId && vehicle.inService),
);

// Selecting the route is what the map reads, so the two pages agree about
// what "this route" means without passing anything through the URL.
const showOnMap = () => {
  transit.selectOnly(routeId);
  void router.push("/");
};
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(5);
  max-width: design.spacing(200);
  margin: 0 auto;
  padding: design.spacing(6) design.spacing(4);
}

.head {
  display: flex;
  gap: design.spacing(3);
  align-items: center;
}

.headText {
  flex: 1;
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.subtitle {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
}

.chain {
  margin: 0;
  padding: 0;
  list-style: none;
}

.stop {
  position: relative;
}

// The connecting line is drawn by the rows themselves, so a stop list reads as
// a line rather than as a bulleted list that happens to be in order.
.stop:not(:last-child) .marker::after {
  position: absolute;
  top: 100%;
  left: 50%;
  width: 2px;
  height: design.spacing(6);
  transform: translateX(-50%);
  background-color: oklch(var(--route-l) var(--route-c) var(--hue));
  content: "";
}

.stopLink {
  display: grid;
  gap: design.spacing(3);
  align-items: center;
  grid-template-columns: auto 1fr auto;
  padding: design.spacing(2);
  border-radius: design.radius(sm);
  color: design.color(foreground);
  text-decoration: none;

  &:hover {
    background-color: design.color(accent);
  }
}

.marker {
  position: relative;
  width: design.spacing(3);
  height: design.spacing(3);
  border: 2px solid oklch(var(--route-l) var(--route-c) var(--hue));
  border-radius: 50%;
  background-color: design.color(background);
}

.stopName {
  overflow: hidden;
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stopCode {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
</style>
