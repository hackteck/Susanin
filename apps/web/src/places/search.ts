import type { LocalizedName } from '../api/types.ts'
import { metresBetween, type LatLon } from '../planner/geo.ts'

/**
 * Finding an address or a named place by what someone types into a trip field.
 *
 * The table is OpenStreetMap's, baked by tools/build-places.mjs, and searched
 * here, on the device — see that script for why it is not a geocoder behind an
 * API. Plain TypeScript with no Vue, like the planner, so `node --test` runs it.
 */

export type PlaceKind =
  | 'address'
  | 'street'
  | 'area'
  | 'transport'
  | 'food'
  | 'shop'
  | 'lodging'
  | 'health'
  | 'education'
  | 'worship'
  | 'money'
  | 'sight'
  | 'leisure'
  | 'office'
  | 'car'
  | 'building'

/** A place a trip can start or end at: what a search returns, and what the recents keep. */
export interface FoundPlace {
  /** Stable enough to tell one place from another across rebuilds of the table. */
  id: string
  kind: PlaceKind
  name: LocalizedName
  /** The second line — a place's address, or the district or village it is in. */
  detail: LocalizedName | null
  lat: number
  lon: number
}

/** The shape tools/build-places.mjs writes. Tuples, because 20,000 keyed objects is a lot of keys. */
export interface PlacesData {
  origin: [number, number]
  /** [ka, ru, en, lat, lon, settlement] — Russian and English empty where they are the Georgian. */
  areas: [string, string, string, number, number, number][]
  /** [ka, ru, en, area, lat, lon] */
  streets: [string, string, string, number, number, number][]
  /** [street, number, lat, lon, number, lat, lon, …] */
  addresses: (string | number)[][]
  /** [ka, ru, en, kind, area, lat, lon, street, number, prominent, type] */
  places: [string, string, string, string, number, number, number, number, string, number, string][]
}

interface Address {
  number: string
  /** The number as it is typed, in whichever script. */
  key: string
  lat: number
  lon: number
}

interface Street {
  name: LocalizedName
  area: LocalizedName | null
  lat: number
  lon: number
  words: string[]
  addresses: Address[]
}

interface Place {
  name: LocalizedName
  kind: PlaceKind
  area: LocalizedName | null
  lat: number
  lon: number
  street: Street | null
  number: string
  prominent: boolean
  words: string[]
  /** What this kind of place is called — found, but after a match on the name. */
  typeWords: string[]
}

interface Area {
  name: LocalizedName
  /** A village or town, rather than one of Batumi's districts. */
  settlement: boolean
  lat: number
  lon: number
  words: string[]
}

export interface PlacesIndex {
  areas: Area[]
  streets: Street[]
  places: Place[]
}

/* Text. */

/**
 * What a search compares: lower case, no accents, «ё» as «е», punctuation as
 * spaces. «№12», «#12» and «12» are one number; «Мцване-Концхи» is two words.
 */
export const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}/]+/gu, ' ')
    .trim()

const wordsOf = (...names: string[]) => [...new Set(names.flatMap((name) => fold(name).split(' ')).filter(Boolean))]

/**
 * The letter after a house number, by script. Batumi writes 12ა where Russian
 * writes 12а and English 12a; the Latin column follows the API's own pole
 * numbers (ა b c d, in order), the Russian one is how the letter sounds.
 */
const HOUSE_LETTERS: Record<string, [ru: string, en: string]> = {
  ა: ['а', 'a'], ბ: ['б', 'b'], გ: ['г', 'c'], დ: ['д', 'd'], ე: ['е', 'e'], ვ: ['в', 'v'], ზ: ['з', 'z'],
  თ: ['т', 't'], ი: ['и', 'i'], კ: ['к', 'k'], ლ: ['л', 'l'], მ: ['м', 'm'], ნ: ['н', 'n'], ო: ['о', 'o'],
  პ: ['п', 'p'], რ: ['р', 'r'], ს: ['с', 's'], ტ: ['т', 't'], უ: ['у', 'u'], ფ: ['ф', 'p'], ქ: ['к', 'k'],
}

