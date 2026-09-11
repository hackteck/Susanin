import { createRouter, createWebHistory } from 'vue-router'
import { mapRoute } from '@/pages/map/mapRoute'
import { routesRoute, routeDetailRoute } from '@/pages/routes/routesRoute'
import { stopRoute } from '@/pages/stops/stopRoute'
import { nearbyRoute } from '@/pages/nearby/nearbyRoute'
import { aboutRoute } from '@/pages/about/aboutRoute'
import { notFoundRoute } from '@/pages/notfound/notFoundRoute'

// Order here is the order pages appear in the sidebar.
export const routes = [mapRoute, nearbyRoute, routesRoute, routeDetailRoute, stopRoute, aboutRoute, notFoundRoute]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

// Shared select handler for nav components: a value that resolves to a route
// navigates, anything else just logs (the router's dev warn flags a typo'd
// path on its own).
export const go = (value: string) => {
  // The catch-all matches anything, so a real route is one that isn't it.
  if (router.resolve(value).name !== notFoundRoute.name) void router.push(value)
  else console.log('select', value)
}
