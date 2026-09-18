import type { WalkLeg } from '@/planner/plan'
import { clockLabel, isTomorrow } from '@/planner/time'
import { useLocale } from '@/stores/locale'
import type { Place } from '@/stores/planner'
import { useTransit } from '@/stores/transit'

/**
 * How a planned trip reads: its times, its durations, its walks. One place for
 * it because the options list and the step view say the same things about the
 * same journey, and "37 мин" in one beside "36 мин" in the other would be the
 * kind of disagreement nobody trusts a planner after.
 */
export function useJourneyFormat() {
  const locale = useLocale()
  const transit = useTransit()

  /** An end of the trip as the fields name it: a stop by name and pole number. */
  const place = (value: Place | null) => {
    if (!value) return ''
    if (value.kind === 'me') return locale.t('followMe')
    if (value.kind === 'point') return locale.t('pointOnMap')
    const stop = transit.stopById.get(value.stopId)
    return stop ? `${locale.name(stop.name)} · ${stop.code}` : ''
  }

  /** Whole minutes, rounded up: a trip that takes 36.2 minutes does not take 36. */
  const duration = (minutes: number) => {
    const whole = Math.max(1, Math.ceil(minutes - 1e-9))
    if (whole < 60) return `${whole} ${locale.t('minutesShort')}`
    const rest = whole % 60
    const hours = `${Math.floor(whole / 60)} ${locale.t('hoursShort')}`
    return rest ? `${hours} ${rest} ${locale.t('minutesShort')}` : hours
  }

  /** A clock time, saying so when it is tomorrow's. */
  const time = (minutes: number) =>
    isTomorrow(minutes) ? `${locale.t('tomorrow')} ${clockLabel(minutes)}` : clockLabel(minutes)

  /** A departure is floored and an arrival rounded up, so neither promises a minute it has not got. */
  const departTime = (minutes: number) => time(Math.floor(minutes + 1e-9))
  const arriveTime = (minutes: number) => time(Math.ceil(minutes - 1e-9))

  /**
   * How long from one to the other, counted between the two times as printed.
   * Measured from the unrounded ones it read "12:20 – 12:50, 29 мин", which is
   * arithmetic a reader does in their head and then stops trusting us.
   */
  const span = (depart: number, arrive: number) =>
    duration(Math.ceil(arrive - 1e-9) - Math.floor(depart + 1e-9))

  const distance = (metres: number) =>
    metres < 1000
      ? `${Math.max(10, Math.round(metres / 10) * 10)} ${locale.t('metresAway')}`
      : `${(metres / 1000).toFixed(1)} ${locale.t('kilometresAway')}`

  const walk = (leg: Pick<WalkLeg, 'metres' | 'minutes'>) => `${distance(leg.metres)} · ${duration(leg.minutes)}`

  return { place, duration, span, time, departTime, arriveTime, distance, walk }
}
