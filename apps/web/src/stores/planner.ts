import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { api } from '@/api/client'
import type { TimetablePattern } from '@/api/types'
import { metresBetween, type LatLon } from '@/planner/geo'
import { buildPlannerNetwork } from '@/planner/network'
import { planJourneys, type Journey, type PlanQuery, type PlanResult } from '@/planner/plan'
import { minutesInBatumi } from '@/planner/time'
import type { FoundPlace } from '@/places/search'
import { useProximity } from '@/stores/proximity'
import { useTransit } from '@/stores/transit'

/**
 * One end of a journey: where the reader is, a stop, an address or named place
 * found by search, or a point they tapped.
 */
export type Place =
  | { kind: 'me' }
  | { kind: 'stop'; stopId: string }
  | { kind: 'place'; place: FoundPlace }
  | { kind: 'point'; lat: number; lon: number }
export type PlaceField = 'from' | 'to'

/**
 * How often a plan is redone. The options change as buses leave, and a plan
 * made ten minutes ago recommends a bus that has gone.
 */
const REPLAN_MS = 30_000

/**
 * A fix moving by less than this does not re-plan. The map watches the position
 * every few seconds, and re-sorting the options under someone's thumb because
 * their phone's GPS wobbled is worse than an access walk that is 40 m stale.
 */
const REPLAN_AFTER_METRES = 50

/**
 * The journey planner's state. App-wide because the fields live in the sidebar,
 * the answer lives on the map, and "directions to here" lives on a stop — three
 * surfaces in three subtrees asking about the same two places.
 *
 * Nothing here is persisted, for the same reason the route selection is not: a
 * trip is a question asked now, and reopening the app tomorrow to a plan nobody
 * remembers asking for is a quiet wrong answer.
 */
