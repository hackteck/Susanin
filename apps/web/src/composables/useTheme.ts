import { readonly, ref } from 'vue'

export type Theme = 'light' | 'dark'

const storageKey = 'theme'
const theme = ref<Theme>('light')

const apply = (value: Theme) => {
  theme.value = value
  document.documentElement.dataset.theme = value
}

// The persisted choice wins; without one, follow the system.
export function initTheme() {
  const stored = localStorage.getItem(storageKey)
  if (stored === 'light' || stored === 'dark') {
    apply(stored)
    return
  }
  apply(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

export function useTheme() {
  const setTheme = (value: Theme) => {
    apply(value)
    localStorage.setItem(storageKey, value)
  }

  const toggle = () => setTheme(theme.value === 'dark' ? 'light' : 'dark')

  return { theme: readonly(theme), setTheme, toggle }
}
