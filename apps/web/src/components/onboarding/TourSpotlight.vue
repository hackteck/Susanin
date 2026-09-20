<template>
  <template v-if="current">
    <Teleport to="body">
      <!-- Blocks the page while the tour has the floor. A tap that reached the
           map behind the ring would pan the very thing being pointed at. -->
      <div :class="$style.scrim" />
      <div v-if="shown" :class="$style.ring" :style="ringStyle" />
    </Teleport>

    <AnchoredCallout
      :rect="rect"
      :title="locale.t(current.title)"
      :body="locale.t(current.body)"
      :progress="progress"
      layer="modal"
    >
      <Button variant="ghost" size="sm" @click="onboarding.endTour">
        {{ locale.t("tourSkip") }}
      </Button>
      <Button size="sm" @click="onboarding.advance">{{ locale.t(nextLabel) }}</Button>
    </AnchoredCallout>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@surstromming/button";
import AnchoredCallout from "@/components/onboarding/AnchoredCallout.vue";
import { useAnchorRect, type AnchorRect } from "@/composables/useAnchorRect";
import { useLocale } from "@/stores/locale";
import { useOnboarding } from "@/stores/onboarding";

/** How far outside the target the ring sits, so it frames rather than covers. */
const RING_PAD = 4;

const onboarding = useOnboarding();
const locale = useLocale();
const route = useRoute();

const current = computed(() => onboarding.currentStep);
const anchor = computed(() => current.value?.anchor ?? null);
const { rect, missing } = useAnchorRect(anchor);

/**
 * The last target the ring actually had. Measuring restarts from nothing on
 * every step, and the ring is kept on the old target through that gap so it
 * glides to the next one instead of blinking out and back.
 */
const shown = ref<AnchorRect | null>(null);

watch(rect, (value) => {
  if (value) shown.value = value;
});

watch(
  () => onboarding.running,
  (running) => {
    if (!running) shown.value = null;
  },
);

// A target that never turned up is skipped, not rung in the top-left corner.
watch(missing, (gone) => {
  if (gone) onboarding.advance();
});

const nextLabel = computed(() => (onboarding.onLastStep ? "tourFinish" : "tourNext"));

// Numerals through Intl, like every other number the app shows.
const numbers = computed(() => new Intl.NumberFormat(locale.locale));
const progress = computed(() =>
  onboarding.step === null
    ? undefined
    : `${numbers.value.format(onboarding.step + 1)}/${numbers.value.format(onboarding.stepCount)}`,
);

const ringStyle = computed(() => {
  const value = shown.value;
  if (!value) return undefined;
  return {
    transform: `translate3d(${Math.round(value.left - RING_PAD)}px, ${Math.round(value.top - RING_PAD)}px, 0)`,
    width: `${Math.round(value.width + RING_PAD * 2)}px`,
    height: `${Math.round(value.height + RING_PAD * 2)}px`,
  };
});

// The last stop is a control on the map page, so leaving the page ends the tour
// rather than leaving a ring over whatever arrived instead.
watch(
  () => route.path,
  (path) => {
    if (onboarding.running && path !== "/") onboarding.endTour();
  },
);

// Escape is the way out of anything that covers the page.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && onboarding.running) onboarding.endTour();
};

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<style module lang="scss">
@use "@surstromming/design" as design;
@use "../../styles/motion" as motion;

// Both paint one rung under the callout, which is the ladder's own convention
// for a layered overlay — see $z-layers in zIndexes.scss.
.scrim {
  position: fixed;
  inset: 0;
  z-index: calc(#{design.z-index(modal)} - 1);
}

.ring {
  position: fixed;
  top: 0;
  left: 0;
  z-index: calc(#{design.z-index(modal)} - 1);
  border-radius: design.radius(md);
  // One element does both jobs: the ring, then a spread wide enough to dim
  // everything outside it. Four boxes around a hole would show their seams, and
  // a scrim that dimmed the target too is not a spotlight.
  //
  // The tint is a fixed neutral rather than a token, for the reason
  // @surstromming/backdrop gives: a scrim that changed colour with the theme
  // would stop reading as "the lights went down". There is no blur to go with
  // it — a box-shadow cannot blur what is behind it — and none is needed, since
  // the ring, not a difference in surface, is what separates here.
  box-shadow:
    0 0 0 2px design.color(primary),
    0 0 0 100vmax color-mix(in oklab, black 55%, transparent);
  // The scrim underneath is the click target; the ring itself is not in the way.
  pointer-events: none;
  transition:
    transform motion.$standard motion.$ease-enter,
    width motion.$standard motion.$ease-enter,
    height motion.$standard motion.$ease-enter;
}

@include motion.reduced {
  .ring {
    transition: none;
  }
}
</style>
