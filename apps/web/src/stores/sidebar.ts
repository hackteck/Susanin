import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { isMobile } from '@surstromming/util'

// App-wide: the trigger (header) and the panel (per-page sidebar view)
// live in distant subtrees.
export const useSidebar = defineStore('sidebar', () => {
  const open = ref(!isMobile.value)

  // Crossing the breakpoint restores the mode's default:
  // desktop panel shown, mobile drawer hidden.
  watch(isMobile, (mobile) => open.value = !mobile)

  const toggle = () => open.value = !open.value

  return { open, toggle }
})
