<template>
  <div :class="$style.root">
    <Input
      v-model="query"
      type="search"
      size="sm"
      :placeholder="locale.t('searchStops')"
      :aria-label="locale.t('searchStops')"
    />

    <p v-if="query.trim().length >= 2 && !results.length" :class="$style.empty">
      {{ locale.t("noResults") }}
    </p>

    <ul v-else-if="results.length" :class="$style.list">
      <li v-for="stop in results" :key="stop.id">
        <RouterLink :to="`/stops/${stop.id}`" :class="$style.hit" @click="query = ''">
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
import { RouterLink } from "vue-router";
import { Input } from "@surstromming/input";
import { useStopSearch } from "@/composables/useStopSearch";
import { useLocale } from "@/stores/locale";

const locale = useLocale();
const query = ref("");
const { results } = useStopSearch(query);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
  padding: design.spacing(2);
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
