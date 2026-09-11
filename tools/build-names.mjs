// Regenerates apps/api/src/domain/names.data.json — the Russian and English
// stop names the API serves, taken from OpenStreetMap instead of sounded out.
//
// Why a build step rather than a checked-in blob: the table is derived data.
// OSM gains name:ru every month and the feed occasionally respells a stop, so
// whoever comes next needs to be able to re-run this and read the diff, not
// guess which of 175 lines someone typed by hand.
//
//   node tools/build-names.mjs                      # live Overpass + live feed
//   node tools/build-names.mjs --osm <osm-names.json> --dataset <getDbData.json>
//   node tools/build-names.mjs --report <path>      # also dump a review table
//
// Overpass is rate-limited and slow (about four minutes for the four queries),
// so the cache flags exist to let a reviewer re-run the *matching* — which is
// where all the judgement is — without hammering a volunteer service.
//
// OUTPUT LICENCE: the names are © OpenStreetMap contributors, ODbL 1.0. The
// generated file carries that in its own metadata and the app must show it.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const OUT = resolve(ROOT, flag('out') ?? 'apps/api/src/domain/names.data.json')
const REPORT = flag('report')
const OVERPASS = 'https://overpass-api.de/api/interpreter'
const UPSTREAM = process.env.UPSTREAM_BASE ?? 'https://thetamaps.site:54321'

