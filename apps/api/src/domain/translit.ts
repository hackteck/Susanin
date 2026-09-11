/**
 * Georgian → Cyrillic for stop names.
 *
 * Why this exists: the feed carries names in Georgian and English, and only 171
 * of 578 stops have a name that is genuinely Latin — so a Russian-reading
 * passenger, who is most of this app's audience, otherwise sees Georgian script
 * for seven stops in ten, including the one they are standing at.
 *
 * This is transliteration, not translation. It renders the name as it sounds,
 * so a reader can match it against the pole; it collides the aspirated pairs
 * (თ/ტ → т, ქ/კ → к), which does not matter for that purpose. The one thing it
 * does translate is the handful of common nouns that recur across hundreds of
 * names, because "улица" is what makes the rest of the line parse as an address.
 */

const LETTERS: Record<string, string> = {
  ა: 'а',
  ბ: 'б',
  გ: 'г',
  დ: 'д',
  ე: 'е',
  ვ: 'в',
  ზ: 'з',
  თ: 'т',
  ი: 'и',
  კ: 'к',
  ლ: 'л',
  მ: 'м',
  ნ: 'н',
  ო: 'о',
  პ: 'п',
  ჟ: 'ж',
  რ: 'р',
  ს: 'с',
  ტ: 'т',
  უ: 'у',
  ფ: 'ф',
  ქ: 'к',
  ღ: 'г',
  ყ: 'к',
  შ: 'ш',
  ჩ: 'ч',
  ც: 'ц',
  ძ: 'дз',
  წ: 'ц',
  ჭ: 'ч',
  ხ: 'х',
  ჯ: 'дж',
  ჰ: 'х',
}

/**
 * Nouns worth translating rather than sounding out. `ქუჩა` alone appears in 408
 * of 578 names — measured, not guessed — so it carries most of the value here.
 */
const NOUNS: Record<string, string> = {
  ქუჩა: 'улица',
  გამზირი: 'проспект',
  გზატკეცილი: 'шоссе',
  მოედანი: 'площадь',
  ჩიხი: 'переулок',
  ხიდი: 'мост',
  სკოლა: 'школа',
  საჯარო: 'публичная',
  ბაღი: 'сад',
  პარკი: 'парк',
  ბაზარი: 'рынок',
  საავადმყოფო: 'больница',
  უნივერსიტეტი: 'университет',
  სასაფლაო: 'кладбище',
  აეროპორტი: 'аэропорт',
  სადგური: 'станция',
  ცენტრი: 'центр',
  არენა: 'арена',
  სტადიონი: 'стадион',
  და: 'и',
}

/** Street types that lead in Russian — "улица Пушкина", never "Пушкина улица". */
const LEADING = new Set(['улица', 'проспект', 'шоссе', 'площадь', 'переулок', 'мост'])

const GEORGIAN = /[Ⴀ-ჿ]/

const capitalise = (word: string) => (word ? word[0]!.toUpperCase() + word.slice(1) : word)

const sound = (word: string) => {
  let out = ''
  for (const char of word) out += LETTERS[char] ?? char
  return out
}

/**
 * Georgian marks the possessive with a trailing `-ის`, so "Khalvashi's street"
 * is `ხალვაშის ქუჩა`. Once the noun has moved to the front in Russian, that
 * `ს` is left dangling on the name, and dropping it is what turns
 * "Улица Халвашис" into "Улица Халваши".
 */
const stripGenitive = (word: string) => (word.endsWith('ის') ? word.slice(0, -1) : word)

/**
 * `მე-18` is "18th" — as a label, Russian wants the ordinal, not the particle.
 * The feed writes the dash as a hyphen in some names and an en dash in others.
 */
const ORDINAL = /^მე[-–—]\s*(\d+)$/

export function toCyrillic(georgian: string): string {
  if (!GEORGIAN.test(georgian)) return georgian

  const tokens = georgian.replace(/#/g, '№').split(/\s+/).filter(Boolean)
  if (!tokens.length) return georgian

  // The street type leads in Russian, and it is not always the last token —
  // house numbers trail it ("Grishashvili street №14"), so it is looked for
  // anywhere rather than only at the end.
  const nounIndex = tokens.findIndex((token) => {
    const noun = NOUNS[token]
    return noun !== undefined && LEADING.has(noun)
  })

  const leading = nounIndex >= 0 ? NOUNS[tokens[nounIndex]!]! : null
  const body = nounIndex >= 0 ? tokens.filter((_, index) => index !== nounIndex) : tokens

  const rendered = body.map((token, index) => {
    const ordinal = ORDINAL.exec(token)
    if (ordinal) return `${ordinal[1]}-я`

    const known = NOUNS[token]
    if (known) return known

    // Only the word that directly preceded the moved noun carried the possessive.
    const stem = nounIndex >= 0 && index === nounIndex - 1 ? stripGenitive(token) : token
    return capitalise(sound(stem))
  })

  const parts = leading ? [capitalise(leading), ...rendered] : rendered
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
