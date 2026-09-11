import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

export const nearbyRoute: RouteRecordRaw = {
  path: '/nearby',
  name: 'nearby',
  components: {
    default: lazyPage(() => import('./NearbyPage.vue')),
    sidebar: AppSidebar,
  },
}
