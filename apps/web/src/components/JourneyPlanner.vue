<template>
  <section :class="$style.root" :aria-label="locale.t('planTrip')">
    <div :class="$style.head">
      <span :class="$style.label">{{ locale.t("planTrip") }}</span>
      <Button v-if="hasAnything" variant="ghost" size="sm" @click="clear">
        {{ locale.t("clearSelection") }}
      </Button>
    </div>

    <div :class="$style.fields">
      <!-- The same two marks the map draws at either end, joined as the trip is. -->
      <div :class="$style.rail" aria-hidden="true">
        <i :class="$style.startMark" />
        <i :class="$style.railLine" />
        <i :class="$style.endMark" />
      </div>

      <div :class="$style.inputs">
        <Input
          ref="fromInput"
          v-model="queries.from"
          type="search"
          size="sm"
          autocomplete="off"
          :placeholder="locale.t('fromLabel')"
          :aria-label="locale.t('fromLabel')"
          @focus="onFocus('from', $event)"
          @blur="onBlur"
          @input="onType('from')"
          @keydown="onKeydown"
        />
        <Input
          ref="toInput"
          v-model="queries.to"
          type="search"
          size="sm"
          autocomplete="off"
          :placeholder="locale.t('toLabel')"
          :aria-label="locale.t('toLabel')"
          @focus="onFocus('to', $event)"
          @blur="onBlur"
          @input="onType('to')"
          @keydown="onKeydown"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        :aria-label="locale.t('swapEnds')"
        :title="locale.t('swapEnds')"
        :disabled="!hasAnything"
        @click="planner.swap()"
      >
        <Icon :icon="ArrowUpDown" />
      </Button>
    </div>

    <!-- Pressing a suggestion must not blur the field first, or the list is
         gone before the click lands. -->
    <ul v-if="suggestions.length" :class="$style.suggestions" @mousedown.prevent>
      <li v-for="(item, index) in suggestions" :key="item.key">
        <button type="button" :class="suggestionClasses(index)" @click="choose(item)">
          <Icon v-if="item.icon" :icon="item.icon" :size="16" :class="$style.suggestionIcon" />
          <span v-else :class="$style.code">{{ item.code }}</span>
          <span :class="$style.suggestionText">{{ item.label }}</span>
          <span v-if="item.meta" :class="$style.meta">{{ item.meta }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="noResults" :class="$style.empty">{{ locale.t("noResults") }}</p>

    <div :class="$style.when">
      <DropdownMenu :items="whenItems" align="start" @select="chooseWhen">
        <template #trigger="{ toggle }">
          <Button variant="ghost" size="sm" :aria-label="locale.t('whenLabel')" @click="toggle">
            <Icon :icon="Clock" :size="16" />
            {{ whenLabel }}
          </Button>
        </template>
      </DropdownMenu>
      <Input
        v-if="planner.whenMode !== 'now'"
        v-model="clockValue"
        type="time"
        size="sm"
        :class="$style.time"
        :aria-label="whenLabel"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useCssModule, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowUpDown, Check, Clock, LocateFixed, MapPin } from "lucide";
import { Button } from "@surstromming/button";
import { DropdownMenu, type DropdownMenuItem } from "@surstromming/dropdown-menu";
import { Icon, type IconNode } from "@surstromming/icon";
import { Input } from "@surstromming/input";
import { useJourneyFormat } from "@/composables/useJourneyFormat";
import { useStopSearch } from "@/composables/useStopSearch";
import { clockLabel, minutesInBatumi } from "@/planner/time";
import { useLocale } from "@/stores/locale";
import { usePlanner, type Place, type PlaceField, type WhenMode } from "@/stores/planner";
import { useProximity } from "@/stores/proximity";
import { useSidebar } from "@/stores/sidebar";
import { useTransit } from "@/stores/transit";

interface Suggestion {
  key: string;
  label: string;
  icon?: IconNode;
  code?: number;
  meta?: string;
  choose: () => void;
}

const locale = useLocale();
const planner = usePlanner();
const proximity = useProximity();
const sidebar = useSidebar();
const transit = useTransit();
const route = useRoute();
const router = useRouter();
const $style = useCssModule();

const fromInput = useTemplateRef<{ $el: HTMLInputElement }>("fromInput");
const toInput = useTemplateRef<{ $el: HTMLInputElement }>("toInput");

