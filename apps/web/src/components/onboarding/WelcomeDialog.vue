<template>
  <Dialog
    v-model:open="open"
    :title="locale.t('firstTimeHere')"
    :description="locale.t('firstTimeLead')"
  >
    <template #footer>
      <Button variant="outline" @click="onboarding.answerWelcome">
        {{ locale.t("onMyOwn") }}
      </Button>
      <Button autofocus @click="accept">{{ locale.t("quickTour") }}</Button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@surstromming/button";
import { Dialog } from "@surstromming/dialog";
import { useLocale } from "@/stores/locale";
import { useOnboarding } from "@/stores/onboarding";

const onboarding = useOnboarding();
const locale = useLocale();
const route = useRoute();

/**
 * Offered on the map and nowhere else. A first visit almost always lands there,
 * and the one that does not — a scanned code that opens a stop — has a reason
 * for being on that page; a modal over it answers a question nobody asked. The
 * offer is not lost either way, since it waits for the map, unanswered.
 */
const open = computed({
  get: () => !onboarding.welcomeSeen && route.path === "/",
  // The ✕, Escape and a click outside all mean the same as the second button.
  set: (value) => {
    if (!value) onboarding.answerWelcome();
  },
});

// The ring on the menu button belongs to the same first visit, and holds off
// until this has been answered. Told rather than worked out, because the route
// is the one thing the store cannot see.
watch(open, (value) => (onboarding.welcomeOpen = value), { immediate: true });

const accept = () => {
  onboarding.answerWelcome();
  onboarding.startTour();
};
</script>
