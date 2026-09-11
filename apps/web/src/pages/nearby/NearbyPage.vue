<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <header :class="$style.head">
        <h1 :class="$style.title">{{ locale.t("nearbyStops") }}</h1>
        <p :class="$style.subtitle">{{ locale.t("straightLineNote") }}</p>
      </header>

      <Alert v-if="proximity.denied" variant="destructive" :title="locale.t('locationDenied')" />
      <Alert v-else-if="proximity.coarse && entries.length" :title="locale.t('coarseFix')" />

      <!-- Only shown when there is nothing to show. A reader who granted
           permission months ago now arrives at a list, not at a button. -->
      <Button v-if="!proximity.fix" :disabled="proximity.locating" @click="proximity.useMyLocation()">
        <Spinner v-if="proximity.locating" :size="16" />
        <Icon v-else :icon="LocateFixed" />
        {{ proximity.locating ? locale.t("locating") : locale.t("nearMe") }}
      </Button>

      <!-- A list held in a store goes stale as easily as a dot did. Re-sorting
           under the reader's finger while they are reading a row is worse than
           asking, so this is offered rather than done. -->
      <div v-else-if="stale" :class="$style.stale">
        <p :class="$style.subtitle">{{ locale.t("locationStale") }}</p>
        <Button variant="ghost" size="sm" :disabled="proximity.locating" @click="proximity.locate()">
          <Spinner v-if="proximity.locating" :size="16" />
          <Icon v-else :icon="LocateFixed" :size="16" />
          {{ locale.t("refreshLocation") }}
        </Button>
      </div>

      <p v-if="proximity.fix && !entries.length" :class="$style.empty">{{ locale.t("noNearbyStops") }}</p>

      <ul v-else-if="entries.length" :class="$style.list">
        <li v-for="entry in entries" :key="entry.stop.id">
          <RouterLink :to="`/stops/${entry.stop.id}`" :class="$style.card">
            <StopDistanceRow :entry="entry" />
          </RouterLink>
        </li>
      </ul>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { LocateFixed } from "lucide";
import { Alert } from "@surstromming/alert";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { Spinner } from "@surstromming/spinner";
import StopDistanceRow from "@/components/StopDistanceRow.vue";
import { useNearestStops } from "@/composables/useNearestStops";
import { useNow } from "@/composables/useNow";
import { useLocale } from "@/stores/locale";
import { useProximity } from "@/stores/proximity";
import { useTransit } from "@/stores/transit";

const transit = useTransit();
const locale = useLocale();
const proximity = useProximity();
const now = useNow();

await transit.loadNetwork();

/** Longer than the map's stale threshold: a list is read, not tracked. */
const REFRESH_AFTER_MS = 300000;

const { entries } = useNearestStops(computed(() => proximity.anchor));

const stale = computed(() => !!proximity.fix && now.value - proximity.fix.at > REFRESH_AFTER_MS);

onMounted(() => {
  // This page is *about* being near things, so arriving here is consent enough
  // to use a permission already granted — but never to ask for one.
  void proximity.init().then(() => {
    if (proximity.permission === "granted") proximity.useMyLocation();
  });
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

.stale {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(2);
  align-items: center;
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
</style>
