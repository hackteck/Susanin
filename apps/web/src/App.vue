<template>
  <AppHeader />

  <!-- Each page brings its own sidebar via the `sidebar` named view -->
  <RouterView name="sidebar" v-slot="{ Component, route: sidebarRoute }">
    <KeepAlive>
      <component :is="Component" :key="sidebarRoute.name" />
    </KeepAlive>
  </RouterView>

  <AppError v-if="failure" :status="failure.status" @retry="retry" />

  <RouterView v-else v-slot="{ Component }">
    <Suspense v-if="Component" :timeout="0">
      <component :is="Component" :key="attempt" />
      <template #fallback>
        <PageLoader />
      </template>
    </Suspense>
  </RouterView>

  <!-- The first visit: the offer, and the tour it can lead to. Both live here
       because the tour rings the header, the sidebar and the map in turn. -->
  <WelcomeDialog />
  <TourSpotlight />

  <!-- Teleported to <body>; one for the whole app -->
  <Toaster :toasts="toasts.items" @dismiss="toasts.dismiss" />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import { Toaster } from "@surstromming/toast";
import AppError from "@/components/AppError.vue";
import AppHeader from "@/components/AppHeader.vue";
import PageLoader from "@/components/PageLoader.vue";
import TourSpotlight from "@/components/onboarding/TourSpotlight.vue";
import WelcomeDialog from "@/components/onboarding/WelcomeDialog.vue";
import { ApiError } from "@/api/client";
import { useToasts } from "@/stores/toasts";

const toasts = useToasts();
const route = useRoute();

/**
 * An object rather than a bare status code, because the status of a failed
 * *fetch* is not a number at all — and `0` is falsy, so a `v-if` on the code
 * itself skipped the error page for exactly the case that matters most: being
 * offline. That left a blank screen where the message was supposed to be.
 */
const failure = ref<{ status: number | null } | null>(null);
/** Bumped to remount the page, which is what re-runs its async setup. */
const attempt = ref(0);

// Every page loads its data in a top-level `await`, so a rejection lands in
// <Suspense> — which has no error slot of its own and would otherwise leave the
// fallback spinner up for ever. Measured: /stops/<bad-id> spun indefinitely
// with no message and nothing to press.
onErrorCaptured((error) => {
  failure.value = { status: error instanceof ApiError ? error.status : null };
  // Handled here; don't also let it reach the console as an unhandled error.
  return false;
});

const retry = () => {
  failure.value = null;
  attempt.value++;
};

// A dead link should not poison the next page the reader navigates to.
watch(() => route.fullPath, () => (failure.value = null));
</script>

<style lang="scss">
@use "@surstromming/design" as design;
@include design.layout($sidebarInset: true);
</style>
