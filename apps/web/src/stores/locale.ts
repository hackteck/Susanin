import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LocalizedName } from '@/api/types'
import { counted, messages, type CountedKey, type Locale, type MessageKey } from '@/i18n/messages'

export type { Locale }

const storageKey = 'locale'

const initial = (): Locale => {
  const stored = localStorage.getItem(storageKey)
  if (stored === 'ru' || stored === 'ka' || stored === 'en') return stored

  // Russian is the default: it is what most of Batumi's visitors and a large
  // share of its residents read, and the feed's own names are Georgian either
  // way. A browser that asks for one of the three still gets its own language.
  //
  // Asked of the whole list, in the reader's own order, rather than of
  // `navigator.language` — which is only the first entry. A browser set to
  // German and then English answered "not Georgian, not English" and got
  // Russian, with English sitting one line further down the list it had
  // published. Empty on some browsers, hence the fallback.
  const requested = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of requested) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'ka' || base === 'en' || base === 'ru') return base
  }

  return 'ru'
}

export const useLocale = defineStore('locale', () => {
  const locale = ref<Locale>(initial())

  // The very first load never went through setLocale, so `lang` would otherwise
  // stay whatever index.html says — which decides the `:lang(ka)` type sizing
  // and what a screen reader pronounces.
  document.documentElement.lang = locale.value

  const setLocale = (value: Locale) => {
    locale.value = value
    localStorage.setItem(storageKey, value)
    document.documentElement.lang = value
  }

  /** A UI string. */
  const t = computed(() => (key: MessageKey) => messages[key][locale.value])

  /**
   * A counted noun in the right form — "1 автобус", "2 автобуса", "5 автобусов".
   * Intl decides the category, so no plural rules are written out here.
   */
  const plural = computed(() => {
    const rules = new Intl.PluralRules(locale.value)
    return (count: number, key: CountedKey) => {
      const forms = counted[key][locale.value] as Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
      return `${count} ${forms[rules.select(count)] ?? forms.other}`
    }
  })

  /**
   * A name that came from the feed. Georgian is what is written on the pole,
   * English exists for only 171 of 578 stops, and Russian is the API's
   * transliteration of the Georgian — so each locale has something to show and
   * none of them is a guess dressed up as a translation.
   */
  const name = computed(() => {
    const current = locale.value
    return (value: LocalizedName | undefined) => value?.[current] || value?.ka || value?.en || ''
  })

  return { locale, setLocale, t, plural, name }
})
