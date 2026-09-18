import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import placesUrl from '@/places/places.data.json?url'
import { buildIndex, placeAt, searchPlaces, type FoundPlace, type PlacesData, type PlacesIndex } from '@/places/search'
import type { LatLon } from '@/planner/geo'

const RECENT_KEY = 'recentPlaces'
/** As many as fit under a field without scrolling, which is what makes them one tap. */
const RECENT_LIMIT = 10

/**
 * Stored places are read back defensively: storage outlives the build that
 * wrote it, and a malformed entry must cost one recent, not the planner.
 */
const isFoundPlace = (value: unknown): value is FoundPlace => {
  const place = value as Partial<FoundPlace> | null
  return (
    typeof place?.id === 'string' &&
    typeof place.kind === 'string' &&
    typeof place.lat === 'number' &&
    typeof place.lon === 'number' &&
    typeof place.name?.ka === 'string' &&
    typeof place.name.ru === 'string' &&
    typeof place.name.en === 'string'
  )
}

const readRecent = (): FoundPlace[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(isFoundPlace).slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/**
 * Addresses and named places for the trip planner's fields, and the ones the
 * reader chose before.
 *
 * The table is 190 KB compressed, so it is fetched the first time a field is
 * focused rather than on every visit, and cached by the service worker after
 * that — which is what lets a search work with no signal.
 *
 * The recents are the one thing here that is kept between visits, unlike the
 * trip itself: a place someone went to is a place they go to, whereas a trip
 * reopened tomorrow is a question nobody asked.
 */
export const usePlaces = defineStore('places', () => {
  const index = shallowRef<PlacesIndex | null>(null)
  const failed = ref(false)
  let request: Promise<void> | null = null

  const load = () => {
    if (request) return request
    failed.value = false
    request = fetch(placesUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`places ${response.status}`)
        return response.json() as Promise<PlacesData>
      })
      .then((data) => {
        index.value = buildIndex(data)
      })
      .catch(() => {
        failed.value = true
        request = null
      })
    return request
  }

  const recent = ref<FoundPlace[]>(readRecent())

  const remember = (place: FoundPlace) => {
    recent.value = [place, ...recent.value.filter((other) => other.id !== place.id)].slice(0, RECENT_LIMIT)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
    } catch {
      // Storage refused (private mode, quota): the list still works for this visit.
    }
  }

  /** All of them: a history is the reader's to keep or wipe. */
  const forget = () => {
    recent.value = []
    try {
      localStorage.removeItem(RECENT_KEY)
    } catch {
      // Storage refused: the list is empty for this visit either way.
    }
  }

  const search = (query: string, near?: LatLon | null) =>
    index.value ? searchPlaces(index.value, query, { near }) : []

  // A trip's ends are named on every render of the fields, the sheet and the
  // steps, and naming a point is a scan of the whole table.
  const named = new Map<string, FoundPlace | null>()

  /** What a point picked on the map is called, once the table is here to ask. */
  const at = (point: LatLon) => {
    if (!index.value) return null
    const key = `${point.lat},${point.lon}`
    if (!named.has(key)) named.set(key, placeAt(index.value, point))
    return named.get(key) ?? null
  }

  return { ready: computed(() => !!index.value), failed, load, recent, remember, forget, search, at }
})