/** What each field shows: the chosen place's name, or what is being typed. */
const queries = reactive<Record<PlaceField, string>>({ from: "", to: "" });
const activeField = ref<PlaceField | null>(null);
const highlighted = ref(0);

const hasAnything = computed(() => !!(planner.from || planner.to || queries.from || queries.to));

const { place: placeLabel } = useJourneyFormat();

// A place chosen anywhere — here, from a stop's sheet, by a tap on the map, by
// a swap — shows up in its field. Typing is never overwritten: a field only
// changes when its place does.
const syncField = (field: PlaceField) => {
  const place = planner[field];
  if (place) queries[field] = placeLabel(place);
};
watch(
  () => [planner.from, planner.to, locale.locale, transit.stops.length] as const,
  () => {
    syncField("from");
    syncField("to");
  },
  { immediate: true },
);
// Clearing the plan elsewhere — the map sheet's close — empties the fields too,
// or they would name places that are no longer part of anything. Except the
// field being typed in: its place was cleared *by* the typing, and emptying it
// would eat the keystroke. Synchronous, so the flag is still up when it runs.
let typingIn: PlaceField | null = null;
watch(
  () => [planner.from, planner.to] as const,
  ([from, to], [oldFrom, oldTo]) => {
    if (!from && oldFrom && typingIn !== "from") queries.from = "";
    if (!to && oldTo && typingIn !== "to") queries.to = "";
  },
  { flush: "sync" },
);

const activeQuery = computed(() => {
  const field = activeField.value;
  if (!field) return "";
  const text = queries[field];
  // Focusing a field that already names a place is not a search for that name.
  return text === placeLabel(planner[field]) ? "" : text;
});

const { results } = useStopSearch(activeQuery);

const canLocate = typeof navigator !== "undefined" && "geolocation" in navigator;

const suggestions = computed<Suggestion[]>(() => {
  const field = activeField.value;
  if (!field) return [];

  if (activeQuery.value.trim().length < 2) {
    const options: Suggestion[] = [];
    if (canLocate) {
      options.push({
        key: "me",
        label: locale.t("followMe"),
        icon: LocateFixed,
        choose: () => place(field, { kind: "me" }),
      });
    }
    options.push({ key: "pick", label: locale.t("chooseOnMap"), icon: MapPin, choose: () => pickOnMap(field) });
    return options;
  }

  return results.value.map((stop) => ({
    key: stop.id,
    code: stop.code,
    label: locale.name(stop.name),
    meta: String(stop.routeIds.length),
    choose: () => place(field, { kind: "stop", stopId: stop.id }),
  }));
});

const noResults = computed(() => !!activeField.value && activeQuery.value.trim().length >= 2 && !results.value.length);

watch(suggestions, () => (highlighted.value = 0));

const suggestionClasses = (index: number) => [
  $style.suggestion,
  { [$style.isHighlighted]: index === highlighted.value },
];

const inputFor = (field: PlaceField) => (field === "from" ? fromInput.value?.$el : toInput.value?.$el);

const onFocus = (field: PlaceField, event: FocusEvent) => {
  activeField.value = field;
  // A field that names a place is edited by replacing it, as an address bar is.
  (event.target as HTMLInputElement | null)?.select();
  // The timetable and the permission state are both wanted the moment anyone
  // starts on a trip, and neither is worth fetching for a visit that never does.
  void planner.loadTimetable();
  void proximity.init();
};

const onBlur = () => {
  activeField.value = null;
};

// Typing over a chosen place un-chooses it: what is in the field is a search now.
const onType = (field: PlaceField) => {
  if (!planner[field] || queries[field] === placeLabel(planner[field])) return;
  typingIn = field;
  planner.setPlace(field, null);
  typingIn = null;
};

const onKeydown = (event: KeyboardEvent) => {
  const count = suggestions.value.length;
  if (event.key === "ArrowDown" && count) {
    event.preventDefault();
    highlighted.value = (highlighted.value + 1) % count;
  } else if (event.key === "ArrowUp" && count) {
    event.preventDefault();
    highlighted.value = (highlighted.value - 1 + count) % count;
  } else if (event.key === "Enter" && count) {
    event.preventDefault();
    choose(suggestions.value[highlighted.value]!);
  } else if (event.key === "Escape") {
    (event.target as HTMLInputElement).blur();
  }
};

