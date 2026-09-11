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

createApp(App)
    .use(createPinia())
    .use(router)
    .mount('#app')
