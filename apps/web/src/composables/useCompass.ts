import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { easeBearing, readHeading } from '@/sensors/compass'

/**
 * How long the beam takes to settle on a new reading. The magnetometer jitters
 * by a few degrees at rest; unsmoothed, the beam shivers, and anything that
 * moves on its own on this map reads as a second live thing.
 */
const SETTLE_MS = 120

/** The WebKit-only fields; iOS reports its compass through these and nothing else. */
interface WebKitOrientation {
  webkitCompassHeading?: number | null
  webkitCompassAccuracy?: number | null
}

/** iOS 13+ exposes this on the constructor, and nowhere else does. */
type PermissionRequest = () => Promise<'granted' | 'denied'>

const permissionRequest = (): PermissionRequest | undefined => {
  if (typeof DeviceOrientationEvent === 'undefined') return undefined
  const ask = (DeviceOrientationEvent as unknown as { requestPermission?: PermissionRequest }).requestPermission
  return typeof ask === 'function' ? ask.bind(DeviceOrientationEvent) : undefined
}

/** `window.orientation` is the fallback for Safari before 16.4, and writes a clockwise turn as -90. */
const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0

/**
 * Which way the reader is facing, as the phone's own bearing — null until a real reading
 * arrives, and it never arrives on a device with no compass, which is how a
 * desktop ends up drawing no beam rather than one pointing north.
 *
 * Listening only while `enabled` and the tab is visible, the same discipline as
 * the position watch: a beam with no dot under it answers nothing, and a sensor
 * nobody can see is a battery spent for no one. Stopping forgets the heading,
 * because where the reader faced before the tab was hidden says nothing about
 * where they face now.
 */
export function useCompass(enabled: Ref<boolean>) {
  const heading = ref<number | null>(null)

  // Chrome reports north-referenced angles only on the `absolute` event; its
  // plain one is relative. iOS has no absolute event but puts a compass heading
  // on the plain one, and Firefox's plain one is absolute.
  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'

  let smoothed: number | null = null
  let lastAt = 0
  let frame = 0
  let listening = false

  // Readings land at up to 60 Hz; the map needs one per frame at most, and none
  // at all while the smoothed bearing rounds to the same degree.
  const publish = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      heading.value = smoothed === null ? null : Math.round(smoothed) % 360
    })
  }

  const onReading = (event: Event) => {
    const orientation = event as DeviceOrientationEvent & WebKitOrientation
    const reading = readHeading(
      {
        alpha: orientation.alpha,
        beta: orientation.beta,
        gamma: orientation.gamma,
        absolute: orientation.absolute,
        webkitCompassHeading: orientation.webkitCompassHeading,
        webkitCompassAccuracy: orientation.webkitCompassAccuracy,
      },
      screenAngle(),
    )

    if (reading === null) {
      smoothed = null
    } else if (smoothed === null) {
      smoothed = reading
    } else {
      // Weighted by elapsed time rather than per event, so a phone that reports
      // at 20 Hz settles as quickly as one reporting at 60.
      const elapsed = Math.max(0, event.timeStamp - lastAt)
      smoothed = easeBearing(smoothed, reading, 1 - Math.exp(-elapsed / SETTLE_MS))
    }
    lastAt = event.timeStamp
    publish()
  }

  const start = () => {
    if (listening || document.hidden || !enabled.value) return
    window.addEventListener(eventName, onReading)
    listening = true
  }

  const stop = () => {
    if (!listening) return
    window.removeEventListener(eventName, onReading)
    listening = false
    cancelAnimationFrame(frame)
    frame = 0
    smoothed = null
    heading.value = null
  }

  const onVisibility = () => (document.hidden ? stop() : start())

  document.addEventListener('visibilitychange', onVisibility)
  watch(enabled, (on) => (on ? start() : stop()), { immediate: true })

  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
  })

  /**
   * iOS reports no orientation until asked, and lets a page ask only from inside
   * a tap — so this is called from the locate button, the one press that is
   * already a question about where the reader is. Everywhere else it does
   * nothing. The listener is restarted on a grant in case it was added before
   * there was permission to hear anything; a refusal is final until Safari is
   * restarted, and costs the reader nothing but the beam.
   */
  const request = () => {
    const ask = permissionRequest()
    if (!ask) return
    ask()
      .then((state) => {
        if (state !== 'granted') return
        stop()
        start()
      })
      .catch(() => {})
  }

  return { heading, request }
}
