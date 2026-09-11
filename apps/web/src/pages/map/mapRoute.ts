import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

// The app's index: the live map.
export const mapRoute: RouteRecordRaw = {
  path: '/',
  name: 'map',
  components: {
    default: lazyPage(() => import('./MapPage.vue')),
    sidebar: AppSidebar,
  },
}
