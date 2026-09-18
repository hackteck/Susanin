// Regenerates apps/web/src/places/places.data.json — the addresses, streets and
// named places the trip planner's two fields search, from OpenStreetMap.
//
//   node tools/build-places.mjs              # reuses .cache/places/ when present
//   node tools/build-places.mjs --refresh    # asks Overpass again
//
// Node 23.6 or later: it borrows the API's translit.ts, TypeScript and all.
//
// Why a table baked into the app rather than a geocoder behind an API: none of
// the public ones can do this job. Nominatim's usage policy forbids
// search-as-you-type outright; Photon (komoot's public instance) allows it but
// refuses `lang=ru` and returns nothing for a Cyrillic query — measured, not
// assumed: «Руставели 12» came back as a "12th street" in a village. Most of
// this app's readers type Russian. OSM itself carries the translations — name:ru
// on every named street here — so the table has them in all three locales, and
// being a file it also works offline, answers on the first keystroke, and sends
// nobody's search anywhere.
//
// Committed rather than generated on deploy, like names.data.json: Overpass is a
// volunteer service that takes minutes to answer and rate-limits, and a deploy
// that depends on it is a deploy that fails on someone else's bad afternoon.
//
// OUTPUT LICENCE: © OpenStreetMap contributors, ODbL 1.0. The file carries that
// in its metadata and the app shows it on the About page.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCyrillic } from '../apps/api/src/domain/translit.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const REFRESH = argv.includes('--refresh')
const CACHE = resolve(ROOT, '.cache/places')
const OUT = resolve(ROOT, 'apps/web/src/places/places.data.json')
const OVERPASS = 'https://overpass-api.de/api/interpreter'

// The map's own bounds (TransitMap.vue's BOUNDS): a place the map cannot show is
// not a place anyone can be sent to.
const BBOX = { south: 41.5, west: 41.5, north: 41.77, east: 41.78 }
const B = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`

/** Coordinates are stored as whole 1e-5° steps (about a metre) from here. */
const ORIGIN = [BBOX.south, BBOX.west]

const QUERIES = {
  addresses: `[out:json][timeout:240];nwr["addr:housenumber"](${B});out center tags;`,
  streets: `[out:json][timeout:240];way["highway"]["name"](${B});out tags geom;`,
  pois: `[out:json][timeout:240];(${[
    'amenity', 'shop', 'tourism', 'leisure', 'office', 'historic', 'craft', 'healthcare', 'building', 'club', 'sport',
  ]
    .map((key) => `nwr["name"]["${key}"](${B});`)
    .join('')}nwr["name"]["railway"~"^(station|halt)$"](${B});nwr["name"]["aeroway"~"^(aerodrome|terminal)$"](${B});nwr["name"]["public_transport"="station"](${B});nwr["name"]["man_made"~"^(lighthouse|tower|pier|breakwater)$"](${B});nwr["name"]["natural"~"^(beach|peak|cape)$"](${B});nwr["name"]["landuse"~"^(retail|commercial)$"](${B}););out center tags;`,
  localities: `[out:json][timeout:180];node["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood)$"](${B});out center tags;`,
  boundaries: `[out:json][timeout:240];relation["boundary"="administrative"]["admin_level"~"^(6|8|10)$"](${B});out geom;`,
}

// ---------------------------------------------------------------- harvest ---

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function overpass(name, ql) {
  // Overpass answers an unidentified client with 406, and a busy one with 429 or
  // 504 — both of which mean "later", not "never".
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'susanin-build-places' },
      body: new URLSearchParams({ data: ql }),
    })
    if (res.ok) return res.json()
    if (attempt >= 4 || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Overpass ${res.status} for ${name}`)
    process.stderr.write(`overpass ${name}: ${res.status}, retrying\n`)
    await sleep(30_000 * attempt)
  }
}

