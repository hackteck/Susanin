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

  /**
   * Put the drawer away after doing something that moves the reader elsewhere.
   * On a phone the sidebar is a drawer over a backdrop, so navigating without
   * this leaves the page it just opened behind an overlay — the only thing still
   * visible being the sidebar that was supposed to be finished with. On desktop
   * it is a permanent panel and closing it would be a second change nobody asked
   * for, which is why this is not just `open.value = false`.
   */
  const closeOnMobile = () => {
    if (isMobile.value) open.value = false
  }

  return { open, toggle, closeOnMobile }
})
