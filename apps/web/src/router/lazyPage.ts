import { defineAsyncComponent, h, type AsyncComponentLoader, type Component } from 'vue'

// Lazy-load a page *inside* <Suspense> instead of via the router.
export function lazyPage(loader: AsyncComponentLoader): Component {
  const page = defineAsyncComponent(loader)
  return { render: () => h(page) }
}