async function harvest() {
  mkdirSync(CACHE, { recursive: true })
  const out = {}
  for (const [name, ql] of Object.entries(QUERIES)) {
    const path = resolve(CACHE, `${name}.json`)
    if (!REFRESH && existsSync(path)) {
      out[name] = JSON.parse(readFileSync(path, 'utf8'))
    } else {
      out[name] = await overpass(name, ql)
      writeFileSync(path, JSON.stringify(out[name]))
    }
    process.stderr.write(`${name}: ${out[name].elements.length} elements\n`)
  }
  return out
}

// ------------------------------------------------------------------ text ---

const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯]/
const ws = (value) => (value == null ? undefined : String(value).normalize('NFC').replace(/\s+/g, ' ').trim() || undefined)

// Georgian's national romanisation, without the apostrophes that mark ejectives:
// a reader matching a sign needs "Tsikhisdziri", not "Ts'ikhisdziri".
const LATIN = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n',
  ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch',
  ც: 'ts', ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
}
// The street types, which trail in English as they do in Georgian.
const LATIN_NOUNS = { ქუჩა: 'Street', გამზირი: 'Avenue', გზატკეცილი: 'Highway', მოედანი: 'Square', ჩიხი: 'Lane', შესახვევი: 'Lane', ხეივანი: 'Alley' }

const capitalise = (word) => (word ? word[0].toUpperCase() + word.slice(1) : word)

