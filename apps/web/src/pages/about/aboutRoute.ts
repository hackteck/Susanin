import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

export const aboutRoute: RouteRecordRaw = {
  path: '/about',
  name: 'about',
  components: {
    default: lazyPage(() => import('./AboutPage.vue')),
    sidebar: AppSidebar,
  },
}
