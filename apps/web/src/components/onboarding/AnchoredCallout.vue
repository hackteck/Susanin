<template>
  <Teleport to="body">
    <div v-if="rect" ref="root" :class="classes" :style="style" role="status" aria-live="polite">
      <div :class="$style.head">
        <strong :class="$style.title">{{ title }}</strong>
        <span v-if="progress" :class="$style.progress">{{ progress }}</span>
      </div>

      <p :class="$style.body">{{ body }}</p>

      <div :class="$style.actions">
        <slot />
      </div>

      <i :class="$style.arrow" :style="arrowStyle" aria-hidden="true" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useCssModule, useTemplateRef, watch } from "vue";
import type { AnchorRect } from "@/composables/useAnchorRect";

const props = withDefaults(
  defineProps<{
    /** Where the thing being talked about is. Nothing renders without one. */
    rect: AnchorRect | null;
    title: string;
    body: string;
    /** Position in a sequence, already formatted. Omitted for a lone callout. */
    progress?: string;
    layer?: "popover" | "modal";
  }>(),
  { layer: "popover" },
);

// Arithmetic, not design values: the gap to the target, the keep-out at the
// edges of the screen, and how far the arrow's point stays from a corner. The
// kit's own anchored panels clamp to the same 8px margin.
const GAP = 8;
const MARGIN = 8;
const ARROW_INSET = 16;

const root = useTemplateRef<HTMLElement>("root");
const size = ref({ width: 0, height: 0 });
const viewport = ref({ width: 0, height: 0 });

// Measured rather than assumed: the body is three languages long, and whether
// the callout goes above or below turns on its height.
let observer: ResizeObserver | null = null;

watch(root, (element) => {
  observer?.disconnect();
  observer = null;
  if (!element) {
    size.value = { width: 0, height: 0 };
    return;
  }
  observer = new ResizeObserver(() => {
    size.value = { width: element.offsetWidth, height: element.offsetHeight };
  });
  observer.observe(element);
});

const readViewport = () => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
};

onMounted(() => {
  readViewport();
  window.addEventListener("resize", readViewport);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", readViewport);
});

const placement = computed(() => {
  const rect = props.rect;
  if (!rect || !size.value.height || !viewport.value.height) return null;

  const below = rect.top + rect.height + GAP;
  const above = rect.top - GAP - size.value.height;
  // Below, unless that runs off the bottom and there is really room above.
  const goAbove = below + size.value.height + MARGIN > viewport.value.height && above >= MARGIN;

  const centred = rect.left + rect.width / 2 - size.value.width / 2;
  const rightmost = Math.max(MARGIN, viewport.value.width - size.value.width - MARGIN);
  const left = Math.min(Math.max(centred, MARGIN), rightmost);

  // The box slides to stay on screen; the arrow stays on the target, which is
  // the whole reason it is there — a ringed button near the left edge would
  // otherwise get a bubble pointing at the middle of the screen.
  const point = rect.left + rect.width / 2 - left;
  const furthest = Math.max(ARROW_INSET, size.value.width - ARROW_INSET);
  const arrow = Math.min(Math.max(point, ARROW_INSET), furthest);

  return { top: goAbove ? above : below, left, above: goAbove, arrow };
});

// Moved by `transform` from the origin rather than by `top`/`left`, the way the
// kit's own anchored panels are — an inset offset doubles as the room a
// shrink-to-fit box can grow into, and the two chase each other a frame apart.
const style = computed(() => {
  const place = placement.value;
  return {
    transform: place ? `translate3d(${Math.round(place.left)}px, ${Math.round(place.top)}px, 0)` : undefined,
    // Rendered so it can be measured, shown once it has been. Without this
    // there is one frame of it sitting in the top-left corner.
    visibility: place ? undefined : ("hidden" as const),
  };
});

const arrowStyle = computed(() => ({
  left: placement.value ? `${Math.round(placement.value.arrow)}px` : undefined,
}));

const $style = useCssModule();
const classes = computed(() => [
  $style.root,
  $style[`layer-${props.layer}`],
  { [$style.isAbove]: placement.value?.above },
]);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  position: fixed;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
  width: design.spacing(84);
  max-width: calc(100vw - #{design.spacing(8)});
  border: 1px solid design.color(border);
  border-radius: design.radius(md);
  // `popover`, not `background`: in dark mode they differ, and a panel painted
  // in the page's own colour has nothing to stand out against.
  background-color: design.color(popover);
  padding: design.spacing(3) design.spacing(4);
  color: design.color(popover-foreground);
  box-shadow: design.shadow(md);
  // Deliberately still: it moves between steps by appearing in the new place,
  // never by gliding there. A bubble that flies across the screen is the
  // "contents swap without animating" rule in _motion.scss, one panel over.
}

.layer-popover {
  z-index: design.z-index(popover);
}

// One rung above the tour's own scrim, which paints at `modal - 1`.
.layer-modal {
  z-index: design.z-index(modal);
}

.head {
  display: flex;
  gap: design.spacing(3);
  align-items: baseline;
}

.title {
  font-size: 0.9375rem;
  font-weight: 600;
}

.progress {
  margin-left: auto;
  color: design.color(muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.body {
  color: design.color(muted-foreground);
  font-size: 0.875rem;
  line-height: 1.5;
}

.actions {
  display: flex;
  gap: design.spacing(2);
  justify-content: flex-end;
}

// A rotated square whose two outer edges keep the border, so the panel's own
// border opens for it and the fill hides the seam behind.
.arrow {
  position: absolute;
  top: calc(-1 * design.spacing(1.25));
  width: design.spacing(2.5);
  height: design.spacing(2.5);
  background-color: design.color(popover);
  border-top: 1px solid design.color(border);
  border-left: 1px solid design.color(border);
  transform: translateX(-50%) rotate(45deg);
}

.isAbove .arrow {
  top: auto;
  bottom: calc(-1 * design.spacing(1.25));
  border-top: none;
  border-left: none;
  border-right: 1px solid design.color(border);
  border-bottom: 1px solid design.color(border);
}
</style>