/** A typed Latin letter, read as the Cyrillic one the table's key uses. */
const LATIN_TO_KEY: Record<string, string> = {
  a: 'а', b: 'б', c: 'г', d: 'д', e: 'е', v: 'в', z: 'з', t: 'т', i: 'и', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', r: 'р', s: 'с', u: 'у', g: 'г',
}

const numberIn = (number: string, locale: 0 | 1) => number.replace(/[Ⴀ-ჿ]/g, (letter) => HOUSE_LETTERS[letter]?.[locale] ?? letter)

/** One key for 12ა, 12а and 12a, so a number matches whichever keyboard typed it. */
export const numberKey = (number: string) =>
  fold(numberIn(number, 0))
    .replace(/\s+/g, '')
    .replace(/[a-z]/g, (letter) => LATIN_TO_KEY[letter] ?? letter)

/**
 * What a kind of place is called, so a search for «аптека» finds the PSP on the
 * corner, whose name says nothing of the sort. Keyed by the OSM value the table
 * carries; a type with no entry is found by its name alone.
 */
const TYPE_WORDS: Record<string, string> = {
  convenience: 'магазин продукты shop grocery მაღაზია',
  supermarket: 'супермаркет магазин продукты supermarket grocery სუპერმარკეტი მაღაზია',
  mall: 'торговый центр тц mall shopping centre სავაჭრო ცენტრი',
  marketplace: 'рынок базар market ბაზარი',
  hotel: 'отель гостиница hotel სასტუმრო',
  guest_house: 'гостевой дом гостиница guest house საოჯახო სასტუმრო',
  hostel: 'хостел hostel ჰოსტელი',
  apartment: 'апартаменты apartments აპარტამენტები',
  restaurant: 'ресторан restaurant რესტორანი',
  cafe: 'кафе кофейня cafe coffee კაფე ყავა',
  fast_food: 'фастфуд fast food სწრაფი კვება',
  bar: 'бар bar ბარი',
  pub: 'паб бар pub bar პაბი ბარი',
  bakery: 'пекарня bakery საცხობი',
  pastry: 'кондитерская pastry საკონდიტრო',
  ice_cream: 'мороженое ice cream ნაყინი',
  wine: 'вино wine ღვინო',
  pharmacy: 'аптека pharmacy აფთიაქი',
  hospital: 'больница госпиталь hospital საავადმყოფო',
  clinic: 'клиника поликлиника clinic კლინიკა',
  doctors: 'врач doctor ექიმი',
  dentist: 'стоматология стоматолог dentist სტომატოლოგია',
  veterinary: 'ветеринар ветклиника vet ვეტერინარი',
  school: 'школа school სკოლა',
  kindergarten: 'детский сад kindergarten საბავშვო ბაღი',
  university: 'университет university უნივერსიტეტი',
  college: 'колледж college კოლეჯი',
  library: 'библиотека library ბიბლიოთეკა',
  bank: 'банк bank ბანკი',
  bureau_de_change: 'обмен валют currency exchange ვალუტის გადაცვლა',
  fuel: 'заправка азс fuel petrol gas station ბენზინგასამართი',
  car_repair: 'автосервис car repair ავტოსერვისი',
  car_rental: 'прокат автомобилей car rental მანქანის ქირაობა',
  parking: 'парковка parking პარკინგი',
  place_of_worship: 'церковь храм мечеть church mosque ეკლესია ტაძარი მეჩეთი',
  museum: 'музей museum მუზეუმი',
  theatre: 'театр theatre theater თეატრი',
  cinema: 'кинотеатр кино cinema კინოთეატრი',
  attraction: 'достопримечательность attraction ღირსშესანიშნაობა',
  viewpoint: 'смотровая площадка viewpoint გადასახედი',
  zoo: 'зоопарк zoo ზოოპარკი',
  park: 'парк park პარკი',
  garden: 'сад garden ბაღი',
  beach: 'пляж beach პლაჟი',
  stadium: 'стадион stadium სტადიონი',
  fitness_centre: 'фитнес спортзал fitness gym ფიტნესი',
  casino: 'казино casino კაზინო',
  hairdresser: 'парикмахерская hairdresser barber სალონი',
  beauty: 'салон красоты beauty salon სილამაზის სალონი',
  clothes: 'одежда clothes ტანსაცმელი',
  post_office: 'почта post office ფოსტა',
  police: 'полиция police პოლიცია',
  townhall: 'мэрия city hall მერია',
  embassy: 'посольство консульство embassy consulate საელჩო საკონსულო',
  diplomatic: 'посольство консульство embassy consulate საელჩო საკონსულო',
  bus_station: 'автовокзал автостанция bus station ავტოსადგური',
  station: 'вокзал станция railway station სადგური',
  aerodrome: 'аэропорт airport აეროპორტი',
  ferry_terminal: 'морской вокзал порт ferry port პორტი',
}

