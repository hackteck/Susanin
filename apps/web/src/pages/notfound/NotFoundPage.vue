<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <Icon :icon="Compass" :size="40" :class="$style.icon" />
      <h1 :class="$style.title">{{ locale.t("notFound") }}</h1>
      <Button as="a" href="/">{{ locale.t("backToMap") }}</Button>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { Compass } from "lucide";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { useLocale } from "@/stores/locale";

const locale = useLocale();
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(4);
  align-items: center;
  justify-content: center;
  min-height: 60%;
  padding: design.spacing(10) design.spacing(4);
  text-align: center;
}

.icon {
  color: design.color(muted-foreground);
}

.title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
</style>
