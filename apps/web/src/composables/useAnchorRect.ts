import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/** Where a tour target is on screen, in viewport coordinates. */
export type AnchorRect = { top: number; left: number; width: number; height: number }

/**
 * How long to keep re-measuring once the anchor turns up. The sidebar drawer
 * slides for 200ms, so a single rect read the moment the tour opens it rings
 * empty space to the left of the screen.
 */
const SETTLE_MS = 350
/**
 * How long to wait for an anchor that is not on the page yet. A page arrives
 * through a dynamic import behind `<Suspense>`, so the map's own controls can
 * genuinely be a few hundred milliseconds late when the tour starts from
 * another page. After this the caller is told the target is not coming.
 */
const PATIENCE_MS = 1500

/**
 * More than one element can carry the same anchor. The sidebar is a per-route
 * component behind a `<KeepAlive>`, so every page visited this session leaves
 * its own copy of the panel teleported onto `<body>` — measured: two planners,
 * both 255px wide, both sitting at x = -256 with the drawer shut. Taking the
 * first match rang a box off the left of the screen; the one to ring is the one
 * actually on it.
 */
const measure = (anchor: string): AnchorRect | null => {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`)) {
    if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue
    const { top, left, width, height } = element.getBoundingClientRect()
    // A zero-sized box is the desktop panel collapsed to nothing: in the DOM,
    // laid out, and still not something a reader could be pointed at.
    if (width > 0 && height > 0) return { top, left, width, height }
  }
  return null
}

const same = (a: AnchorRect | null, b: AnchorRect | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/**
 * The viewport rect of the element marked `data-tour="<anchor>"`, kept fresh
 * while something is moving and then left alone.
 *
 * Found by attribute rather than by a ref handed in: the three targets sit in
 * the header, in the sidebar's named router view and on the map page, so any
 * other way of reaching them means every page knowing about the tour —
 * and `provide`/`inject` is out.
 *
 * The rAF loop is deliberately short-lived. The hint under the menu button can
 * sit on screen for minutes, and a loop measuring it every frame for that long
 * would keep a phone's compositor awake for nothing; once whatever was
 * animating has landed, a resize or a scroll is the only thing that can move
 * the target, and those are events.
 */
export function useAnchorRect(anchor: Ref<string | null>) {
  const rect = ref<AnchorRect | null>(null)
  /** The anchor never turned up — the caller's cue to move on without it. */
  const missing = ref(false)

  let frame = 0
  let deadline = 0

  const read = () => {
    const next = anchor.value ? measure(anchor.value) : null
    // Only written when the numbers actually changed: a fresh object every
    // frame would re-render the callout sixty times a second.
    if (!same(rect.value, next)) rect.value = next
  }

  const stop = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  const tick = (now: number) => {
    read()
    // Found: carry on only long enough for the movement to finish. Still
    // nothing: keep looking until patience runs out, then say so.
    if (rect.value) deadline = Math.min(deadline, now + SETTLE_MS)
    if (now >= deadline) {
      stop()
      missing.value = !rect.value
      return
    }
    frame = requestAnimationFrame(tick)
  }

  let listening = false

  // Capturing on scroll, because the sidebar's own ScrollArea is what scrolls
  // and a scroll event does not bubble past it.
  const startListening = () => {
    if (listening) return
    listening = true
    window.addEventListener('resize', read)
    window.addEventListener('scroll', read, true)
  }

  const stopListening = () => {
    if (!listening) return
    listening = false
    window.removeEventListener('resize', read)
    window.removeEventListener('scroll', read, true)
  }

  watch(
    anchor,
    (value) => {
      stop()
      rect.value = null
      missing.value = false
      if (!value) {
        stopListening()
        return
      }
      startListening()
      deadline = performance.now() + PATIENCE_MS
      frame = requestAnimationFrame(tick)
    },
    { immediate: true },
  )

  // The very first watch run happens before the component's own DOM exists, so
  // an anchor that is already set gets one more look once it does.
  onMounted(read)

  onBeforeUnmount(() => {
    stop()
    stopListening()
  })

  return { rect, missing }
}
