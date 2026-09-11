<template>
  <Header>
    <Button variant="ghost" size="icon" :aria-label="locale.t('toggleSidebar')" @click="sidebar.toggle">
      <Icon :icon="PanelLeft" />
    </Button>

    <RouterLink to="/" :class="$style.brand">
      <Icon :icon="BusFront" :size="20" />
      <span :class="$style.name">{{ locale.t("appName") }}</span>
    </RouterLink>

    <div :class="$style.actions">
      <span v-if="transit.watching" :class="$style.status">
        <i :class="statusClasses" />
        {{ locale.plural(transit.runningVehicles.length, "buses") }} {{ locale.t("onTheRoad") }}
      </span>

      <LocaleMenu />

      <Button variant="ghost" size="icon" :aria-label="locale.t('toggleTheme')" @click="toggleTheme">
        <Icon :icon="themeIcon" />
      </Button>
    </div>
  </Header>
</template>

<script setup lang="ts">
import { computed, useCssModule } from "vue";
import { RouterLink } from "vue-router";
import { BusFront, Moon, PanelLeft, Sun } from "lucide";
import { Button } from "@surstromming/button";
import { Header } from "@surstromming/header";
import { Icon } from "@surstromming/icon";
import LocaleMenu from "@/components/LocaleMenu.vue";
import { useSidebar } from "@/stores/sidebar";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";
import { useTheme } from "@/composables/useTheme";

const sidebar = useSidebar();
const locale = useLocale();
const transit = useTransit();
const { theme, toggle: toggleTheme } = useTheme();

const $style = useCssModule();

const themeIcon = computed(() => (theme.value === "dark" ? Sun : Moon));

// The dot is the only thing on screen that says the feed is still answering.
const statusClasses = computed(() => [$style.dot, { [$style.isLive]: transit.runningVehicles.length > 0 }]);
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.brand {
  display: flex;
  gap: design.spacing(2);
  align-items: center;
  color: design.color(foreground);
  text-decoration: none;
}

.name {
  font-weight: 600;
}

.actions {
  display: flex;
  gap: design.spacing(1);
  align-items: center;
  margin-left: auto;
}

.status {
  display: none;
  gap: design.spacing(2);
  align-items: center;
  margin-right: design.spacing(2);
  color: design.color(muted-foreground);
  font-size: 0.8125rem;

  // The count is context, not navigation — it goes when the bar gets tight.
  @include design.screen(sm) {
    display: flex;
  }
}

.dot {
  width: design.spacing(2);
  height: design.spacing(2);
  border-radius: 50%;
  background-color: design.color(muted-foreground);
}

.isLive {
  // The green of the categorical set, so "live" reads as a data state rather
  // than as a colour invented for this one dot.
  background-color: design.color(chart-2);
}

</style>
