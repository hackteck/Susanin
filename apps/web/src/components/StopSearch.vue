<template>
  <div :class="$style.root">
    <div :class="$style.searchRow">
      <Input
        v-model="query"
        type="search"
        size="sm"
        :class="$style.field"
        :placeholder="locale.t('searchStops')"
        :aria-label="locale.t('searchStops')"
      />

      <!-- The other way to find a stop: point at where you mean. `aria-pressed`
           carries the armed state, since the crosshair cursor cannot. -->
      <Button
        variant="outline"
        size="icon"
        :class="{ [$style.isArmed]: proximity.pickMode }"
        :aria-label="locale.t(proximity.pickMode ? 'pickOnMapCancel' : 'pickOnMap')"
        :aria-pressed="proximity.pickMode"
        @click="togglePick"
      >
        <Icon :icon="MapPin" />
      </Button>
    </div>

    <p v-if="query.trim().length >= 2 && !results.length" :class="$style.empty">
      {{ locale.t("noResults") }}
    </p>

    <ul v-else-if="results.length" :class="$style.list">
      <li v-for="stop in results" :key="stop.id">
        <RouterLink :to="`/stops/${stop.id}`" :class="$style.hit" @click="onResult">
          <span :class="$style.code">{{ stop.code }}</span>
          <span :class="$style.name">{{ locale.name(stop.name) }}</span>
          <span :class="$style.routes">{{ stop.routeIds.length }}</span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { MapPin } from "lucide";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { Input } from "@surstromming/input";
import { isMobile } from "@surstromming/util";
import { useStopSearch } from "@/composables/useStopSearch";
import { useLocale } from "@/stores/locale";
import { useProximity } from "@/stores/proximity";
import { useSidebar } from "@/stores/sidebar";

const locale = useLocale();
const proximity = useProximity();
const sidebar = useSidebar();
const route = useRoute();
const router = useRouter();
const query = ref("");
const { results } = useStopSearch(query);

// This search lives in the sidebar, which is on every page; the map is only at
// "/". Arming somewhere else has to take the reader to the thing they were just
// asked to tap — and on a phone the drawer is covering it.
const togglePick = async () => {
  if (proximity.pickMode) {
    proximity.disarm();
    return;
  }
  proximity.arm();
  if (route.path !== "/") await router.push("/");
  if (isMobile.value) sidebar.open = false;
};

// A stop found by name did not come from a proximity list, so it must not
// inherit a "back to the stops near you" claim it was never part of.
const onResult = () => {
  query.value = "";
  proximity.clearOrigin();
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

.searchRow {
  display: flex;
  gap: design.spacing(2);
  align-items: center;
}

.field {
  flex: 1;
  min-width: 0;
}

// `Button` has no "active" variant, so the armed look is an app class riding the
// fallthrough attribute — it composes with the button's own module classes
// rather than replacing them.
.isArmed {
  border-color: design.color(sidebar-ring);
  background-color: design.color(sidebar-accent);
}

.empty {
  padding-left: design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

.list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hit {
  display: grid;
  gap: design.spacing(2);
  align-items: center;
  grid-template-columns: auto 1fr auto;
  padding: design.spacing(2);
  border-radius: design.radius(sm);
  color: design.color(sidebar-foreground);
  text-decoration: none;

  &:hover {
    background-color: design.color(sidebar-accent);
  }
}

// The number on the pole is the unambiguous handle, so it leads.
.code {
  min-width: design.spacing(10);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.name {
  overflow: hidden;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.routes {
  color: design.color(muted-foreground);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}
</style>
