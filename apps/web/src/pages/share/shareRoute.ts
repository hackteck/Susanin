import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

export const shareRoute: RouteRecordRaw = {
  path: '/share',
  name: 'share',
  components: {
    default: lazyPage(() => import('./SharePage.vue')),
    sidebar: AppSidebar,
  },
}