/** "მე-2" is "2nd" and "1-ლი" is "1st" — Georgian writes the first one differently. */
const GEORGIAN_ORDINAL = /^(?:მე[-–—]\s*(\d+)|(1)[-–—]ლი)$/
const englishOrdinal = (n) => {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`
}

/**
 * translit.ts knows "მე-2" but not "1-ლი", and «переулок» as ჩიხი but not as
 * შესახვევი — so both are spelled the way it knows before it sees them.
 */
const cyrillic = (georgian) =>
  toCyrillic(
    georgian
      .replace(/(^|\s)1[-–—]ლი(?=\s|$)/g, '$1მე-1')
      .replace(/(^|\s)(?:შესახვევი|ჩასახვევი|შეს\.?)(?=\s|$)/g, '$1ჩიხი'),
  )

/** Georgian → Latin, for the names OSM has no English for. The mirror of translit.ts. */
function toLatin(georgian) {
  if (!GEORGIAN.test(georgian)) return georgian
  const tokens = georgian.split(' ')
  return tokens
    .map((token, index) => {
      if (LATIN_NOUNS[token]) return LATIN_NOUNS[token]
      const ordinal = GEORGIAN_ORDINAL.exec(token)
      if (ordinal) return englishOrdinal(Number(ordinal[1] ?? ordinal[2]))
      // "ხალვაშის ქუჩა" is Khalvashi's street: the genitive goes with the noun.
      const next = tokens[index + 1]
      const stem = next && LATIN_NOUNS[next] && token.endsWith('ის') ? token.slice(0, -1) : token
      return capitalise([...stem].map((char) => LATIN[char] ?? char).join(''))
    })
    .join(' ')
}

const majority = (values) => {
  const counts = new Map()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
}

/**
 * A place's name in the three locales. Georgian is what is on the sign; Russian
 * and English are OSM's translations where it has them. Without one, a name
 * that is not Georgian script — a brand, a hotel — is already readable; after
 * that, an English translation tells a Russian reader more than a Cyrillic
 * sounding-out of words they do not know, and the sounding-out comes last.
 */
/** A "translation" still in Georgian script is a mapper's slip, not a translation. */
const translation = (value) => (value && !GEORGIAN.test(value) ? value : undefined)

function placeNames(tags) {
  const name = ws(tags.name)
  const ka = ws(tags['name:ka']) || name
  const readable = translation(name)
  const english = translation(ws(tags['name:en']))
  const en = english || readable || toLatin(ka)
  const ru = translation(ws(tags['name:ru'])) || readable || english || cyrillic(ka)
  return { ka, ru, en }
}

/** Street names translate rather than sound out: "Улица Халваши", not "Khalvashi Street". */
const streetNames = (ka, ru, en) => ({ ka, ru: ru || cyrillic(ka), en: en || toLatin(ka) })

/*
 * One street, two spellings. An address names its street in `addr:street`, the
 * road names itself in `name`, and different people typed them: measured on the
 * first build, 352 street names on 3,591 addresses matched no road at all —
 * «შარაშიძე მიხეილის ქუჩა» on the houses, «მიხეილ შარაშიძის ქუჩა» on the road;
 * «ადლიის» against «ადლიას»; «მე-3 შეს» against «III შესახვევი». Unmatched, each
 * became a second street in the search, and one with a sounded-out Russian name
 * («Улица Шарашидзе Михеили») beside the real one. Since the address is also a
 * place, the comparison only has to tell apart the few streets *near it*, which
 * is what makes a loose comparison safe.
 */
const ABBREVIATIONS = {
  ქ: 'ქუჩა', ქუჩ: 'ქუჩა', გამზ: 'გამზირი', შეს: 'შესახვევი', ჩას: 'შესახვევი', ჩასახვევი: 'შესახვევი',
  წმ: 'წმინდა', გენ: 'გენერალ', გენერალი: 'გენერალ', აკად: 'აკადემიკოს',
}
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 }
const STREET_TYPES = new Set(['ქუჩა', 'გამზირი', 'ჩიხი', 'შესახვევი', 'მოედანი', 'გზატკეცილი', 'ხეივანი', 'აღმართი', 'სანაპირო'])
/** "ქუჩის" is "of the street" — a lane named after its street carries it, and it names nothing. */
const FILLER = new Set(['ქუჩის', 'გამზირის', 'და'])

// The genitive and dative endings are what differ between two spellings of one
// name; a comparison, not morphology.
const stem = (word) => {
  if (word.length > 4 && /(ის|ას|ეს)$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && /[იესა]$/.test(word)) return word.slice(0, -1)
  return word
}

function streetKey(name) {
  let type = null
  const numbers = []
  const stems = []
  for (const raw of name.toLowerCase().replace(/[.,()«»"']/g, ' ').split(/\s+/)) {
    if (!raw) continue
    const word = ABBREVIATIONS[raw] ?? raw
    const number = ROMAN[word] ?? /^(?:მე-?)?(\d+)(?:-?(?:ლი|ე|ს))?$/.exec(word)?.[1]
    if (number !== undefined) numbers.push(Number(number))
    else if (STREET_TYPES.has(word)) type = word
    else if (!FILLER.has(word)) stems.push(stem(word))
  }
  return { type, numbers: numbers.sort((a, b) => a - b).join(','), stems: stems.sort() }
}

const editDistance = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

const close = (x, y) => x === y || (Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= 2)
const covers = (a, b) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length > 0 && short.every((word) => long.some((other) => close(word, other)))
}

/** Same kind of street, same number, and the same words give or take an ending — or a first name left off. */
// A name with no street type at all — «შარაშიძე მიხეილის» — is taken to mean
// the street itself, never one of its lanes.
const sameType = (a, b) => a === b || ((a === null || b === null) && ["ქუჩა", "გამზირი", null].includes(a ?? b))
const sameStreet = (a, b) => sameType(a.type, b.type) && a.numbers === b.numbers && covers(a.stems, b.stems)

/** The words of an English or Russian street name, less the word for "street". */
const TRANSLATED_TYPES = new Set([
  'street', 'st', 'str', 'avenue', 'ave', 'av', 'lane', 'ln', 'road', 'rd', 'highway', 'hwy', 'square', 'sq', 'alley',
  'улица', 'ул', 'проспект', 'пр', 'просп', 'переулок', 'пер', 'тупик', 'туп', 'шоссе', 'площадь', 'пл', 'проезд',
])
const translatedWords = (name) =>
  (name ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !TRANSLATED_TYPES.has(word))

const numbersIn = (words) => words.filter((word) => /^\d/.test(word)).join(',')
const sameWords = (a, b) => numbersIn(a) === numbersIn(b) && covers(a.filter((w) => !/^\d/.test(w)), b.filter((w) => !/^\d/.test(w)))

/** "12 ა" and "12ა" are one house; anything that is not a house number is dropped. */
const HOUSE_NUMBER = /^\d+[\p{L}]?(?:\s*[/-]\s*\d+[\p{L}]?)*$/u
const houseNumber = (value) => {
  const text = ws(value)?.replace(/(\d)\s+(\p{L})$/u, '$1$2').replace(/\s*([/-])\s*/g, '$1')
  return text && HOUSE_NUMBER.test(text) ? text : undefined
}

// -------------------------------------------------------------- geometry ---

const RAD = Math.PI / 180
const metres = (a, b) => {
  const x = (b.lon - a.lon) * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD)
  const y = (b.lat - a.lat) * RAD
  return Math.hypot(x, y) * 6_371_000
}

const pointOf = (element) =>
  element.center ? { lat: element.center.lat, lon: element.center.lon } : element.lat != null ? { lat: element.lat, lon: element.lon } : null

const inside = (box, p) => p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east

/**
 * An administrative area as a bag of edges. Even-odd crossing counts do not care
 * what order the edges come in, so the relation's member ways never have to be
 * stitched into rings — which is where boundary code usually goes wrong.
 */
function polygonOf(relation) {
  const edges = []
  let label = null
  for (const member of relation.members ?? []) {
    if (member.type === 'node' && (member.role === 'label' || member.role === 'admin_centre') && member.lat != null) {
      if (!label || member.role === 'label') label = { lat: member.lat, lon: member.lon }
    }
    if (member.type !== 'way' || !member.geometry || (member.role !== 'outer' && member.role !== 'inner')) continue
    for (let i = 1; i < member.geometry.length; i++) edges.push([member.geometry[i - 1], member.geometry[i]])
  }
  if (!edges.length) return null
  const lats = edges.flatMap(([a, b]) => [a.lat, b.lat])
  const lons = edges.flatMap(([a, b]) => [a.lon, b.lon])
  const box = { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) }
  return { edges, box, label: label ?? { lat: (box.south + box.north) / 2, lon: (box.west + box.east) / 2 } }
}

function contains(polygon, p) {
  if (!inside(polygon.box, p)) return false
  let crossings = 0
  for (const [a, b] of polygon.edges) {
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) crossings++
  }
  return crossings % 2 === 1
}

// ----------------------------------------------------------------- build ---

const raw = await harvest()
const stats = {}

/* Localities: the "where" line under a result, and searchable in their own right. */

const areas = []
const areaByKa = new Map()
const addArea = (tags, point, settlement) => {
  const names = placeNames(tags)
  const known = areaByKa.get(names.ka)
  if (known !== undefined && metres(areas[known].point, point) < 5000) {
    // Kakhaberi is both a district and a quarter; the place people go to wins.
    areas[known].settlement ||= settlement
    return known
  }
  areas.push({ names, point, settlement })
  areaByKa.set(names.ka, areas.length - 1)
  return areas.length - 1
}

const boundaries = raw.boundaries.elements
  .filter((element) => element.tags?.name)
  .map((element) => ({ level: Number(element.tags.admin_level), tags: element.tags, polygon: polygonOf(element) }))
  .filter((entry) => entry.polygon)

// Batumi's districts first — a district is what tells two Spars apart — then
// the towns that have a boundary, and a village by its nearest centre after
// that, because villages here are mapped as points, not areas.
const districts = boundaries.filter((entry) => entry.level === 10)
const towns = boundaries.filter((entry) => entry.level === 8)
const municipalities = boundaries.filter((entry) => entry.level === 6)

for (const entry of districts) entry.area = addArea(entry.tags, entry.polygon.label, false)
for (const entry of towns) entry.area = addArea(entry.tags, entry.polygon.label, true)

const villages = raw.localities.elements
  .filter((element) => element.tags?.name && element.tags.place !== 'city' && inside(BBOX, pointOf(element)))
  .map((element) => ({ point: pointOf(element), area: addArea(element.tags, pointOf(element), true) }))

/** How far a village's centre speaks for the houses around it. */
const VILLAGE_REACH = 2500

const localityCache = new Map()
function localityOf(point) {
  const key = `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`
  if (localityCache.has(key)) return localityCache.get(key)
  let found = -1
  const district = districts.find((entry) => contains(entry.polygon, point)) ?? towns.find((entry) => contains(entry.polygon, point))
  if (district) {
    found = district.area
  } else {
    let best = VILLAGE_REACH
    for (const village of villages) {
      const distance = metres(village.point, point)
      if (distance < best) {
        best = distance
        found = village.area
      }
    }
    if (found < 0) {
      const municipality = municipalities.find((entry) => contains(entry.polygon, point))
      if (municipality) found = municipality.area ??= addArea(municipality.tags, municipality.polygon.label, false)
    }
  }
  localityCache.set(key, found)
  return found
}

/* Streets: every named way, grouped by name and then by being near each other. */

const ROADS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'pedestrian', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
])

const waysByName = new Map()
for (const element of raw.streets.elements) {
  const tags = element.tags ?? {}
  if (!ROADS.has(tags.highway) || !element.geometry?.length) continue
  const ka = ws(tags['name:ka']) || ws(tags.name)
  if (!ka) continue
  const list = waysByName.get(ka) ?? []
  list.push({ tags, points: element.geometry.filter((p) => inside(BBOX, p)) })
  waysByName.set(ka, list)
}

/**
 * Ways named alike belong to one street when they come within this of each
 * other. "1-ლი ქუჩა" — First Street — exists in a dozen villages, and each is
 * its own street; a long avenue split into forty ways is one.
 */
const SAME_STREET_METRES = 250

const streets = []
const streetsByKa = new Map()

function addStreet(names, points) {
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const lon = points.reduce((sum, p) => sum + p.lon, 0) / points.length
  // The vertex nearest the middle, so the point is on the street itself — the
  // centre of a curved street is often in someone's garden.
  const middle = points.reduce((best, p) => (metres(p, { lat, lon }) < metres(best, { lat, lon }) ? p : best), points[0])
  const street = { names, point: middle, points, area: localityOf(middle), addresses: [] }
  streets.push(street)
  const list = streetsByKa.get(names.ka) ?? []
  list.push(street)
  streetsByKa.set(names.ka, list)
  return street
}

const nearAny = (a, b, reach) => {
  for (const p of a) for (const q of b) if (Math.abs(p.lat - q.lat) < 0.004 && metres(p, q) < reach) return true
  return false
}

for (const [ka, ways] of waysByName) {
  ways.forEach((way) => (way.group = way))
  const root = (way) => (way.group === way ? way : (way.group = root(way.group)))
  for (let i = 0; i < ways.length; i++) {
    for (let j = i + 1; j < ways.length; j++) {
      if (root(ways[i]) !== root(ways[j]) && nearAny(ways[i].points, ways[j].points, SAME_STREET_METRES)) {
        root(ways[j]).group = root(ways[i])
      }
    }
  }
  const groups = new Map()
  for (const way of ways) {
    if (!way.points.length) continue
    const list = groups.get(root(way)) ?? []
    list.push(way)
    groups.set(root(way), list)
  }
  for (const group of groups.values()) {
    const names = streetNames(
      ka,
      majority(group.map((way) => translation(ws(way.tags['name:ru'])))),
      majority(group.map((way) => translation(ws(way.tags['name:en'])))),
    )
    // Every vertex is too many to keep for matching addresses; every tenth, plus
    // each way's ends, is still a point every hundred metres or so.
    const points = group.flatMap((way) => way.points.filter((_, index) => index % 10 === 0 || index === way.points.length - 1))
    addStreet(names, points)
  }
}
stats.streetsFromWays = streets.length

/** An address's street is the nearest one of that name; past this it is another. */
const ADDRESS_REACH = 1500
/** A differently spelled street has to be this close to count as the same one. */
const SPELLING_REACH = 400

const fromWays = streets.slice()
const keyOf = new Map(fromWays.map((street) => [street, streetKey(street.names.ka)]))

const distanceTo = (street, point) => {
  let best = Infinity
  for (const p of street.points) best = Math.min(best, metres(p, point))
  return best
}

const nearest = (candidates, point, reach) => {
  let best = null
  let bestDistance = reach
  for (const street of candidates) {
    const distance = distanceTo(street, point)
    if (distance < bestDistance) {
      bestDistance = distance
      best = street
    }
  }
  return best
}

const synthetic = new Set()

const streetFor = (ka, point, translations) => {
  const exact = nearest(streetsByKa.get(ka) ?? [], point, ADDRESS_REACH)
  if (exact) {
    if (synthetic.has(exact)) exact.points.push(point)
    return exact
  }

  const key = streetKey(ka)
  const respelled = nearest(
    fromWays.filter((street) => sameStreet(key, keyOf.get(street))),
    point,
    SPELLING_REACH,
  )
  if (respelled) {
    stats.respelledAddresses = (stats.respelledAddresses ?? 0) + 1
    return respelled
  }

  // Some houses name their street in English or Russian — "Zurab Gorgiladze
  // Street" — and those are compared with the road's own English or Russian.
  if (!GEORGIAN.test(ka)) {
    const locale = /[а-яё]/i.test(ka) ? 'ru' : 'en'
    const words = translatedWords(ka)
    const translated = nearest(
      fromWays.filter((street) => sameWords(words, translatedWords(street.names[locale]))),
      point,
      SPELLING_REACH,
    )
    if (translated) {
      stats.respelledAddresses = (stats.respelledAddresses ?? 0) + 1
      return translated
    }
  }

  // A street the addresses name and no road does — a lane nobody has drawn yet.
  // Still a real address.
  const street = addStreet(streetNames(ka, translations.ru, translations.en), [point])
  synthetic.add(street)
  return street
}

/* Addresses. */

const PREFER = { way: 0, relation: 1, node: 2 }
const addressElements = raw.addresses.elements
  .filter((element) => pointOf(element) && inside(BBOX, pointOf(element)))
  // A building's outline before a node on its wall: the entrance node is at the
  // edge, the building's centre is where the house is.
  .sort((a, b) => PREFER[a.type] - PREFER[b.type] || a.id - b.id)

stats.addressObjects = addressElements.length
stats.addressesDropped = 0
const translationsByStreet = new Map()
for (const element of addressElements) {
  const ka = ws(element.tags['addr:street']) || ws(element.tags['addr:place'])
  if (!ka) continue
  const entry = translationsByStreet.get(ka) ?? { ru: [], en: [] }
  entry.ru.push(translation(ws(element.tags['addr:street:ru'])))
  entry.en.push(translation(ws(element.tags['addr:street:en'])))
  translationsByStreet.set(ka, entry)
}

/** Two tags of one house within this of each other are the same house. */
const SAME_HOUSE_METRES = 120

for (const element of addressElements) {
  const ka = ws(element.tags['addr:street']) || ws(element.tags['addr:place'])
  const number = houseNumber(element.tags['addr:housenumber'])
  // A postcode in the street is a whole address typed into the street's field.
  if (!ka || !number || /d{4}/.test(ka)) {
    stats.addressesDropped++
    continue
  }
  const point = pointOf(element)
  const translations = translationsByStreet.get(ka)
  const street = streetFor(ka, point, { ru: majority(translations.ru), en: majority(translations.en) })
  const key = number.toLowerCase()
  if (street.addresses.some((address) => address.key === key && metres(address.point, point) < SAME_HOUSE_METRES)) continue
  street.addresses.push({ number, key, point })
}

// A street known only from its houses was placed at the first house found; the
// one nearest the middle of all of them is a better "this street".
for (const street of synthetic) {
  const lat = street.points.reduce((sum, p) => sum + p.lat, 0) / street.points.length
  const lon = street.points.reduce((sum, p) => sum + p.lon, 0) / street.points.length
  street.point = street.points.reduce((best, p) => (metres(p, { lat, lon }) < metres(best, { lat, lon }) ? p : best))
  street.area = localityOf(street.point)
}
stats.streetsFromAddressesOnly = synthetic.size

/* Named places. */

const SKIP_AMENITY = new Set([
  'atm', 'vending_machine', 'parking_space', 'parking_entrance', 'bench', 'waste_basket', 'waste_disposal', 'recycling',
  'toilets', 'drinking_water', 'telephone', 'post_box', 'bicycle_parking', 'charging_station', 'shelter', 'clock',
  'water_point', 'fountain', 'grit_bin', 'smoking_area', 'give_box', 'motorcycle_parking', 'loading_dock', 'bbq',
  'device_charging_station', 'photo_booth', 'payment_terminal', 'ticket_validator', 'bus_stop',
])

/**
 * One word per kind of place, which the app turns into an icon. Coarse on
 * purpose: the icon only has to say "a hotel" or "a pharmacy" at a glance.
 */
function kindOf(tags) {
  const { amenity, shop, tourism, leisure, historic, office, aeroway, railway } = tags
  if (aeroway || railway || tags.public_transport === 'station' || ['bus_station', 'ferry_terminal'].includes(amenity)) return 'transport'
  if (['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'ice_cream', 'biergarten'].includes(amenity)) return 'food'
  if (['hotel', 'hostel', 'guest_house', 'apartment', 'motel', 'camp_site', 'chalet'].includes(tourism)) return 'lodging'
  if (['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'veterinary'].includes(amenity) || tags.healthcare) return 'health'
  if (['school', 'university', 'college', 'kindergarten', 'library', 'language_school', 'music_school'].includes(amenity)) return 'education'
  if (amenity === 'place_of_worship') return 'worship'
  if (['bank', 'bureau_de_change', 'money_transfer'].includes(amenity)) return 'money'
  if (tourism || historic || ['theatre', 'cinema', 'arts_centre'].includes(amenity) || ['lighthouse', 'tower'].includes(tags.man_made)) return 'sight'
  if (leisure || tags.natural || tags.sport || tags.club) return 'leisure'
  if (shop || amenity === 'marketplace' || tags.landuse === 'retail' || tags.landuse === 'commercial') return 'shop'
  if (office || ['townhall', 'police', 'post_office', 'courthouse', 'embassy', 'fire_station', 'public_building'].includes(amenity)) return 'office'
  if (amenity === 'fuel' || amenity === 'car_wash' || amenity === 'car_rental' || amenity === 'parking') return 'car'
  return 'building'
}

/** Which tag says what a place is, most specific first. */
const TYPE_KEYS = ['amenity', 'shop', 'tourism', 'healthcare', 'leisure', 'historic', 'railway', 'aeroway', 'natural', 'office']

const pois = []
const poisByKa = new Map()
const poiElements = raw.pois.elements
  .filter((element) => element.tags?.name && pointOf(element) && inside(BBOX, pointOf(element)))
  // What a place *is* before what it is housed in: a shop tagged on a node wins
  // over the named building around it.
  .sort((a, b) => (kindOf(a.tags) === 'building') - (kindOf(b.tags) === 'building') || PREFER[a.type] - PREFER[b.type] || a.id - b.id)

stats.poiObjects = poiElements.length
for (const element of poiElements) {
  const tags = element.tags
  if (tags.highway || SKIP_AMENITY.has(tags.amenity) || ['platform', 'stop_position'].includes(tags.public_transport)) continue
  if (['garage', 'garages', 'shed', 'roof', 'construction', 'ruins'].includes(tags.building) && kindOf(tags) === 'building') continue
  const names = placeNames(tags)
  // A "name" that is only a number or a code is a label, not something anyone searches for.
  if (!/\p{L}{2}/u.test(names.ka)) continue
  const point = pointOf(element)
  const twins = poisByKa.get(names.ka) ?? []
  if (twins.some((twin) => metres(twin.point, point) < 150)) continue

  const streetKa = ws(tags['addr:street'])
  const number = houseNumber(tags['addr:housenumber'])
  const street =
    streetKa && number && !/\d{4}/.test(streetKa)
      ? streetFor(streetKa, point, { ru: ws(tags['addr:street:ru']), en: ws(tags['addr:street:en']) })
      : null
  const poi = {
    names,
    kind: kindOf(tags),
    point,
    area: localityOf(point),
    street,
    number: street ? number : '',
    // Something someone has written a Wikipedia article about, or a way into
    // or out of the city, outranks the fortieth Spar.
    prominent: !!(tags.wikidata || tags.wikipedia) || kindOf(tags) === 'transport',
    // What OSM says it is — "pharmacy", "hotel" — so «аптека» finds the PSP on
    // the corner, whose name says nothing of the sort. The app owns the words.
    type: TYPE_KEYS.map((key) => tags[key]).find((value) => value && value !== 'yes') ?? '',
  }
  pois.push(poi)
  twins.push(poi)
  poisByKa.set(names.ka, twins)
}

// ---------------------------------------------------------------- output ---

const coord = (p) => [Math.round((p.lat - ORIGIN[0]) * 1e5), Math.round((p.lon - ORIGIN[1]) * 1e5)]
/** Russian and English are left empty where they are the Georgian — the common case for a brand. */
const localised = ({ ka, ru, en }) => [ka, ru === ka ? '' : ru, en === ka ? '' : en]

const byKa = (a, b) => a.names.ka.localeCompare(b.names.ka, 'ka') || a.point.lat - b.point.lat
const naturalNumber = (a, b) => parseInt(a.number, 10) - parseInt(b.number, 10) || a.number.localeCompare(b.number)

// Sorted, so a re-run changes only the lines OSM changed.
const areaOrder = areas.map((_, index) => index).sort((a, b) => byKa(areas[a], areas[b]))
const areaIndex = new Map(areaOrder.map((old, index) => [old, index]))
const area = (old) => (old >= 0 ? areaIndex.get(old) : -1)

streets.sort(byKa)
const streetIndex = new Map(streets.map((street, index) => [street, index]))
pois.sort(byKa)

const lines = (rows) => `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]`

const counts = {
  areas: areas.length,
  streets: streets.length,
  addresses: streets.reduce((sum, street) => sum + street.addresses.length, 0),
  places: pois.length,
}

const meta = {
  generator: 'tools/build-places.mjs',
  source: 'OpenStreetMap via Overpass API',
  license: 'ODbL 1.0',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors',
  osmBase: raw.addresses.osm3s?.timestamp_osm_base ?? null,
  bbox: BBOX,
  counts,
  stats,
}

const body = [
  `"meta": ${JSON.stringify(meta)}`,
  `"origin": ${JSON.stringify(ORIGIN)}`,
  // [ka, ru, en, lat, lon, settlement] — a village or town, rather than a district of Batumi
  `"areas": ${lines(areaOrder.map((old) => [...localised(areas[old].names), ...coord(areas[old].point), areas[old].settlement ? 1 : 0]))}`,
  // [ka, ru, en, area, lat, lon]
  `"streets": ${lines(streets.map((street) => [...localised(street.names), area(street.area), ...coord(street.point)]))}`,
  // One line per street: [street, number, lat, lon, number, lat, lon, …]
  `"addresses": ${lines(
    streets
      .filter((street) => street.addresses.length)
      .map((street) => [
        streetIndex.get(street),
        ...street.addresses.sort(naturalNumber).flatMap((address) => [address.number, ...coord(address.point)]),
      ]),
  )}`,
  // [ka, ru, en, kind, area, lat, lon, street, number, prominent, type]
  `"places": ${lines(
    pois.map((poi) => [
      ...localised(poi.names),
      poi.kind,
      area(poi.area),
      ...coord(poi.point),
      poi.street ? streetIndex.get(poi.street) : -1,
      poi.number,
      poi.prominent ? 1 : 0,
      poi.type,
    ]),
  )}`,
].join(',\n')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `{\n${body}\n}\n`)
process.stderr.write(`wrote ${OUT}\n${JSON.stringify({ counts, stats }, null, 1)}\n`)
