<template>
  <AnchoredCallout
    :rect="rect"
    :title="locale.t('menu')"
    :body="locale.t('menuHint')"
    layer="popover"
  >
    <Button variant="ghost" size="sm" @click="onboarding.dismissHint">
      {{ locale.t("close") }}
    </Button>
  </AnchoredCallout>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@surstromming/button";
import AnchoredCallout from "@/components/onboarding/AnchoredCallout.vue";
import { useAnchorRect } from "@/composables/useAnchorRect";
import { useLocale } from "@/stores/locale";
import { useOnboarding } from "@/stores/onboarding";

const onboarding = useOnboarding();
const locale = useLocale();
const route = useRoute();

/**
 * Dropping the anchor is what stops the measuring, so this is the on/off switch
 * for the whole thing, not just for what is drawn.
 *
 * The map only. A bubble under the header covers the top of whatever is behind
 * it, and on every other page that is the heading someone came to read — on the
 * About page it sat squarely over the page's own title. The ring on the button
 * carries on everywhere; only the sentence beside it waits for a page with
 * nothing to cover.
 */
const anchor = computed(() => (onboarding.hintMenu && route.path === "/" ? "menu" : null));
const { rect } = useAnchorRect(anchor);
</script>
