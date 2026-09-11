<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <!-- The app installs as a PWA with no browser chrome, and iOS standalone
           has no back control at all — so without this a stop is a dead end.
           Derived from where the selection came from rather than from history,
           so a shared link behaves the same as a tap. -->
      <RouterLink :to="backTo" :class="$style.back">
        <Icon :icon="ArrowLeft" :size="16" />
        {{ locale.t(backKey) }}
      </RouterLink>

      <header :class="$style.head">
        <h1 :class="$style.title">{{ locale.name(stop.name) }}</h1>
        <p :class="$style.subtitle">{{ locale.t("stopNumber") }} {{ stop.code }}</p>
      </header>

      <!-- One chip per route through this stop, each opening the map with only
           that route drawn. The routes are already named in the boards below,
           but there they answer "when" — here they answer "where does it go",
           which is a different question and needs its own affordance. -->
      <section v-if="routesHere.length" :class="$style.section">
        <h2 :class="$style.sectionTitle">{{ locale.t("routesThrough") }}</h2>
        <div :class="$style.routeRow">
          <button
            v-for="route in routesHere"
            :key="route.routeId"
            type="button"
            :class="$style.routeButton"
            :aria-label="`${locale.t('routeLabel')} ${route.shortName} — ${locale.t('showOnMap')}`"
            @click="showRouteOnMap(route.routeId)"
          >
            <RouteChip :short-name="route.shortName" :hue="route.hue" size="sm" />
            <Icon :icon="MapIcon" :size="14" :class="$style.routeIcon" />
          </button>
        </div>
      </section>

      <section :class="$style.section">
        <h2 :class="$style.sectionTitle">{{ locale.t("live") }}</h2>
        <ArrivalBoard
          :arrivals="arrivals"
          :loading="loading"
          :serves-nothing="!stop.schedules.length"
          :failed="failed"
        />
      </section>

      <section v-if="stop.schedules.length" :class="$style.section">
        <h2 :class="$style.sectionTitle">{{ locale.t("timetable") }}</h2>
        <p :class="$style.note">{{ locale.t("timetableNote") }}</p>

        <TimetableSection
          v-for="schedule in stop.schedules"
          :key="`${schedule.routeId}-${schedule.direction}`"
          :schedule="schedule"
          :now-h-h-m-m="nowInBatumi"
        />
      </section>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowLeft, Map as MapIcon } from "lucide";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import ArrivalBoard from "@/components/ArrivalBoard.vue";
import RouteChip from "@/components/RouteChip.vue";
import TimetableSection from "@/components/TimetableSection.vue";
import { api } from "@/api/client";
import { useArrivals } from "@/composables/useArrivals";
import { useNow } from "@/composables/useNow";
import { useLocale } from "@/stores/locale";
import { useProximity } from "@/stores/proximity";
import { useTransit } from "@/stores/transit";

const route = useRoute();
const router = useRouter();
const locale = useLocale();
const proximity = useProximity();
const transit = useTransit();
const now = useNow();

// Where this stop was reached from. A picked point still lives in the store, so
// returning to the map re-opens the sheet that produced this.
const backTo = computed(() => (proximity.origin?.kind === "me" ? "/nearby" : "/"));
const backKey = computed<"backToNearby" | "backToPickedPoint" | "backToMap">(() => {
  if (proximity.origin?.kind === "me") return "backToNearby";
  if (proximity.origin?.kind === "point") return "backToPickedPoint";
  return "backToMap";
});

const stopId = String(route.params.id);
const stop = await api.stop(stopId);

// Schedules are per route *and* direction, so the same line appears twice.
const routesHere = computed(() => {
  const seen = new Map<string, { routeId: string; shortName: string; hue: number }>();
  for (const schedule of stop.schedules) {
    if (!seen.has(schedule.routeId)) {
      seen.set(schedule.routeId, {
        routeId: schedule.routeId,
        shortName: schedule.shortName,
        hue: schedule.hue,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.shortName.localeCompare(b.shortName, "en", { numeric: true }));
});

// The selection *is* the map's state, so setting it and navigating is all this
// needs — no route id in the URL, and the map is already wired to draw it.
const showRouteOnMap = (routeId: string) => {
  transit.selectOnly(routeId);
  void router.push("/");
};

const { arrivals, loading, failed } = useArrivals(ref(stopId));

const batumiClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tbilisi",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Batumi time, not the reader's: someone checking this timetable from abroad
// still wants to know what the bus does at the stop. Driven off the shared
// clock so it rolls over on its own rather than at the next navigation.
const nowInBatumi = computed(() => batumiClock.format(new Date(now.value)));
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(6);
  max-width: design.spacing(200);
  margin: 0 auto;
  padding: design.spacing(6) design.spacing(4);
}

// A styled RouterLink rather than `Button :as`, matching the map panel's own
// link — and it must be a real <a href> so middle-click and long-press work.
.back {
  display: inline-flex;
  gap: design.spacing(1.5);
  align-items: center;
  align-self: flex-start;
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
  text-decoration: none;

  &:hover {
    color: design.color(foreground);
  }

  &:focus-visible {
    outline: 2px solid design.color(ring);
    outline-offset: 2px;
  }
}

.head {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1);
}

.title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 600;
}

.subtitle {
  color: design.color(muted-foreground);
  font-size: 0.8125rem;
}

.section {
  display: flex;
  flex-direction: column;
  gap: design.spacing(3);
}

.sectionTitle {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.note {
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

.routeRow {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(2);
}

.routeButton {
  display: flex;
  gap: design.spacing(1.5);
  align-items: center;
  padding: design.spacing(1) design.spacing(2);
  border: 1px solid design.color(border);
  border-radius: design.radius(md);
  background-color: design.color(card);
  cursor: pointer;

  &:hover {
    background-color: design.color(accent);
  }

  &:focus-visible {
    outline: 2px solid design.color(ring);
    outline-offset: 2px;
  }
}

// Says "this opens the map" without a word of label per chip.
.routeIcon {
  color: design.color(muted-foreground);
}

</style>