/* Building the index. */

const named = (ka: string, ru: string, en: string): LocalizedName => ({ ka, ru: ru || ka, en: en || ka })

export function buildIndex(data: PlacesData): PlacesIndex {
  const [originLat, originLon] = data.origin
  const lat = (value: number) => originLat + value / 1e5
  const lon = (value: number) => originLon + value / 1e5

  const areas: Area[] = data.areas.map(([ka, ru, en, y, x, settlement]) => ({
    name: named(ka, ru, en),
    settlement: settlement === 1,
    lat: lat(y),
    lon: lon(x),
    words: searchable(wordsOf(ka, ru, en)),
  }))
  const areaName = (index: number) => areas[index]?.name ?? null

  const streets: Street[] = data.streets.map(([ka, ru, en, area, y, x]) => ({
    name: named(ka, ru, en),
    area: areaName(area),
    lat: lat(y),
    lon: lon(x),
    words: searchable(wordsOf(ka, ru, en)),
    addresses: [],
  }))

  for (const [street, ...rest] of data.addresses) {
    const target = streets[street as number]
    if (!target) continue
    for (let i = 0; i + 2 < rest.length; i += 3) {
      const number = String(rest[i])
      target.addresses.push({ number, key: numberKey(number), lat: lat(rest[i + 1] as number), lon: lon(rest[i + 2] as number) })
    }
  }

  const places: Place[] = data.places.map(([ka, ru, en, kind, area, y, x, street, number, prominent, type]) => ({
    name: named(ka, ru, en),
    kind: kind as PlaceKind,
    area: areaName(area),
    lat: lat(y),
    lon: lon(x),
    street: streets[street] ?? null,
    number,
    prominent: prominent === 1,
    words: searchable(wordsOf(ka, ru, en)),
    typeWords: wordsOf(TYPE_WORDS[type] ?? ''),
  }))

  return { areas, streets, places }
}

/* Presenting a result. */

/** An address the way each language writes one: «Улица Горгиладзе, 45», "45 Gorgiladze Street". */
export const addressName = (street: LocalizedName, number: string): LocalizedName => ({
  ka: `${street.ka} ${number}`,
  ru: `${street.ru}, ${numberIn(number, 0)}`,
  en: `${numberIn(number, 1)} ${street.en}`,
})

const idOf = (kind: PlaceKind, name: LocalizedName, lat: number, lon: number) =>
  `${kind}:${name.ka}@${lat.toFixed(5)},${lon.toFixed(5)}`

const found = (kind: PlaceKind, name: LocalizedName, detail: LocalizedName | null, lat: number, lon: number): FoundPlace => ({
  id: idOf(kind, name, lat, lon),
  kind,
  name,
  detail,
  lat,
  lon,
})

const fromAddress = (street: Street, address: Address) =>
  found('address', addressName(street.name, address.number), street.area, address.lat, address.lon)

const fromStreet = (street: Street) => found('street', street.name, street.area, street.lat, street.lon)

const fromPlace = (place: Place) =>
  found(
    place.kind,
    place.name,
    place.street && place.number ? addressName(place.street.name, place.number) : place.area,
    place.lat,
    place.lon,
  )

const fromArea = (area: Area) => found('area', area.name, null, area.lat, area.lon)

/* Searching. */

/**
 * Words that say what kind of street it is, which people type in every form —
 * «ул.», «пр-т», "st", «ქ.» — and which the table may spell differently or not
 * at all. They count when they match and are forgiven when they do not.
 */
