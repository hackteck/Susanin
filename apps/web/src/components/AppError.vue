<template>
  <main :class="$style.root">
    <Icon :icon="icon" :size="40" :class="$style.icon" />
    <h1 :class="$style.title">{{ title }}</h1>
    <p v-if="detail" :class="$style.detail">{{ detail }}</p>

    <div :class="$style.actions">
      <Button v-if="!isMissing" @click="emit('retry')">{{ locale.t("retry") }}</Button>
      <Button variant="outline" as="a" href="/">{{ locale.t("backToMap") }}</Button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Compass, CloudOff } from "lucide";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { useLocale } from "@/stores/locale";

const props = defineProps<{ status: number | null }>();
const emit = defineEmits<{ retry: [] }>();

const locale = useLocale();

// A stop that does not exist and a feed that is not answering are different
// problems: one is a dead link the reader followed, the other is worth waiting
// out. Only the second is worth offering a retry for.
const isMissing = computed(() => props.status === 404);

const icon = computed(() => (isMissing.value ? Compass : CloudOff));
const title = computed(() => locale.t(isMissing.value ? "notFound" : "loadFailed"));
const detail = computed(() => (isMissing.value ? "" : locale.t("loadFailedDetail")));
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.root {
  display: flex;
  flex-direction: column;
  gap: design.spacing(4);
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 0;
  padding: design.spacing(10) design.spacing(4);
  text-align: center;
  text-wrap: balance;
}

.icon {
  color: design.color(muted-foreground);
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.detail {
  max-width: design.spacing(110);
  color: design.color(muted-foreground);
  font-size: 0.875rem;
  line-height: 1.5;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(2);
  justify-content: center;
}
</style>
