import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

// Catch-all — must stay last in `routes`.
export const notFoundRoute: RouteRecordRaw = {
  path: '/:pathMatch(.*)*',
  name: 'not-found',
  components: {
    default: lazyPage(() => import('./NotFoundPage.vue')),
    sidebar: AppSidebar,
  },
}