const SOFT = new Set(
  [
    'ул', 'улица', 'пр', 'просп', 'проспект', 'пер', 'переулок', 'ш', 'шоссе', 'бул', 'бульвар', 'пл', 'площадь',
    'туп', 'тупик', 'наб', 'набережная', 'д', 'дом', 'корп', 'г', 'город',
    'st', 'str', 'street', 'ave', 'av', 'avenue', 'rd', 'road', 'ln', 'lane', 'hwy', 'highway', 'sq', 'square',
    'blvd', 'boulevard', 'no', 'house',
    'ქ', 'ქუჩა', 'გამზ', 'გამზირი', 'ჩიხი', 'შეს', 'შესახვევი', 'მოედანი', 'გზატკეცილი', 'სახლი',
  ].map(fold),
)

/** More than this and it stops being a shortlist. */
export const RESULT_LIMIT = 8

export interface SearchOptions {
  limit?: number
  /** Where the reader is, when known: the nearest of forty Spars first. */
  near?: LatLon | null
}

interface Candidate {
  place: FoundPlace
  /** Lower is better: how well the words matched, then what kind of answer it is. */
  score: number
  distance: number
}

/**
 * What kind of answer it is, as a cost added to how well it matched. A village
 * is somewhere people go; a street is what "an address" usually means; a named
 * place that someone has written a Wikipedia article about comes next, and the
 * fortieth café after that. Batumi's districts come last among the names —
 * «Руставели» the district is mostly the avenue's name, borrowed.
 */
const COST = {
  settlement: 0,
  address: 0,
  street: 1,
  /** A lane or dead end off a street, which should not come before the street. */
  sideStreet: 1.25,
  prominent: 1.5,
  place: 2,
  district: 2,
  /** A house number that only starts the one typed: 12 → 12а, 120. */
  addressStartingWith: 3,
  /** The street, when it has no house with the number typed. */
  streetWithoutNumber: 4,
}

const SIDE_STREET = /ჩიხი|შესახვევი|ჩასახვევი/

/** Each missing half of a match costs more than any difference in kind. */
const PER_PARTIAL_WORD = 4

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/**
 * A word as it roughly sounds, in Latin letters. The hotels and chains here are
 * named in Latin script with no Russian name in OSM, and a Russian reader types
 * «Хилтон» or «Шератон»; both sides reduced to this meet at "hilton". Only ever
 * a second chance for a word that did not match as typed.
 */
const sounds = (word: string) =>
  [...word]
    .map((letter) => CYRILLIC_TO_LATIN[letter] ?? letter)
    .join('')
    .replace(/kh/g, 'h')
    .replace(/ph/g, 'f')
    .replace(/c(?!h)/g, 'k')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/y/g, 'i')
    .replace(/j/g, 'dzh')
    .replace(/(.)\1+/g, '$1')

const LATIN_WORD = /^[a-z]/

/** A record's words and their Latin sound-alikes, which are all a search ever compares. */
const searchable = (words: string[]) => [
  ...words,
  ...words.filter((word) => LATIN_WORD.test(word)).map(sounds).filter((word) => !words.includes(word)),
]

/**
 * How well a record's words take the typed ones: null when a word is missing,
 * else how many only matched as the start of a longer word — which is every
 * word still being typed, and is why a whole-word hit ranks first. A word found
 * only among what the place *is* counts the same: «автовокзал» is the name of
 * one place and the type of eight minibus stands, and the one named so is meant.
 */
function matchWords(words: string[], required: string[][], soft: string[], typeWords: string[] = []): number | null {
  let partial = 0
  for (const forms of required) {
    if (forms.some((form) => words.includes(form))) continue
    const starts = (list: string[]) => list.some((word) => forms.some((form) => word.startsWith(form)))
    if (!starts(words) && !starts(typeWords)) return null
    partial++
  }
  for (const term of soft) if (!words.some((word) => word.startsWith(term))) partial += 0.5
  return partial
}

const isNumber = (term: string) => /^\d/.test(term)

/** A typed word, and how it sounds when it is not already a number. */
const formsOf = (term: string) => {
  const sounded = sounds(term)
  return sounded === term ? [term] : [term, sounded]
}

