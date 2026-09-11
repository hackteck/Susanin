<template>
  <span :class="classes" :style="{ '--hue': hue }">{{ shortName }}</span>
</template>

<script setup lang="ts">
import { computed, useCssModule } from "vue";

const props = withDefaults(defineProps<{ shortName: string; hue: number; size?: "sm" | "md" }>(), {
  size: "md",
});

const $style = useCssModule();
const classes = computed(() => [$style.root, $style[`size-${props.size}`]]);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: design.radius(sm);
  background-color: oklch(var(--route-l) var(--route-c) var(--hue));
  color: var(--route-label);
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.size-sm {
  min-width: design.spacing(7);
  height: design.spacing(5);
  padding: 0 design.spacing(1.5);
  font-size: 0.6875rem;
}

.size-md {
  min-width: design.spacing(9);
  height: design.spacing(7);
  padding: 0 design.spacing(2);
  font-size: 0.8125rem;
}
</style>
