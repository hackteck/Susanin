import { computed } from 'vue'
import type { NextBus } from '@/composables/useArrivals'
import type { WalkLeg } from '@/planner/plan'
import { useLocale } from '@/stores/locale'
import { usePlaces } from '@/stores/places'
import type { Place } from '@/stores/planner'
import { useTransit } from '@/stores/transit'

/**
 * Whole minutes, rounded up: a trip that takes 36.2 minutes does not take 36.
 * Shared with the list of stops nearby, which must not give the same walk a
 * minute less than the planner does.
 */
export const wholeMinutes = (minutes: number) => Math.max(1, Math.ceil(minutes - 1e-9))

/** Under this a bus is at the kerb, as on the arrival board. */
const DUE_SECONDS = 45

/**
 * How a planned trip reads: its durations, its walks, its next bus. One place for
 * it because the options list and the step view say the same things about the
 * same journey, and "37 мин" in one beside "36 мин" in the other would be the
 * kind of disagreement nobody trusts a planner after.
 */
export function useJourneyFormat() {
  const locale = useLocale()
  const places = usePlaces()
  const transit = useTransit()

  /** An end of the trip as the fields name it: a place by its name, a stop by name and pole number. */
  const place = (value: Place | null) => {
    if (!value) return ''
    if (value.kind === 'me') return locale.t('followMe')
    if (value.kind === 'place') return locale.name(value.place.name)
    if (value.kind === 'point') {
      // Named by the house or place under it, when there is one: "Point on the
      // map → Point on the map" as a trip's title says nothing about the trip.
      const there = places.at(value)
      return there ? locale.name(there.name) : locale.t('pointOnMap')
    }
    const stop = transit.stopById.get(value.stopId)
    return stop ? `${locale.name(stop.name)} · ${stop.code}` : ''
  }

  const duration = (minutes: number) => {
    const whole = wholeMinutes(minutes)
    if (whole < 60) return `${whole} ${locale.t('minutesShort')}`
    const rest = whole % 60
    const hours = `${Math.floor(whole / 60)} ${locale.t('hoursShort')}`
    return rest ? `${hours} ${rest} ${locale.t('minutesShort')}` : hours
  }

  /**
   * The next bus as the arrival board says it: a word once it is at the kerb,
   * the ≈ while it is barely moving, and nothing once it has been and gone.
   */
  const countdown = (bus: Pick<NextBus, 'arrivesAt' | 'confidence'>, now: number) => {
    const seconds = (Date.parse(bus.arrivesAt) - now) / 1000
    if (seconds < -90) return ''
    if (seconds <= DUE_SECONDS) return locale.t('approaching').toLowerCase()
    const soft = bus.confidence === 'slow' ? '≈' : ''
    return `${soft}${Math.ceil(seconds / 60)} ${locale.t('minutesShort')}`
  }

  // «2,6 км», not «2.6 км»: Russian and Georgian write the decimal with a comma,
  // and a full stop there reads as a typo in exactly the two languages most
  // readers use.
  const kilometres = computed(
    () => new Intl.NumberFormat(locale.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  )

  const distance = (metres: number) =>
    metres < 1000
      ? `${Math.max(10, Math.round(metres / 10) * 10)} ${locale.t('metresAway')}`
      : `${kilometres.value.format(metres / 1000)} ${locale.t('kilometresAway')}`

  const walk = (leg: Pick<WalkLeg, 'metres' | 'minutes'>) => `${distance(leg.metres)} · ${duration(leg.minutes)}`

  return { place, duration, countdown, distance, walk }
}
