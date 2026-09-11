import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@surstromming/design/font-list.scss'
// Georgian glyphs Geist doesn't carry; --font-sans in globals.css puts it after
// Geist so Latin is unaffected.
import '@fontsource-variable/noto-sans-georgian'
import '@surstromming/design/reset.scss'
import { router } from './router'
import { initTheme } from './composables/useTheme'
import App from './App.vue'

// Apply the persisted theme to <html> before the first paint.
initTheme()

// A deploy replaces every hashed chunk and removes the old deployment, so a tab
// that was open across it asks for files that no longer exist the next time it
// navigates somewhere new — and got the "feed is not answering" screen, with a
// Retry that could not succeed. Vite reports the failed import here; a reload
// fetches the new index and the chunks it names. At most once per half-minute,
// so a chunk that is genuinely gone shows the error page instead of reloading
// for ever.
const RELOAD_KEY = 'chunk-reload'
const RELOAD_EVERY_MS = 30_000

const lastReload = () => {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY)) || 0
  } catch {
    return 0
  }
}

window.addEventListener('vite:preloadError', (event) => {
  if (Date.now() - lastReload() < RELOAD_EVERY_MS) return
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    // Storage disabled: one reload is still the right call.
  }
  event.preventDefault()
  location.reload()
})

createApp(App)
    .use(createPinia())
    .use(router)
    .mount('#app')
