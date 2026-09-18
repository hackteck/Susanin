<template>
  <section :class="$style.root" :aria-label="locale.t('planTrip')">
    <div :class="$style.head">
      <span :class="$style.label">{{ locale.t("planTrip") }}</span>
      <Button v-if="hasAnything" variant="ghost" size="sm" @click="clear">
        {{ locale.t("clearSelection") }}
      </Button>
    </div>

    <div :class="$style.fields">
      <Input
        ref="fromInput"
        name="from"
        v-model="queries.from"
        type="search"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="expanded('from')"
        :aria-controls="expanded('from') ? listId : undefined"
        :aria-activedescendant="activeOption('from')"
        :placeholder="locale.t('fromLabel')"
        :aria-label="locale.t('fromLabel')"
        @focus="onFocus('from', $event)"
        @blur="onBlur"
        @input="onType('from')"
        @keydown="onKeydown"
      />
      <!-- The other way to name a place: point at it. `aria-pressed` carries
           the armed state, since the crosshair cursor cannot. -->
      <Button
        variant="outline"
        size="icon"
        :class="pickClasses('from')"
        :aria-label="pickLabel('from')"
        :title="pickLabel('from')"
        :aria-pressed="planner.picking === 'from'"
        @click="togglePick('from')"
      >
        <Icon :icon="MapPin" />
      </Button>

      <!-- The two marks the map draws at either end, and between them the one
           control that acts on both. Placed by the grid, so it sits between the
           fields in the tab order as well as on screen. -->
      <div :class="$style.rail">
        <i :class="$style.startMark" aria-hidden="true" />
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
        <i :class="$style.endMark" aria-hidden="true" />
      </div>

      <Input
        ref="toInput"
        name="to"
        v-model="queries.to"
        type="search"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="expanded('to')"
        :aria-controls="expanded('to') ? listId : undefined"
        :aria-activedescendant="activeOption('to')"
        :placeholder="locale.t('toLabel')"
        :aria-label="locale.t('toLabel')"
        @focus="onFocus('to', $event)"
        @blur="onBlur"
        @input="onType('to')"
        @keydown="onKeydown"
      />
      <Button
        variant="outline"
        size="icon"
        :class="pickClasses('to')"
        :aria-label="pickLabel('to')"
        :title="pickLabel('to')"
        :aria-pressed="planner.picking === 'to'"
        @click="togglePick('to')"
      >
        <Icon :icon="MapPin" />
      </Button>
    </div>

    <!-- Pressing an option must not blur the field first, or the list is gone
         before the click lands. -->
    <ul
      v-if="options.length"
      :id="listId"
      role="listbox"
      :aria-label="listLabel"
      :class="$style.options"
      @mousedown.prevent
    >
      <li
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.key"
        role="option"
        :aria-selected="index === highlighted"
        :class="optionClasses(index)"
        @click="option.choose()"
        @mousemove="highlighted = index"
      >
        <Icon :icon="option.icon" :size="16" :class="$style.optionIcon" />
        <span :class="$style.optionText">
          <span :class="$style.optionLabel">{{ option.label }}</span>
          <span v-if="option.detail" :class="$style.optionDetail">{{ option.detail }}</span>
        </span>
        <span v-if="option.meta" :class="$style.meta">{{ option.meta }}</span>
      </li>
    </ul>

    <p v-if="status === 'loading'" :class="$style.status">
      <Spinner :size="14" />
      {{ locale.t("loading") }}
    </p>
    <p v-else-if="status === 'failed'" :class="$style.status" @mousedown.prevent>
      {{ locale.t("placesFailed") }}
      <Button variant="ghost" size="sm" @click="places.load()">{{ locale.t("retry") }}</Button>
    </p>
    <p v-else-if="status === 'empty'" :class="$style.status">{{ locale.t("noResults") }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, useCssModule, useId, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ArrowUpDown,
  Banknote,
  BedDouble,
  Building,
  Building2,
  BusFront,
  Car,
  Church,
  Cross,
  GraduationCap,
  History,
  House,
  Landmark,
  LocateFixed,
  MapPin,
  MapPinned,
  ShoppingBag,
  Signpost,
  Trees,
  Utensils,
} from "lucide";
import { Button } from "@surstromming/button";
import { Icon, type IconNode } from "@surstromming/icon";
import { Input } from "@surstromming/input";
import { Spinner } from "@surstromming/spinner";
import { useJourneyFormat } from "@/composables/useJourneyFormat";
import { fold, RESULT_LIMIT, type FoundPlace, type PlaceKind } from "@/places/search";
import { metresBetween } from "@/planner/geo";
import { useLocale } from "@/stores/locale";
import { usePlaces } from "@/stores/places";
import { usePlanner, type Place, type PlaceField } from "@/stores/planner";
import { useProximity } from "@/stores/proximity";
import { useSidebar } from "@/stores/sidebar";
import { useTransit } from "@/stores/transit";