// Wider than the transit box (41.55,41.5,41.75,41.78) so a stop at the edge of
// the network still finds the street it stands on.
const BBOX = { south: 41.52, west: 41.48, north: 41.78, east: 41.8 }
const B = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`

// Four queries rather than one union: Overpass times out on the combined form
// over this box, and a failure in one of them is then legible.
const QUERIES = {
  highways: `[out:json][timeout:180];way["name"]["highway"](${B});out tags;`,
  ways: `[out:json][timeout:240];way["name"][!highway](${B});out tags;`,
  nodes: `[out:json][timeout:240];node["name"](${B});out tags;`,
  relations: `[out:json][timeout:240];relation["name"](${B});out tags;`,
}

// ---------------------------------------------------------------- harvest ---

const ROADS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'pedestrian', 'road', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link',
])
const KIND_KEYS = [
  'highway', 'public_transport', 'railway', 'amenity', 'tourism', 'leisure', 'shop', 'historic',
  'natural', 'waterway', 'landuse', 'place', 'building', 'office', 'man_made', 'boundary',
  'aeroway', 'emergency', 'craft', 'military', 'route',
]

const ws = (v) => (v == null ? undefined : String(v).normalize('NFC').replace(/\s+/g, ' ').trim() || undefined)
const isKa = (v) => !!v && /[Ⴀ-ჿ]/.test(v)

const kindOf = (tags) => {
  if (tags.highway && ROADS.has(tags.highway)) return 'street'
  for (const key of KIND_KEYS) if (tags[key] && tags[key] !== 'no') return `${key}=${tags[key]}`
  return 'other'
}

async function overpass(ql) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'susanin-build-names' },
    body: new URLSearchParams({ data: ql }),
  })
  if (!res.ok) throw new Error(`Overpass ${res.status} for ${ql.slice(0, 60)}…`)
  return res.json()
}

/** ka → { ru, en, kind, count } over every named OSM object in the box. */
async function harvestOsm(cachePath) {
  if (cachePath) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
    return { byKa: cached.byKa, meta: { ...cached.meta, reusedFrom: cachePath } }
  }

  const elements = []
  for (const [name, ql] of Object.entries(QUERIES)) {
    const body = await overpass(ql)
    for (const el of body.elements ?? []) if (el.tags?.name) elements.push(el.tags)
    process.stderr.write(`overpass ${name}: ${body.elements?.length ?? 0} elements\n`)
  }

  const byKa = new Map()
  let noKa = 0
  for (const tags of elements) {
    const ka = ws(tags['name:ka']) || (isKa(ws(tags.name)) ? ws(tags.name) : undefined)
    if (!ka) {
      noKa++
      continue
    }
    let rec = byKa.get(ka)
    if (!rec) byKa.set(ka, (rec = { ru: new Map(), en: new Map(), kind: new Map(), count: 0 }))
    rec.count++
    const bump = (m, v) => v && m.set(v, (m.get(v) ?? 0) + 1)
    bump(rec.ru, ws(tags['name:ru']))
    bump(rec.en, ws(tags['name:en']))
    bump(rec.kind, kindOf(tags))
  }

  // One Georgian name can be tagged on a way, its stop and its relation; keep
  // the spelling the most objects agree on rather than whichever came first.
  const top = (m) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null

  const out = {}
  for (const [ka, rec] of [...byKa].sort((a, b) => a[0].localeCompare(b[0], 'ka'))) {
    out[ka] = { ru: top(rec.ru), en: top(rec.en), kind: top(rec.kind), count: rec.count }
  }
  return {
    byKa: out,
    meta: {
      harvestedAt: new Date().toISOString(),
      endpoint: OVERPASS,
      rawElements: elements.length,
      elementsWithoutGeorgianName: noKa,
      distinctGeorgianNames: Object.keys(out).length,
    },
  }
}

// ------------------------------------------------------------- feed names ---

// Mirrors apps/api/src/domain/network.ts: the same trailing "№" with no number
// behind it, and the same pole code repeated into the name.
const cleanFeed = (value) =>
  String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[№#]\s*$/, '')
    .trim()

const stripCode = (name, code) => (name.startsWith(`${code} `) ? name.slice(String(code).length + 1).trim() : name)

async function feedNames(cachePath) {
  const raw = cachePath
    ? JSON.parse(readFileSync(cachePath, 'utf8'))
    : await fetch(`${UPSTREAM}/api/getDbData`).then((r) => {
        if (!r.ok) throw new Error(`upstream ${r.status}`)
        return r.json()
      })

  const poles = new Map()
  for (const stop of Object.values(raw.data.busStops)) {
    const ka = stripCode(cleanFeed(stop.BusStopNameKA), stop.BusStopNumber)
    const en = stripCode(cleanFeed(stop.BusStopNameEN), stop.BusStopNumber)
    const name = ka || en
    const rec = poles.get(name) ?? { ka: name, en, poles: 0 }
    rec.poles++
    poles.set(name, rec)
  }
  return [...poles.values()]
}

// -------------------------------------------------------------- the table ---

// The pole's house number is the half of the name that finds the pole, so it
// never goes through the matcher — it comes off before the lookup and goes
// back on after. Measured over the 426 distinct names: 307 carry one, always
// at the end, never mid-string, and "№" always introduces it. Two names end in
// a bare number that is *not* a house number ("თამარის დასახლება 331", and the
// feed's own placeholder "endstop route 3"), which is why a bare trailing
// number is left alone.
//
// The tail is deliberately narrow — digits, an optional "/n" or "-n", an
// optional single letter. One stop writes "№1(ავტოსადგური)", and letting the
// tail swallow that would carry Georgian into the Russian label.
const HOUSE_NUMBER = /\s*[№#]+\s*(\d+(?:[/–-]\d+)*[ა-ჰA-Za-z]?)\.?\s*$/

const nameKey = (value) => String(value).normalize('NFC').replace(/#/g, '№').replace(/\s+/g, ' ').trim()
const splitHouseNumber = (value) => {
  const key = nameKey(value)
  const m = HOUSE_NUMBER.exec(key)
  return m ? { base: key.slice(0, m.index).trim(), number: m[1] } : { base: key, number: null }
}

// ---- matching -------------------------------------------------------------
// Ported from the six-angle cross-check that produced the review sheet; the
// tiers are kept because they are what says how much of this is measurement
// and how much is inference.

const PUNCT = /[^\p{L}\p{N}\s-]/gu
const DASHES = /[‐-―]/g
const TRAILING_NO = /\s+\d+[Ⴀ-ჿa-zA-Z]*$/

const norm = (s) =>
  splitHouseNumber(s)
    .base.replace(PUNCT, ' ')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(TRAILING_NO, '')
    .trim()

// The feed abbreviates where OSM spells out; both write the same street.
const ABBREV = { წმ: 'წმინდა', გენ: 'გენერალ', ქ: 'ქუჩა', ქუჩ: 'ქუჩა', აკად: 'აკადემიკოს' }
// OSM numbers side streets with roman numerals ("სერგი მესხის I შესახვევი")
// where the feed writes a Georgian ordinal or a plain digit. Same lane.
const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }
const canon = (t) => {
  const a = ABBREV[t] ?? t
  if (ROMAN[a]) return ROMAN[a]
  const ord = /^მე-?(\d+)$/.exec(a)
  return ord ? ord[1] : a
}
const tokens = (s) => norm(s).split(' ').filter(Boolean).map(canon)
const sortedKey = (s) => tokens(s).slice().sort().join(' ')

// Crude Georgian stemmer: the genitive -ის is what differs between
// "თაბუკაშვილი რეზოს ქუჩა" and "რეზო თაბუკაშვილის ქუჩა", which are one street.
// Good enough to compare two spellings of a name; not morphology.
const stem = (t) => {
  if (t.length > 4 && t.endsWith('ის')) return t.slice(0, -2)
  if (t.length > 3 && /[იეს]$/.test(t)) return t.slice(0, -1)
  return t
}

const GENERIC = new Set([
  'ქუჩა', 'გამზირი', 'გამზირ', 'ჩიხი', 'ჩიხ', 'შესახვევი', 'შესახვევ', 'მოედანი', 'მოედან',
  'გზატკეცილი', 'გზატკეცილ', 'და', 'street', 'ave', 'st',
])
const content = (s) => tokens(s).filter((t) => !GENERIC.has(t) && t.length > 2)
const stems = (s) => content(s).map(stem).filter((t) => t.length > 2)
// Sorted and concatenated, so it tolerates both reordering and the feed running
// two words together ("ანდრიაპირველწოდებული" vs OSM's "ანდრია პირველწოდებულის").
const stemKey = (s) => stems(s).slice().sort().join('')

const TYPE_ALIAS = { ქ: 'ქუჩა', ქუჩ: 'ქუჩა', street: 'ქუჩა', st: 'ქუჩა', ave: 'გამზირი' }
const typeWord = (s) => {
  const t = tokens(s).find((x) => GENERIC.has(x) && x !== 'და')
  return t ? (TYPE_ALIAS[t] ?? t) : undefined
}

// A number that survives the house-number strip belongs to the name ("№10
// საჯარო სკოლა"). School 23 is not school 10, so the digits have to agree.
const digits = (s) => tokens(s).flatMap((t) => t.match(/\d+/g) ?? []).sort().join(',')

const lev = (a, b) => {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 3) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

const CONFIDENT = new Set(['exact', 'near', 'reorder', 'stem'])

function buildMatcher(osm) {
  const entries = Object.entries(osm).map(([ka, v]) => ({
    ka, ...v, _s: stems(ka), _d: digits(ka), _t: typeWord(ka), _k: stemKey(ka),
  }))

  // When several OSM names collapse onto one key, keep the one that has Russian.
  const better = (a, b) => (b.ru ? 1 : 0) - (a.ru ? 1 : 0) || b.count - a.count
  const index = (keyFn) => {
    const m = new Map()
    for (const rec of entries) {
      const k = keyFn(rec.ka)
      if (!k) continue
      if (!m.has(k) || better(m.get(k), rec) > 0) m.set(k, rec)
    }
    return m
  }
  const byNorm = index(norm)
  const bySorted = index(sortedKey)
  const byStem = index(stemKey)

  const loose = (ka, requireRu = false) => {
    const st = stems(ka)
    if (!st.length) return null
    const sd = digits(ka)
    const stype = typeWord(ka)
    let best = null
    for (const o of entries) {
      if (!o._s.length || o._d !== sd) continue
      if (requireRu && !o.ru) continue
      const shared = st.filter((t) => o._s.includes(t)).length
      if (!shared) continue
      if (shared !== st.length && shared !== o._s.length) continue // one side must contain the other
      // Unmatched words on either side are evidence against, so "Apsaros street"
      // prefers the Apsaros road over the Gonio-Apsaros museum; a disagreeing
      // street type is worse still.
      const score =
        shared * 100 -
        (st.length - shared) * 40 -
        (o._s.length - shared) * 40 +
        (stype && o._t ? (stype === o._t ? 50 : -40) : 0) +
        (o.ru ? 5 : 0)
      if (score < 60) continue
      if (!best || score > best.score) best = { score, ...o }
    }
    return best
  }

  // Last resort: the feed has real typos ("დრამატული თეტრი", "ცოტა დადიანის").
  const fuzzy = (ka, requireRu = false) => {
    const k = stemKey(ka)
    if (k.length < 6) return null
    const sd = digits(ka)
    const budget = k.length <= 10 ? 1 : k.length <= 18 ? 2 : 3
    let best = null
    for (const o of entries) {
      if (o._d !== sd || !o._k) continue
      if (requireRu && !o.ru) continue
      const d = lev(k, o._k)
      if (d > budget) continue
      const score = -d * 10 + (o.ru ? 1 : 0)
      if (!best || score > best.score) best = { score, ...o }
    }
    return best
  }

  return (ka) => {
    let hit = null
    let tier = null
    const n = norm(ka)
    const sk = stemKey(ka)
    if (osm[ka]) [hit, tier] = [{ ka, ...osm[ka] }, 'exact']
    else if (byNorm.has(n)) [hit, tier] = [byNorm.get(n), 'near']
    else if (bySorted.has(sortedKey(ka))) [hit, tier] = [bySorted.get(sortedKey(ka)), 'reorder']
    else if (sk && byStem.has(sk) && digits(byStem.get(sk).ka) === digits(ka)) [hit, tier] = [byStem.get(sk), 'stem']
    else {
      const l = loose(ka)
      if (l) [hit, tier] = [l, 'loose']
      else {
        const f = fuzzy(ka)
        if (f) [hit, tier] = [f, 'fuzzy']
      }
    }
    // A tighter match to an object with no name:ru is worth less than a looser
    // one that has it — several stops name a street that OSM also tags on a
    // nearby POI without Russian.
    if (hit && !hit.ru) {
      const alt = loose(ka, true) ?? fuzzy(ka, true)
      if (alt?.ru) [hit, tier] = [alt, `${tier}/loose`]
    }
    return hit ? { osm: hit, tier } : null
  }
}

// ---- house style ----------------------------------------------------------
// These names are rendered as labels — a list row, a page heading, a map panel
// title — never inside a sentence. Russian and English both capitalise a label,
// and the app's own transliteration already did ("Улица Гришашвили"), so OSM's
// mid-sentence lower-case type word is raised rather than the other way round.
// Only the first character moves: "улица Иосифа Гришашвили" is OSM's spelling
// of the name and the only thing wrong with it here is that it opens a label.
//
// Abbreviations are expanded only in the leading position, which is where OSM
// uses them as a type word. "Бакинская ул., Канатная дорога" keeps its "ул." —
// there it is part of a compound name that the pole itself carries.
const RU_LEADING = [
  [/^ул\.\s*/i, 'улица '],
  [/^пр\.\s*/i, 'проспект '],
  [/^просп\.\s*/i, 'проспект '],
  [/^пер\.\s*/i, 'переулок '],
  [/^пл\.\s*/i, 'площадь '],
  [/^ш\.\s*/i, 'шоссе '],
  [/^наб\.\s*/i, 'набережная '],
]
const EN_TRAILING = [
  [/\bst\.?$/i, 'Street'],
  [/\bstreet$/, 'Street'],
  [/\bave\.?$/i, 'Avenue'],
  [/\bavenue$/, 'Avenue'],
  [/\bhighway$/, 'Highway'],
  [/\bsquare$/, 'Square'],
  [/\blane$/, 'Lane'],
]

const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const tidy = (s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim()

const styleRu = (value) => {
  if (!value) return null
  let out = tidy(value)
  for (const [from, to] of RU_LEADING) if (from.test(out)) { out = out.replace(from, to); break }
  return upperFirst(out)
}
const styleEn = (value) => {
  if (!value) return null
  let out = tidy(value)
  for (const [from, to] of EN_TRAILING) if (from.test(out)) { out = out.replace(from, to); break }
  return upperFirst(out)
}

// ---- reviewed by hand -----------------------------------------------------
// Where the line is drawn: an entry exists here only when OSM's answer is wrong
// for this pole, absent, or a legal name where the pole carries a short one. No
// entry exists merely because a transliteration reads clumsily — that is what
// the fallback is for, and hand-tuning 578 names one at a time is how a name
// table rots. Keyed exactly as the table is: house number already removed.
const HAND = {
  // --- OSM matched the wrong object ---------------------------------------
  'ს. მესხის ქუჩა': {
    ru: 'Улица Сергея Месхи', en: 'Sergi Meskhi Street', src: 'osm:სერგი მესხის ქუჩა',
    why: 'the stem matcher reached ივანე მესხი; the feed\'s own English says Sergi, and OSM carries სერგი მესხის ქუჩა separately',
  },
  'შარაშიძის ქუჩა მესამე ჩიხი': {
    ru: '3-й тупик Михеила Шарашидзе', en: 'Mikheil Sharashidze 3rd Dead End', src: 'osm:მიხეილ შარაშიძის III ჩიხი',
    why: 'OSM matched მესამე ქუჩა ("3rd Street") — the ordinal on its own, not the street the dead end belongs to',
  },
  'ნიკო ფიროსმანის': {
    ru: 'Улица Пиросмани', en: 'Pirosmani Street', src: 'osm:ფიროსმანის ქ.',
    why: 'the name drops "ქუჩა" and OSM matched a restaurant called Pirosmani; the two sibling poles name the street',
  },

  // --- OSM's stop name carries a street the pole does not ------------------
  // These are OSM bus_stop objects named "<street>, <landmark>". Where the feed
  // writes only the landmark, the street is dropped so the label still answers
  // the question the pole asks. Where the feed writes it too (ბაქოს ქ. საბაგირო),
  // OSM's full name is kept.
  'ბარბარეს ეკლესია': {
    ru: 'Церковь Святой Варвары', en: 'Church of St Barbara', src: 'osm:რუსთაველის ქ. ბარბარეს ეკლესია',
    why: 'OSM prefixes the street ("пр. Руставели, …"); the pole names only the church',
  },
  'საკათედრო ტაძარი': {
    ru: 'Кафедральный собор', en: 'Cathedral', src: 'osm:ჭავჭავაძის ქ. საკათედრო ტაძარი',
    why: 'OSM prefixes the street ("ул. Чавчавадзе (…)"); the pole names only the cathedral',
  },
  'იუსტიციის საახლი': {
    ru: 'Дом Юстиции', en: 'Public Service Hall', src: 'osm:იუსტიციის სახლი',
    why: 'the feed misspells სახლი; the three poles that spell it correctly match OSM exactly, and this one is the same building',
  },

  // --- OSM has the institution's legal name, the pole has the short one ----
  'დრამატული თეატრი': {
    ru: 'Драматический театр', en: 'Drama Theatre', src: 'osm:ბათუმის ი. ჭავჭავაძის სახელობის დრამატული თეატრი',
    why: 'OSM\'s name is 63 characters of legal title; the pole says two words and so does the row it has to fit in',
  },
  'დრამატული თეტრი': {
    ru: 'Драматический театр', en: 'Drama Theatre', src: 'osm:ბათუმის ი. ჭავჭავაძის სახელობის დრამატული თეატრი',
    why: 'the feed misspells თეატრი; same theatre as the stop that spells it correctly',
  },
  'მე–6 საჯარო სკოლა': {
    ru: 'Публичная школа №6', en: 'Public School #6', src: 'osm:№6 ფიზიკა-მათემატიკის საჯარო სკოლა',
    why: 'OSM names it by speciality ("физико-математическая школа № 6"); its four siblings on this network read "Публичная школа №N" and the pole says nothing about physics',
  },

  // --- OSM knows the place but carries no name:ru -------------------------
  'ბათუმის სპორტის სასახლე': {
    ru: 'Дворец спорта', en: 'Batumi Sports Palace', src: 'osm:მუხრან ვახტანგაძის ბათუმის სპორტის სასახლე',
    why: 'OSM has only name:en here; sounding the Georgian out gives "Батумис спортис сасахле" for a building every Russian reader can name',
  },
  'საზღვაო ტრანსპორტის სააგენტო': {
    ru: 'Агентство морского транспорта', en: 'Maritime Transport Agency', src: 'osm:საქართველოს საზღვაო ტრანსპორტის სააგენტო',
    why: 'OSM has only name:en; translated from it rather than sounded out',
  },
  'გაფორმების ეკონომიკური ზონა (გეზი)': {
    ru: 'Экономическая зона оформления (ГЭЗ)', en: 'Clearance Economic Zone (GEZ)', src: 'hand',
    why: 'OSM has the Georgian name and neither translation; the feed\'s own English ("Signed economic zone") mistranslates გაფორმება, which is customs clearance',
  },

  // --- no OSM match at any tier (14 names, 25 poles) -----------------------
  // Institutions and venues: a named thing a map prints is worth writing out.
  'ბათუმის დინამოს სტადიონი': {
    ru: 'Стадион «Динамо»', en: 'Dinamo Stadium', src: 'hand',
    why: 'six poles; OSM maps the club\'s training base but not the stadium',
  },
  'ბათუმის ყინულის არენა': {
    ru: 'Батумская ледовая арена', en: 'Batumi Ice Arena', src: 'hand',
    why: 'OSM names the street it stands on ("улица Селима Химшиашвили (Ледовый дворец)"), not the arena',
  },
  'რკინიგზის სადგური': { ru: 'Железнодорожный вокзал', en: 'Railway Station', src: 'hand', why: 'not in OSM under any Georgian name in the box' },
  'გოგირდის აბანოები': { ru: 'Серные бани', en: 'Sulphur Baths', src: 'hand', why: 'not in OSM; the two words are common nouns, not a proper name' },
  'რეფერალური სავადმყოფო': {
    ru: 'Реферальный госпиталь', en: 'Referral Hospital', src: 'osm:ბათუმის რეფერალური საავადმყოფო',
    why: 'the feed misspells საავადმყოფო; the city qualifier is dropped because the pole does not carry it',
  },
  'არქეოლოგიის მუზეომი': {
    ru: 'Археологический музей', en: 'Archaeological Museum', src: 'osm:არქეოლოგიური მუზეუმი',
    why: 'the feed misspells მუზეუმი; the city qualifier is dropped because the pole does not carry it',
  },
  'მუხრან ვახტანგაძის სახელობის სპორტსკოლა': {
    ru: 'Спортшкола имени Мухрана Вахтангадзе', en: 'Mukhran Vakhtangadze Sports School', src: 'hand',
    why: 'OSM maps the sports palace of the same name but not the school',
  },
  'ბათუმის ხელოვნებისა და მუსიკის ცენტრი': {
    ru: 'Батумский центр искусства и музыки', en: 'Batumi Art and Music Centre', src: 'feed:en',
    why: 'OSM\'s nearest object is the Art and *Culture* centre; translated from the feed\'s own English, which is the operator\'s name for the pole',
  },
  // Streets and lanes OSM knows under another spelling.
  'სვიშვესკი ქუჩა': {
    ru: 'Улица Димитрия Свишевского', en: 'Dimitri Svishevsky Street', src: 'osm:დიმიტრი სვიშევსკის ქუჩა',
    why: 'the feed transposes the letters of სვიშევსკის and drops the genitive',
  },
  'მაჭახლის ქუჩა': {
    ru: 'Улица Мачахела', en: 'Machakhela Street', src: 'osm:მაჭახელას ქუჩა',
    why: 'the feed writes მაჭახლის where OSM writes მაჭახელას — the same Machakhela valley',
  },
  'იბერიის ქუჩის შესახვევი': {
    ru: 'Переулок улицы Иберия', en: 'Iberia Street Lane', src: 'osm:იბერიას ქუჩა',
    why: 'OSM has the street but not its lane; named from the street it leaves',
  },
  'ახალგაზრდობის ქუჩის შესახვევი': {
    ru: 'Переулок улицы Молодёжи', en: 'Youth Street Lane', src: 'hand',
    why: 'neither the lane nor its street is in OSM; ახალგაზრდობა is a common noun, not a person',
  },
  'endstop route 3': {
    ru: 'Конечная маршрута 3', en: 'Route 3 terminus', src: 'feed:en',
    why: 'a placeholder the feed never filled in; left as-is it is the one English string in a Russian list',
  },

  // --- the pole says more than the street -----------------------------------
  // Two names carry a Georgian qualifier in brackets. The house-number rule
  // deliberately does not touch brackets, so these are written out once.
  'ფერიის ქუჩა (ბოლო გაჩერება)': {
    ru: 'Улица Ферии (конечная)', en: 'Ferie Street (terminus)', src: 'osm:ფერიის ქუჩა',
    why: 'the street comes from OSM; the bracket says this pole is the terminus and is worth keeping',
  },
  'წმ. სევერიან აჭარელის ქუჩა.(ავტოსადგური)': {
    ru: 'Улица Святого Севериана Ачарели (автовокзал)', en: 'St Severiane Achareli Street (bus station)', src: 'osm:წმინდა სევერიანე აჭარელის ქუჩა',
    why: 'as above — the street from OSM, the bracket kept because it says which pole this is',
  },
  'წმ. სევერიან აჭარელის ქუჩა №1(ავტოსადგური)': {
    ru: 'Улица Святого Севериана Ачарели (автовокзал)', en: 'St Severiane Achareli Street (bus station)', src: 'osm:წმინდა სევერიანე აჭარელის ქუჩა',
    why: 'same pole, spelled with a house number glued to the bracket, so the number rule leaves it alone',
  },

  // --- OSM tagged the same name twice and the majority tag is the worse one -
  // `harvestOsm` keeps the spelling the most objects agree on, which is right
  // when the disagreement is a typo and wrong when it is a translation against
  // a transliteration: the crowd is simply bigger on the older tagging.
  'წმ. სევერიან აჭარელის ქუჩა': {
    ru: 'Улица Святого Севериана Ачарели', en: 'St Severiane Achareli Street', src: 'osm:წმინდა სევერიანე აჭარელის ქუჩა',
    why: 'OSM carries both "улица Цминда Севериане Ачарели" and "улица Святого Севериана Ачарели" on ways of this name, and the transliteration wins on object count; წმინდა is the common noun "saint", which is exactly the kind of word this table exists to translate — the feed even abbreviates it to წმ., the way Russian writes св.',
  },

  // --- the feed's spelling matched a sibling object, not the network's name --
  // Each of these has a correctly spelled sibling pole on the same street that
  // OSM answers differently, so left alone the app labels one street two ways
  // depending on which pole the reader is standing at.
  'მე-8 საჯარო სკოლა': {
    ru: 'Публичная школа №8', en: 'Public School #8', src: 'osm:№8 საჯარო სკოლა',
    why: 'OSM maps this school twice — "მე-8 საჯარო სკოლა" tagged "Школа №8" and "№8 საჯარო სკოლა" tagged "Публичная школа №8"; the ten other schools on this network read the latter',
  },
  'მე-11 საჯარო სკოლა': {
    ru: 'Публичная школа №11', en: 'Public School #11', src: 'osm:№11 საჯარო სკოლა',
    why: 'as №8 — the short tagging won the count; the long one OSM also carries is "Батумская государственная школа №11 имени Акакия Церетели", which is a legal name and not what the pole says',
  },
  'ტბელ აბუსერიძის ქუჩა': {
    ru: 'Улица Тбел Абусеридзе', en: 'Tbel Abuseridze Street', src: 'osm:ტბელ აბუსერისძის ქუჩა',
    why: 'the feed drops the ს of აბუსერისძე and the fuzzy match landed on an OSM object spelling the surname "Абуселидзе"; the poles that spell it correctly read "Абусеридзе", and so does the church of the same saint',
  },
  'გიორი ლეონიძის ქუჩა': {
    ru: 'Улица Георгия Леонидзе', en: 'Giorgi Leonidze Street', src: 'osm:გიორგი ლეონიძის ქუჩა',
    why: 'the feed misspells გიორგი, so the loose match reached the bare "ლეონიძის ქუჩა" in OSM and dropped the first name the sibling poles carry',
  },
  'ვლადიმერ მაიაკოვსკის ქუჩა': {
    ru: 'Улица Владимира Маяковского', en: 'Vladimir Mayakovsky Street', src: 'osm:ვლადიმირ მაიაკოვსკის ქუჩა',
    why: 'the feed writes ვლადიმერ for ვლადიმირ and the loose match reached the bare "მაიაკოვსკის ქუჩა"; OSM names the street in full, as it does the three dead ends off it',
  },
  'მიხეილ ლერმონთოვის ქუჩა': {
    ru: 'Улица Михаила Лермонтова', en: 'Mikhail Lermontov Street', src: 'osm:მიხეილ ლერმონტოვის ქუჩა',
    why: 'the feed writes თ for ტ; the pole that spells it correctly is matched exactly and reads "Улица Михаила Лермонтова"',
  },
}

// ---------------------------------------------------------------- assemble ---

const osmCache = flag('osm')
const datasetCache = flag('dataset')

const { byKa: osm, meta: osmMeta } = await harvestOsm(osmCache)
const feed = await feedNames(datasetCache)
const match = buildMatcher(osm)

const totalPoles = feed.reduce((a, s) => a + s.poles, 0)

// One entry per house-number-free name: 426 distinct feed names collapse to 175
// keys, and a house number the feed adds next year then needs no new row.
const groups = new Map()
for (const stop of feed) {
  const { base } = splitHouseNumber(stop.ka)
  const g = groups.get(base) ?? { key: base, poles: 0, feed: [] }
  g.poles += stop.poles
  g.feed.push(stop.ka)
  groups.set(base, g)
}

const names = {}
const coverage = {}
const unmatched = []
const tierCounts = {}

for (const [key, group] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'ka'))) {
  const hand = HAND[key]
  const hit = match(key)

  let entry = null
  if (hand) {
    entry = { ru: styleRu(hand.ru), en: styleEn(hand.en), src: hand.src, tier: 'hand', why: hand.why }
  } else if (hit?.osm.ru || hit?.osm.en) {
    entry = { ru: styleRu(hit.osm.ru), en: styleEn(hit.osm.en), src: `osm:${hit.osm.ka}`, tier: hit.tier }
  }

  if (!entry) {
    unmatched.push({ key, poles: group.poles, osmKa: hit?.osm.ka ?? null })
    continue
  }
  if (!entry.ru) delete entry.ru
  if (!entry.en) delete entry.en

  names[key] = entry
  tierCounts[entry.tier] = (tierCounts[entry.tier] ?? 0) + 1
}

for (const stop of feed) coverage[stop.ka] = stop.poles

const covered = feed.filter((s) => names[splitHouseNumber(s.ka).base])
const polesCovered = covered.reduce((a, s) => a + s.poles, 0)
const confidentPoles = feed
  .filter((s) => {
    const e = names[splitHouseNumber(s.ka).base]
    return e && (CONFIDENT.has(e.tier) || e.tier === 'hand')
  })
  .reduce((a, s) => a + s.poles, 0)

const data = {
  meta: {
    generator: 'tools/build-names.mjs',
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap',
    license: 'ODbL 1.0',
    licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    attribution: '© OpenStreetMap contributors',
    endpoint: osmMeta.endpoint ?? OVERPASS,
    bbox: BBOX,
    osm: osmMeta,
    keys:
      'A key is BusStopNameKA as the feed spells it — whitespace collapsed, "#" written as "№", ' +
      'a trailing house number removed. The number is put back by the caller, so one key serves ' +
      'every pole on the street.',
    tiers:
      'exact = identical Georgian name | near = whitespace, punctuation or house number differs | ' +
      'reorder = same words, different order | stem = same words, Georgian genitive or word split ' +
      'differs | loose = one name contains the other | fuzzy = edit distance ≤ 3 on the stem key, ' +
      'i.e. a feed typo | hand = reviewed and written out, with the reason on the entry.',
    counts: {
      keys: Object.keys(names).length,
      distinctFeedNames: feed.length,
      poles: totalPoles,
      polesCovered,
      polesCoveredConfidently: confidentPoles,
      byTier: tierCounts,
      unresolvedKeys: unmatched.length,
    },
  },
  // The feed's own names at build time, with how many poles carry each. This is
  // what the table was built against — it says exactly which names were in
  // scope, and it is what names.test.ts walks to prove no Georgian survives.
  coverage,
  names,
}

writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`)

if (REPORT) {
  const pad = (s, n) => String(s ?? '').padEnd(n)
  const lines = [...groups.keys()]
    .sort((a, b) => a.localeCompare(b, 'ka'))
    .map((k) => {
      const e = names[k]
      return `${pad(e?.tier ?? 'NONE', 8)} | ${pad(k, 46)} | ${pad(e?.ru, 46)} | ${pad(e?.en, 42)} | ${e?.src ?? ''}`
    })
  writeFileSync(REPORT, `${lines.join('\n')}\n`)
}

console.log('distinct feed names ', feed.length, `(${totalPoles} poles)`)
console.log('table keys          ', Object.keys(names).length)
console.log('tiers               ', tierCounts)
console.log('poles covered       ', polesCovered, `of ${totalPoles}`)
console.log('  of those confident', confidentPoles)
console.log('unresolved keys     ', unmatched.length, unmatched.map((u) => u.key).join(', '))
console.log('written             ', OUT)