export const usePlanner = defineStore('planner', () => {
  const transit = useTransit()
  const proximity = useProximity()

  const from = ref<Place | null>(null)
  const to = ref<Place | null>(null)
  /** Armed from a field's "choose on the map"; the next tap on the map answers it. */
  const picking = ref<PlaceField | null>(null)
  /** The option on the map, by its lines rather than its position in a list that re-sorts. */
  const selectedKey = ref<string | null>(null)
  /** The sheet shows the chosen option step by step rather than the list. */
  const showSteps = ref(false)

  const timetable = ref<TimetablePattern[] | null>(null)
  const timetableFailed = ref(false)
  let timetableRequest: Promise<void> | null = null

  /**
   * Fetched the first time anyone reaches for the planner, not on every page
   * load — most visits are a glance at a map. Cached by the service worker like
   * the rest of the network, which is what makes planning work with no signal.
   */
  const loadTimetable = () => {
    if (timetableRequest) return timetableRequest
    timetableFailed.value = false
    timetableRequest = Promise.all([api.timetable(), transit.loadNetwork()])
      .then(([patterns]) => {
        timetable.value = patterns
      })
      .catch(() => {
        timetableFailed.value = true
        timetableRequest = null
      })
    return timetableRequest
  }

  const network = computed(() =>
    timetable.value && transit.stops.length ? buildPlannerNetwork(transit.stops, timetable.value) : null,
  )

  // Where "me" is planned from. Latched, and only moved on a real move.
  const meAnchor = ref<LatLon | null>(null)
  watch(
    () => proximity.fix,
    (fix) => {
      if (!fix) return
      if (!meAnchor.value || metresBetween(meAnchor.value, fix) > REPLAN_AFTER_METRES) {
        meAnchor.value = { lat: fix.lat, lon: fix.lon }
      }
    },
    { immediate: true },
  )

  const pointOf = (place: Place | null): LatLon | null => {
    if (!place) return null
    if (place.kind === 'point') return { lat: place.lat, lon: place.lon }
    if (place.kind === 'place') return { lat: place.place.lat, lon: place.place.lon }
    if (place.kind === 'stop') {
      const stop = transit.stopById.get(place.stopId)
      return stop ? { lat: stop.lat, lon: stop.lon } : null
    }
    return meAnchor.value
  }

  const fromPoint = computed(() => pointOf(from.value))
  const toPoint = computed(() => pointOf(to.value))
  const active = computed(() => !!from.value && !!to.value)
  /** Either end is "me" and there is no fix to plan from yet. */
  const waitingForFix = computed(
    () => active.value && (from.value?.kind === 'me' || to.value?.kind === 'me') && !meAnchor.value,
  )

  const clock = ref(Date.now())
  let timer: number | undefined
  const tick = () => {
    clock.value = Date.now()
  }

  // Only while there is a plan to keep current. A store lives as long as the
  // app, and a timer that outlived the question would be a battery tax on every
  // page for nothing.
  watch(
    active,
    (on) => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      if (!on) return
      tick()
      timer = window.setInterval(tick, REPLAN_MS)
      document.addEventListener('visibilitychange', tick)
    },
    { immediate: true },
  )

  // Always from now. A departure or arrival time was offered and taken out: the
  // question at a kerb is "how do I get there from here, now", and a control
  // nobody changes is a control everybody has to read past.
  const query = computed<PlanQuery | null>(() =>
    fromPoint.value && toPoint.value
      ? { from: fromPoint.value, to: toPoint.value, at: minutesInBatumi(clock.value) }
      : null,
  )

  const result = computed<PlanResult | null>(() =>
    network.value && query.value ? planJourneys(network.value, query.value) : null,
  )

  const selectedJourney = computed<Journey | null>(() => {
    const journeys = result.value?.journeys ?? []
    return journeys.find((journey) => journey.key === selectedKey.value) ?? journeys[0] ?? null
  })

  // A different question is a different list: the old choice means nothing in it.
  watch([from, to], () => {
    selectedKey.value = null
    showSteps.value = false
  })

  const ensureFix = () => {
    // The reader chose "my location", which is the press that is allowed to ask.
    if (!proximity.fix) proximity.locate()
    else if (Date.now() - proximity.fix.at > REPLAN_MS) proximity.locate({ silent: true })
  }

  const setPlace = (field: PlaceField, place: Place | null) => {
    // "My location" at both ends is a trip to nowhere: choosing it for one end
    // moves it there rather than leaving it at the other as well.
    const other = field === 'from' ? to : from
    if (place?.kind === 'me' && other.value?.kind === 'me') other.value = null

    if (field === 'from') from.value = place
    else to.value = place
    picking.value = null

    if (place?.kind === 'me') ensureFix()

    // "How do I get there" is asked from here far more often than from anywhere
    // else — but only when the browser already lets us know where here is.
    // Never a permission prompt the reader did not ask for — and never when the
    // destination *is* here, which used to make a trip from me to me.
    if (field === 'to' && place && place.kind !== 'me' && !from.value && proximity.permission === 'granted') {
      from.value = { kind: 'me' }
      ensureFix()
    }

    if (from.value || to.value) void loadTimetable()
  }

  const swap = () => {
    ;[from.value, to.value] = [to.value, from.value]
  }

  const clear = () => {
    from.value = null
    to.value = null
    picking.value = null
    showSteps.value = false
  }

  const arm = (field: PlaceField) => {
    picking.value = field
  }

  const disarm = () => {
    picking.value = null
  }

  const pickAt = (lat: number, lon: number) => {
    if (picking.value) setPlace(picking.value, { kind: 'point', lat, lon })
  }

  const selectJourney = (key: string) => {
    selectedKey.value = key
    showSteps.value = true
  }

  const backToOptions = () => {
    showSteps.value = false
  }

  return {
    from,
    to,
    picking,
    showSteps,
    timetable,
    timetableFailed,
    fromPoint,
    toPoint,
    active,
    waitingForFix,
    query,
    result,
    selectedJourney,
    loadTimetable,
    setPlace,
    swap,
    clear,
    arm,
    disarm,
    pickAt,
    selectJourney,
    backToOptions,
  }
})