interface Option {
  key: string;
  icon: IconNode;
  label: string;
  detail?: string;
  meta?: string;
  choose: () => void;
}

/** A place's kind at a glance; the name beside it says the rest. */
const KIND_ICONS: Record<PlaceKind, IconNode> = {
  address: House,
  street: Signpost,
  area: MapPinned,
  transport: BusFront,
  food: Utensils,
  shop: ShoppingBag,
  lodging: BedDouble,
  health: Cross,
  education: GraduationCap,
  worship: Church,
  money: Banknote,
  sight: Landmark,
  leisure: Trees,
  office: Building2,
  car: Car,
  building: Building,
};

/** Recents matching what is being typed come first, but never crowd out the search. */
const RECALLED_WHILE_TYPING = 3;

/** Past this a distance is not a hint about which Spar, it is "you are not in Batumi". */
const DISTANCE_WORTH_SHOWING = 30_000;

const locale = useLocale();
const places = usePlaces();
const planner = usePlanner();
const proximity = useProximity();
const sidebar = useSidebar();
const transit = useTransit();
const route = useRoute();
const router = useRouter();
const format = useJourneyFormat();
const $style = useCssModule();

const fromInput = useTemplateRef<{ $el: HTMLInputElement }>("fromInput");
const toInput = useTemplateRef<{ $el: HTMLInputElement }>("toInput");

const listId = useId();

/** What each field shows: the chosen place's name, or what is being typed. */
const queries = reactive<Record<PlaceField, string>>({ from: "", to: "" });
const activeField = ref<PlaceField | null>(null);
const highlighted = ref(0);

const hasAnything = computed(() => !!(planner.from || planner.to || queries.from || queries.to));

const placeLabel = format.place;

// A place chosen anywhere — here, from a stop's sheet, by a tap on the map, by
// a swap — shows up in its field. Typing is never overwritten: a field only
// changes when its place does. The address table arriving counts, because it
// is what names a point tapped on the map.
const syncField = (field: PlaceField) => {
  const place = planner[field];
  if (place) queries[field] = placeLabel(place);
};
watch(
  () => [planner.from, planner.to, locale.locale, transit.stops.length, places.ready] as const,
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
  return text === placeLabel(planner[field]) ? "" : text.trim();
});

const canLocate = typeof navigator !== "undefined" && "geolocation" in navigator;

const distanceTo = (place: FoundPlace) => {
  const fix = proximity.anchor;
  if (!fix) return undefined;
  const metres = metresBetween(fix, place);
  return metres < DISTANCE_WORTH_SHOWING ? format.distance(metres) : undefined;
};

const placeOption = (field: PlaceField, place: FoundPlace, icon: IconNode): Option => ({
  key: place.id,
  icon,
  label: locale.name(place.name),
  detail: place.detail ? locale.name(place.detail) : undefined,
  meta: distanceTo(place),
  choose: () => choose(field, { kind: "place", place }),
});

const recalled = (typed: string) =>
  places.recent.filter((place) => [place.name.ru, place.name.ka, place.name.en].some((name) => fold(name).includes(typed)));

const options = computed<Option[]>(() => {
  const field = activeField.value;
  if (!field) return [];

  // A field with nothing typed offers where the reader is, then where they have
  // been going — which between them are most of the trips anybody plans.
  if (activeQuery.value.length < 2) {
    const list: Option[] = [];
    if (canLocate) {
      list.push({ key: "me", icon: LocateFixed, label: locale.t("followMe"), choose: () => choose(field, { kind: "me" }) });
    }
    return [...list, ...places.recent.map((place) => placeOption(field, place, History))];
  }

  const remembered = recalled(fold(activeQuery.value)).slice(0, RECALLED_WHILE_TYPING);
  const seen = new Set(remembered.map((place) => place.id));
  const found = places.search(activeQuery.value, proximity.anchor).filter((place) => !seen.has(place.id));
  return [
    ...remembered.map((place) => placeOption(field, place, History)),
    ...found.map((place) => placeOption(field, place, KIND_ICONS[place.kind] ?? MapPin)),
  ].slice(0, RESULT_LIMIT);
});

/** Why a search shows nothing: not here yet, not coming, or nothing matched. */
const status = computed<"loading" | "failed" | "empty" | null>(() => {
  if (!activeField.value || activeQuery.value.length < 2) return null;
  if (places.failed) return "failed";
  if (!places.ready) return "loading";
  return options.value.length ? null : "empty";
});

watch(options, () => (highlighted.value = 0));

const listLabel = computed(() => (activeField.value === "to" ? locale.t("toLabel") : locale.t("fromLabel")));
const expanded = (field: PlaceField) => activeField.value === field && options.value.length > 0;
const optionId = (index: number) => `${listId}-${index}`;
const activeOption = (field: PlaceField) => (expanded(field) ? optionId(highlighted.value) : undefined);

