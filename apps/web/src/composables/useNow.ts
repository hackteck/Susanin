import { onScopeDispose, readonly, ref } from 'vue'

// One timer for the whole app. Every countdown on screen reads the same clock,
// so ten arrival rows tick together instead of drifting a few hundred
// milliseconds apart and re-rendering at ten different moments.
const now = ref(Date.now())
let timer: number | undefined
let subscribers = 0

const tick = () => {
  now.value = Date.now()
}

/**
 * A clock that advances once a second while anything is watching it.
 *
 * Countdowns are driven from this rather than from the poll response, which is
 * the difference between a number that stands still for ten seconds and then
 * jumps, and one that counts.
 */
export function useNow() {
  subscribers++
  if (subscribers === 1) {
    tick()
    timer = window.setInterval(tick, 1000)
    // Coming back to a backgrounded tab, the interval may have been throttled
    // to nothing — re-read the clock rather than counting down from a stale one.
    document.addEventListener('visibilitychange', tick)
  }

  onScopeDispose(() => {
    subscribers--
    if (subscribers === 0) {
      window.clearInterval(timer)
      timer = undefined
      document.removeEventListener('visibilitychange', tick)
    }
  })

  return readonly(now)
}
