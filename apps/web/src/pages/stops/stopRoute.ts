import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

export const stopRoute: RouteRecordRaw = {
  path: '/stops/:id',
  name: 'stop',
  components: {
    default: lazyPage(() => import('./StopPage.vue')),
    sidebar: AppSidebar,
  },
}
