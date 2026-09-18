import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Stop } from '@/api/types'
import { useLocale } from '@/stores/locale'
import { useTransit } from '@/stores/transit'

/** More than this and it stops being a shortlist and starts being the stop list. */
const LIMIT = 12

/**
 * Finding a stop, by the two things a person actually has: the number printed
 * on the pole, or a piece of the name.
 *
 * The number matters more than it looks. 74 stop names are shared by more than
 * one stop and 407 of 578 have no Latin name at all, so the code is the only
 * handle that is unambiguous in every language — which is why a numeric query
 * matches on it alone and ranks exact hits first.
 */
export function useStopSearch(query: MaybeRefOrGetter<string>) {
  const transit = useTransit()
  const locale = useLocale()

  const results = computed<Stop[]>(() => {
    const term = toValue(query).trim().toLowerCase()
    if (term.length < 2) return []

    // Every locale at once: someone reading the Russian UI may still be typing
    // what is written on the pole in Georgian.
    const byName = transit.stops
      .filter((stop) => [stop.name.ru, stop.name.ka, stop.name.en].some((name) => name.toLowerCase().includes(term)))
      .sort((a, b) => rankName(a, term, locale.name) - rankName(b, term, locale.name))

    if (!/^\d+$/.test(term)) return byName.slice(0, LIMIT)

    // A number is usually a pole code, so those lead — but street numbers are in
    // the names too ("Улица Чавчавадзе №26"), and returning nothing for "26"
    // because no pole has that code is a search that looks broken.
    const byCode = transit.stops
      .filter((stop) => String(stop.code).startsWith(term))
      .sort((a, b) => rankCode(a, term) - rankCode(b, term))

    const seen = new Set(byCode.map((stop) => stop.id))
    return [...byCode, ...byName.filter((stop) => !seen.has(stop.id))].slice(0, LIMIT)
  })

  return { results }
}

/** An exact code first, then the rest in numeric order rather than by length. */
const rankCode = (stop: Stop, term: string) => (String(stop.code) === term ? -1 : stop.code)

/** A name that starts with the term beats one that merely contains it. */
const rankName = (stop: Stop, term: string, display: (name: Stop['name']) => string) => {
  const name = display(stop.name).toLowerCase()
  return name.startsWith(term) ? 0 : 1
}
