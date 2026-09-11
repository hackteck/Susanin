import { toCyrillic } from './translit.ts'
import table from './names.data.json' with { type: 'json' }

/**
 * Stop names in Russian and English, from OpenStreetMap rather than sounded out.
 *
 * Transliteration was the wrong tool and the feed's own data shows why: it gets a
 * reader to the right syllables and the wrong words. `ანდრიაპირველწოდებული ქუჩა`
 * came out "Улица Андриапирвелцодебули", which is not what the street sign says,
 * not what Yandex prints, and not a phrase a Russian reader can repeat to a
 * driver. OSM carries `name:ru` and `name:en` across Batumi at near-total
 * coverage, and they are real translations — so they lead, and `translit.ts` is
 * the fallback for what OSM has never heard of.
 *
 * The table is keyed by the STREET, not by the pole: the feed appends a house
 * number to distinguish poles on one street ("ქუჩა №364"), and 578 poles share
 * 176 names once that is taken off. The number is put back afterwards, because
 * it is how someone standing there knows which pole they are at.
 */

const names: Record<string, { ru: string; en: string }> = table.names

/**
 * Anchored at the end, and that anchoring is the point: a *leading* "№23" is a
 * school's number and part of its name, while a trailing one is the pole's.
 */
const HOUSE_NUMBER = /[№#]+\s*(\d+\S*)\s*$/

export interface OsmName {
  ru: string
  en: string
}

/**
 * Only the letters that actually appear as a house-number suffix here — this is
 * not a romanisation table and should not grow into one. Anything else is left
 * as it is rather than guessed at.
 */
const LATIN_SUFFIX: Record<string, string> = { ა: 'a', ბ: 'b', გ: 'c', დ: 'd' }

const toLatinSuffix = (number: string) =>
  number.replace(/[Ⴀ-ჿ]/g, (char) => LATIN_SUFFIX[char] ?? char)

/** ODbL requires this to be shown wherever the names are. */
export const namesAttribution = table.meta.attribution

export function lookupName(georgian: string): OsmName | null {
  const trimmed = georgian.trim()

  const direct = names[trimmed]
  if (direct) return { ru: direct.ru, en: direct.en }

  const match = HOUSE_NUMBER.exec(trimmed)
  if (!match) return null

  const base = trimmed.slice(0, match.index).trim()
  const entry = names[base]
  if (!entry) return null

  // A number is a number in every locale — except that Batumi writes the
  // subdivided ones with a Georgian letter ("№3ა", the equivalent of 3a). Left
  // alone, that single letter is Georgian script surviving into a Russian
  // string, which is the one thing this whole path exists to prevent. Measured:
  // 5 of 578 poles.
  const number = match[1]!
  const append = (value: string, suffix: string) =>
    value && !value.includes(suffix) ? `${value} №${suffix}` : value

  return {
    ru: append(entry.ru, toCyrillic(number)),
    en: append(entry.en, toLatinSuffix(number)),
  }
}

/**
 * The Russian name, with transliteration behind it. The fallback still matters:
 * it is what keeps a stop OSM has never mapped from showing Georgian script to a
 * reader who cannot read it.
 */
export function russianName(georgian: string): string {
  return lookupName(georgian)?.ru || toCyrillic(georgian)
}