const optionClasses = (index: number) => [$style.option, { [$style.isHighlighted]: index === highlighted.value }];

const pickClasses = (field: PlaceField) => ({ [$style.isArmed]: planner.picking === field });
const pickLabel = (field: PlaceField) => locale.t(planner.picking === field ? "chooseOnMapCancel" : "chooseOnMap");

const inputFor = (field: PlaceField) => (field === "from" ? fromInput.value?.$el : toInput.value?.$el);

const onFocus = (field: PlaceField, event: FocusEvent) => {
  activeField.value = field;
  // A field that names a place is edited by replacing it, as an address bar is.
  (event.target as HTMLInputElement | null)?.select();
  // The timetable, the addresses and the permission state are all wanted the
  // moment anyone starts on a trip, and none is worth fetching for a visit
  // that never does.
  void planner.loadTimetable();
  void places.load();
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
  const count = options.value.length;
  if (event.key === "ArrowDown" && count) {
    event.preventDefault();
    highlighted.value = (highlighted.value + 1) % count;
  } else if (event.key === "ArrowUp" && count) {
    event.preventDefault();
    highlighted.value = (highlighted.value - 1 + count) % count;
  } else if (event.key === "Enter" && count) {
    event.preventDefault();
    options.value[highlighted.value]!.choose();
  } else if (event.key === "Escape") {
    (event.target as HTMLInputElement).blur();
  }
};

const showMap = async () => {
  if (route.path !== "/") await router.push("/");
};

const choose = async (field: PlaceField, chosen: Place) => {
  if (chosen.kind === "place") places.remember(chosen.place);
  planner.setPlace(field, chosen);
  inputFor(field)?.blur();

  // Both ends known: the answer is on the map, and on a phone the drawer is
  // covering it.
  if (planner.from && planner.to) {
    await showMap();
    sidebar.closeOnMobile();
    return;
  }

  // One end known. A place found by name is worth seeing straight away — where
  // it is, is the first thing to check about it — but the drawer stays, and the
  // other field takes the cursor, because the trip is only half asked.
  if (chosen.kind === "place") await showMap();
  const other: PlaceField = field === "from" ? "to" : "from";
  await nextTick();
  inputFor(other)?.focus();
};

// The map is only at "/", and on a phone the drawer covers it: arming the pick
// somewhere else has to take the reader to the thing they were just asked to tap.
const togglePick = async (field: PlaceField) => {
  if (planner.picking === field) {
    planner.disarm();
    return;
  }
  // The table is what names the point once it is tapped.
  void places.load();
  planner.arm(field);
  await showMap();
  sidebar.closeOnMobile();
};

const clear = () => {
  planner.clear();
  queries.from = "";
  queries.to = "";
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

// Rail, field, pin — twice. The rail spans both rows, so the swap between the
// two marks sits exactly between the two fields it swaps.
.fields {
  display: grid;
  column-gap: design.spacing(2);
  row-gap: design.spacing(3);
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
  justify-content: space-between;
  grid-column: 1;
  grid-row: 1 / span 2;
  // Each mark on the middle of its field: half a field's height, less half a mark.
  padding: calc((#{design.spacing(9)} - #{design.spacing(2.5)}) / 2) 0;
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

// `Button` has no "active" variant, so the armed look is an app class riding the
// fallthrough attribute — it composes with the button's own module classes
// rather than replacing them. It has to outrank them, not tie with them: the
// outline variant's dark-theme rule carries the theme attribute as well, and a
// bare class lost to it, so the armed pin looked exactly like an idle one in
// the dark. `aria-pressed` is the same fact the class states, and the extra
// selector is what wins in both themes.
.isArmed[aria-pressed="true"] {
  &,
  #{design.$darkThemeSelector} & {
    border-color: design.color(sidebar-ring);
    background-color: design.color(sidebar-accent);
  }
}

.options {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.option {
  display: grid;
  gap: design.spacing(2);
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: design.spacing(2);
  border-radius: design.radius(sm);
  color: design.color(sidebar-foreground);
  cursor: pointer;
}

.isHighlighted {
  background-color: design.color(sidebar-accent);
}

.optionIcon {
  color: design.color(muted-foreground);
}

.optionText {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

// An address ends in its house number, which is the part that tells two rows
// apart — so a long one wraps rather than ellipsing the number away.
.optionLabel {
  font-size: 0.8125rem;
  text-wrap: pretty;
}

.optionDetail {
  overflow: hidden;
  color: design.color(muted-foreground);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  color: design.color(muted-foreground);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.status {
  display: flex;
  gap: design.spacing(2);
  align-items: center;
  padding-left: design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.75rem;
}
</style>
