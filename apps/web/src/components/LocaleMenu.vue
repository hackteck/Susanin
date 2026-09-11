<template>
  <DropdownMenu :items="items" align="end" @select="choose">
    <template #trigger="{ toggle }">
      <Button variant="ghost" size="icon" :aria-label="locale.t('language')" @click="toggle">
        <span :class="$style.code">{{ localeShort[locale.locale] }}</span>
      </Button>
    </template>
  </DropdownMenu>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Check } from "lucide";
import { Button } from "@surstromming/button";
import { DropdownMenu, type DropdownMenuItem } from "@surstromming/dropdown-menu";
import { localeNames, localeShort, locales, type Locale } from "@/i18n/messages";
import { useLocale } from "@/stores/locale";

const locale = useLocale();

// Each language is named in its own script — someone looking for Georgian is
// not looking for the word "Georgian".
const items = computed<DropdownMenuItem[]>(() =>
  locales.map((value) => ({
    label: localeNames[value],
    value,
    icon: value === locale.locale ? Check : undefined,
  })),
);

const choose = (value: string) => locale.setLocale(value as Locale);
</script>

<style module lang="scss">
.code {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