const choose = (item: Suggestion) => item.choose();

const showMap = async () => {
  if (route.path !== "/") await router.push("/");
};

const place = async (field: PlaceField, chosen: Place) => {
  planner.setPlace(field, chosen);
  inputFor(field)?.blur();

  // Both ends known: the answer is on the map, and on a phone the drawer is
  // covering it.
  if (planner.from && planner.to) {
    await showMap();
    sidebar.closeOnMobile();
    return;
  }

  // One end known. A stop is worth seeing straight away — its arrivals are on
  // the map — but the drawer stays, and the other field takes the cursor, because
  // the trip is only half asked.
  if (chosen.kind === "stop") await showMap();
  const other: PlaceField = field === "from" ? "to" : "from";
  await nextTick();
  inputFor(other)?.focus();
};

// The map is only at "/", and on a phone the drawer covers it: arming the pick
// somewhere else has to take the reader to the thing they were just asked to tap.
const pickOnMap = async (field: PlaceField) => {
  planner.arm(field);
  inputFor(field)?.blur();
  await showMap();
  sidebar.closeOnMobile();
};

const clear = () => {
  planner.clear();
  queries.from = "";
  queries.to = "";
};

const whenKeys: Record<WhenMode, "leaveNow" | "departAt" | "arriveBy"> = {
  now: "leaveNow",
  depart: "departAt",
  arrive: "arriveBy",
};

const whenLabel = computed(() => locale.t(whenKeys[planner.whenMode]));

const whenItems = computed<DropdownMenuItem[]>(() =>
  (Object.keys(whenKeys) as WhenMode[]).map((mode) => ({
    label: locale.t(whenKeys[mode]),
    value: mode,
    icon: mode === planner.whenMode ? Check : undefined,
  })),
);

// A time field that opens empty is one more thing to fill in. It starts at the
// next five minutes in Batumi, which is what "leave at" means most of the time.
const chooseWhen = (value: string) => {
  const mode = value as WhenMode;
  const soon = Math.ceil((minutesInBatumi(Date.now()) + 1) / 5) * 5;
  planner.setWhen(mode, planner.whenClock || clockLabel(soon));
};

const clockValue = computed({
  get: () => planner.whenClock,
  set: (value: string) => planner.setWhen(planner.whenMode, value),
});
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

.fields {
  display: grid;
  gap: design.spacing(2);
  align-items: center;
  grid-template-columns: auto 1fr auto;
}

.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
  justify-content: space-between;
  // The marks sit on the middle of each field, not at the top of the stack.
  padding: design.spacing(3) 0;
}

.startMark,
.endMark {
  width: design.spacing(2.5);
  height: design.spacing(2.5);
  border-radius: 50%;
}

// The pair the map draws: a hollow ring where the trip starts, a filled dot
// where it ends.
.startMark {
  border: 2px solid var(--stop-selected-fill);
  background-color: var(--stop-fill);
}

.endMark {
  background-color: var(--stop-selected-fill);
}

.railLine {
  flex: 1;
  width: 0;
  margin: design.spacing(1) 0;
  border-left: 2px dotted design.color(muted-foreground);
}

.inputs {
  display: flex;
  flex-direction: column;
  gap: design.spacing(1.5);
  min-width: 0;
}

.suggestions {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.suggestion {
  display: grid;
  gap: design.spacing(2);
  align-items: center;
  grid-template-columns: auto 1fr auto;
  width: 100%;
  padding: design.spacing(2);
  border: none;
  border-radius: design.radius(sm);
  background-color: transparent;
  color: design.color(sidebar-foreground);
  text-align: left;
  cursor: pointer;

  &:hover {
    background-color: design.color(sidebar-accent);
  }

  &:focus-visible {
    outline: 2px solid design.color(sidebar-ring);
    outline-offset: -2px;
  }
}

.isHighlighted {
  background-color: design.color(sidebar-accent);
}

.suggestionIcon {
  color: design.color(muted-foreground);
}

// The number on the pole is the unambiguous handle, so it leads.
.code {
  min-width: design.spacing(10);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.suggestionText {
  overflow: hidden;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  color: design.color(muted-foreground);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.empty {
  padding-left: design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}

.when {
  display: flex;
  gap: design.spacing(2);
  align-items: center;
}

.time {
  max-width: design.spacing(28);
}
</style>