export function searchPlaces(index: PlacesIndex, query: string, options: SearchOptions = {}): FoundPlace[] {
  const terms = fold(query).split(' ').filter(Boolean)
  // A lone letter is a word still being started, or an initial — «З. Горгиладзе».
  const soft = terms.filter((term) => SOFT.has(term) || (term.length === 1 && !isNumber(term)))
  const words = terms.filter((term) => !soft.includes(term) && !isNumber(term)).map(formsOf)
  const numbers = terms.filter(isNumber)
  if (!words.length && !numbers.length) return []

  const near = options.near ?? null
  const candidates: Candidate[] = []
  const add = (place: FoundPlace, score: number) =>
    candidates.push({ place, score, distance: near ? metresBetween(near, place) : 0 })

  for (const area of index.areas) {
    if (numbers.length || !words.length) continue
    const quality = matchWords(area.words, words, soft)
    if (quality !== null) add(fromArea(area), quality * PER_PARTIAL_WORD + (area.settlement ? COST.settlement : COST.district))
  }

  for (const street of index.streets) {
    // A number can be part of the street's own name — «26 Мая», «1-я улица» —
    // and whatever is left over is the house.
    const inName = numbers.filter((number) => street.words.some((word) => word.startsWith(number)))
    const house = numbers.filter((number) => !inName.includes(number))
    if (!words.length && !inName.length) continue
    if (house.length > 1) continue
    const quality = matchWords(street.words, [...words, ...inName.map((number) => [number])], soft)
    if (quality === null) continue
    const base = quality * PER_PARTIAL_WORD

    if (!house.length) {
      add(fromStreet(street), base + (SIDE_STREET.test(street.name.ka) ? COST.sideStreet : COST.street))
      continue
    }

    const key = numberKey(house[0]!)
    const exact = street.addresses.filter((address) => address.key === key)
    const starting = street.addresses.filter((address) => address.key !== key && address.key.startsWith(key))
    exact.forEach((address) => add(fromAddress(street, address), base + COST.address))
    // In house-number order — the table keeps them sorted — rather than by
    // distance, which would put 13/7 before 1а.
    starting
      .slice(0, RESULT_LIMIT)
      .forEach((address, rank) => add(fromAddress(street, address), base + COST.addressStartingWith + rank / 100))
    // A number the table does not have is still that street: better the street
    // than nothing, and the reader can see which number is missing.
    if (!exact.length && !starting.length) add(fromStreet(street), base + COST.streetWithoutNumber)
  }

  for (const place of index.places) {
    const quality = matchWords(place.words, [...words, ...numbers.map((number) => [number])], soft, place.typeWords)
    if (quality !== null) add(fromPlace(place), quality * PER_PARTIAL_WORD + (place.prominent ? COST.prominent : COST.place))
  }

  const seen = new Set<string>()
  return candidates
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.distance - b.distance ||
        a.place.name.ka.length - b.place.name.ka.length ||
        a.place.name.ka.localeCompare(b.place.name.ka),
    )
    .filter(({ place }) => !seen.has(place.id) && !!seen.add(place.id))
    .slice(0, options.limit ?? RESULT_LIMIT)
    .map(({ place }) => place)
}

/**
 * What is at a point someone tapped on the map, if anything is close enough to
 * name it by: a named place or a house, whichever is nearer.
 */
export const NAME_A_POINT_WITHIN = 40

export function placeAt(index: PlacesIndex, point: LatLon): FoundPlace | null {
  let best: FoundPlace | null = null
  let bestDistance = NAME_A_POINT_WITHIN
  const consider = (lat: number, lon: number, make: () => FoundPlace) => {
    // Cheap rejection first: 20,000 haversines per tap is more than it needs.
    if (Math.abs(lat - point.lat) > 0.001 || Math.abs(lon - point.lon) > 0.0015) return
    const distance = metresBetween(point, { lat, lon })
    if (distance < bestDistance) {
      bestDistance = distance
      best = make()
    }
  }
  for (const street of index.streets) {
    for (const address of street.addresses) consider(address.lat, address.lon, () => fromAddress(street, address))
  }
  for (const place of index.places) consider(place.lat, place.lon, () => fromPlace(place))
  return best
}
