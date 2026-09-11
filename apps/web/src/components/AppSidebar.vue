<template>
  <Sidebar v-model:open="sidebar.open">
    <SidebarGroup :items="navItems" @select="navigate" />
    <Separator />
    <StopSearch />
    <Separator />
    <RouteFilter />
  </Sidebar>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { BusFront, Info, Map, Navigation } from "lucide";
import { Separator } from "@surstromming/separator";
import { Sidebar } from "@surstromming/sidebar";
import { SidebarGroup, type SidebarGroupItem } from "@surstromming/sidebar-group";
import RouteFilter from "@/components/RouteFilter.vue";
import StopSearch from "@/components/StopSearch.vue";
import { useSidebar } from "@/stores/sidebar";
import { useLocale } from "@/stores/locale";
import { useTransit } from "@/stores/transit";
import { go } from "@/router";

const sidebar = useSidebar();

// Navigating from the drawer has to close it: on a phone the page it just
// opened is behind the backdrop otherwise.
const navigate = (value: string) => {
  go(value);
  sidebar.closeOnMobile();
};
const locale = useLocale();
const route = useRoute();

// The sidebar is shared by every page, including the ones that never load the
// network for themselves — without this the route filter and the stop search
// are both empty on those. Not awaited: they can appear a moment after the nav.
// A failure here is the page's to report, not the sidebar's: it just stays
// empty, and the rejection is not left to reach the console unhandled.
void useTransit()
  .loadNetwork()
  .catch(() => {});

// Values are route paths, so `go` navigates and `active` follows the URL.
const navItems = computed<SidebarGroupItem[]>(() => [
  { label: locale.t("map"), value: "/", href: "/", icon: Map, active: route.path === "/" },
  {
    label: locale.t("nearMe"),
    value: "/nearby",
    href: "/nearby",
    icon: Navigation,
    active: route.path === "/nearby",
  },
  {
    label: locale.t("routes"),
    value: "/routes",
    href: "/routes",
    icon: BusFront,
    active: route.path.startsWith("/routes"),
  },
  { label: locale.t("about"), value: "/about", href: "/about", icon: Info, active: route.path === "/about" },
]);
</script>
