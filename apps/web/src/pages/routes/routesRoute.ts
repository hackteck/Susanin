import type { RouteRecordRaw } from 'vue-router'
import { lazyPage } from '@/router/lazyPage'
import AppSidebar from '@/components/AppSidebar.vue'

export const routesRoute: RouteRecordRaw = {
  path: '/routes',
  name: 'routes',
  components: {
    default: lazyPage(() => import('./RoutesPage.vue')),
    sidebar: AppSidebar,
  },
}

export const routeDetailRoute: RouteRecordRaw = {
  path: '/routes/:id',
  name: 'route-detail',
  components: {
    default: lazyPage(() => import('./RouteDetailPage.vue')),
    sidebar: AppSidebar,
  },
}
