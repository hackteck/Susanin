<template>
  <ScrollArea as="main">
    <div :class="$style.page">
      <header :class="$style.head">
        <h1 :class="$style.title">{{ locale.t("shareTitle") }}</h1>
        <p :class="$style.subtitle">{{ locale.t("shareLead") }}</p>
      </header>

      <figure :class="$style.card">
        <!-- The markup is ours, made at build time from SITE_URL by
             vite.site.ts — never anything a reader or the feed supplied. -->
        <div :class="$style.code" role="img" :aria-label="locale.t('qrAlt')" v-html="qrSvg" />
        <figcaption ref="address" :class="$style.address">{{ displayUrl }}</figcaption>
      </figure>

      <div :class="$style.actions">
        <!-- The system's own share sheet where there is one: it knows which
             messengers are on this phone, and we never could. -->
        <Button v-if="canShare" @click="shareNative">
          <Icon :icon="Share2" />
          {{ locale.t("shareVia") }}
        </Button>
        <Button :variant="copyVariant" @click="copy">
          <Icon :icon="copyIcon" />
          {{ locale.t("copyLink") }}
        </Button>
        <Button variant="ghost" @click="download">
          <Icon :icon="Download" />
          {{ locale.t("downloadQr") }}
        </Button>
      </div>

      <p :class="$style.hint">{{ locale.t("printHint") }}</p>
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, useTemplateRef } from "vue";
import { Check, Copy, Download, Share2 } from "lucide";
import { qrSvg, siteUrl } from "virtual:site";
import { Button } from "@surstromming/button";
import { Icon } from "@surstromming/icon";
import { ScrollArea } from "@surstromming/scroll-area";
import { useLocale } from "@/stores/locale";
import { useToasts } from "@/stores/toasts";

const locale = useLocale();
const toasts = useToasts();
const address = useTemplateRef<HTMLElement>("address");

/** What a person reads and retypes: no scheme, no trailing slash. */
const displayUrl = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

const shareData = computed<ShareData>(() => ({
  title: locale.t("appName"),
  text: locale.t("tagline"),
  url: siteUrl,
}));

// Absent on desktop Firefox and inside Android's WebView — which is the
// packaged app — and present but picky elsewhere, so both halves are asked.
const canShare =
  typeof navigator.share === "function" && (navigator.canShare?.({ url: siteUrl }) ?? true);

const copied = ref(false);
let copiedTimer: number | undefined;
onScopeDispose(() => window.clearTimeout(copiedTimer));

const copyIcon = computed(() => (copied.value ? Check : Copy));
// The primary action is whichever this browser can actually do best.
const copyVariant = computed(() => (canShare ? "outline" : "primary"));

// If the clipboard refuses — an insecure origin, a denied permission — the
// address is selected instead, so a long-press copy is one gesture away.
const selectAddress = () => {
  const element = address.value;
  const selection = window.getSelection();
  if (!element || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
};

const copy = async () => {
  try {
    await navigator.clipboard.writeText(siteUrl);
    copied.value = true;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copied.value = false), 2000);
    toasts.push({ title: locale.t("linkCopied"), duration: 3000 });
  } catch {
    selectAddress();
    // An error toast stays until it is read — surstromming's own rule.
    toasts.push({ title: locale.t("copyFailed"), variant: "destructive", duration: 0 });
  }
};

const shareNative = async () => {
  try {
    await navigator.share(shareData.value);
  } catch (error) {
    // Closing the sheet is an answer, not a failure. Anything else — a sheet
    // already open, data the platform will not take — still leaves the reader
    // wanting the link, so they get it the other way.
    if ((error as Error).name === "AbortError") return;
    await copy();
  }
};

/**
 * A PNG, drawn from the same SVG, because that is what a phone's gallery, a
 * messenger and a print shop all take. Scaled by a whole number of pixels per
 * module: a fractional scale smears module edges, and a smeared edge is exactly
 * what makes a printed code fail to scan.
 */
const download = async () => {
  const modules = Number(/viewBox="0 0 (\d+)/.exec(qrSvg)?.[1] ?? 37);
  const scale = Math.ceil(1024 / modules);
  const source = URL.createObjectURL(new Blob([qrSvg], { type: "image/svg+xml" }));

  try {
    const image = new Image();
    image.src = source;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = modules * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(png);
    link.download = "susanin-qr.png";
    link.click();
    // The click has handed the file to the browser; the URL is not needed after.
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } finally {
    URL.revokeObjectURL(source);
  }
};
</script>

<style module lang="scss">
@use "@surstromming/design" as design;

.page {
  display: flex;
  flex-direction: column;
  gap: design.spacing(6);
  align-items: center;
  max-width: design.spacing(120);
  margin: 0 auto;
  padding: design.spacing(6) design.spacing(4);
  text-align: center;
}

.head {
  display: flex;
  flex-direction: column;
  gap: design.spacing(2);
}

.title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.subtitle,
.hint {
  color: design.color(muted-foreground);
  font-size: 0.875rem;
  text-wrap: balance;
}

.hint {
  font-size: 0.75rem;
}

.card {
  display: flex;
  flex-direction: column;
  gap: design.spacing(3);
  align-items: center;
  margin: 0;
  padding: design.spacing(4);
  border: 1px solid design.color(border);
  border-radius: design.radius(lg);
  background-color: design.color(card);
  box-shadow: design.shadow(sm);
}

// The code brings its own white and its own quiet zone, in both themes; the
// card only frames it. Square, and as large as a phone screen comfortably
// allows, because a code is read from across a counter as often as up close.
.code {
  width: min(72vw, design.spacing(72));
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: design.radius(md);

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
}

.address {
  color: design.color(card-foreground);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  // A long-press copies the whole address, never half a word of it.
  user-select: all;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: design.spacing(2);
  justify-content: center;
}
</style>
