import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookupName, russianName } from './names.ts'
import { getNetwork } from './network.ts'

const GEORGIAN = /[Ⴀ-ჿ]/

test('translates the names transliteration got wrong', () => {
  // Each of these is why the OSM table exists. The sounded-out version is in the
  // comment: it is the right syllables and the wrong words, and none of them is
  // a phrase a rider could repeat to a driver.
  assert.equal(russianName('ანდრიაპირველწოდებული ქუჩა'), 'Шоссе Андрея Первозванного') // Улица Андриапирвелцодебули
  assert.equal(russianName('იუსტიციის სახლი'), 'Дом Юстиции') // Иустициис Сахли
  assert.equal(russianName('საკათედრო ტაძარი'), 'Кафедральный собор') // Сакатедро Тадзари
})

test('declines the honoured name, as Russian street names do', () => {
  // "Улица Фридон Халваши" is what a transliterator produces and what no map
  // prints; the genitive is the whole difference between a name and an address.
  assert.equal(russianName('ფრიდონ ხალვაშის ქუჩა'), 'Улица Фридона Халваши')
})

test('keeps the pole number, which is how you know which pole you are at', () => {
  assert.equal(russianName('ფრიდონ ხალვაშის ქუჩა №364'), 'Улица Фридона Халваши №364')
  // Batumi subdivides with a Georgian letter. Appending it raw would leave
  // Georgian script inside a Russian string — 5 of 578 poles do this.
  assert.equal(russianName('გალაკტიონ ტაბიძის ქუჩა №5ა'), 'Улица Галактиона Табидзе №5а')
  assert.ok(!GEORGIAN.test(russianName('ივანე ჯავახიშვილის ქუჩა №3ა')))
})

test('a leading number belongs to the name, not to the pole', () => {
  // "23-ე საჯარო სკოლა" is the 23rd school, not pole 23 on School Street. The
  // house-number rule is anchored at the end for exactly this.
  assert.equal(russianName('23-ე საჯარო სკოლა'), 'Публичная школа №23')
})

test('falls back rather than inventing when OSM has never heard of a stop', () => {
  const made_up = 'ხელოვნური გაჩერება'
  assert.equal(lookupName(made_up), null)
  // Still Cyrillic: the fallback is what keeps a Russian reader from being shown
  // Georgian script for a stop nobody has mapped.
  assert.ok(!GEORGIAN.test(russianName(made_up)))
})

test('English is left empty rather than transliterated into nonsense', () => {
  const hit = lookupName('იუსტიციის სახლი')
  assert.equal(hit?.en, 'Public Service Hall')
})

// The corpus guard, and it asserts on what the API actually serves rather than
// on the lookup in isolation — the first version of this checked the raw feed
// name and read 496 of 578, because the pipeline strips the pole-number prefix
// ("1963 ბათუმის ყინულის არენა") before it ever looks a name up. A guard that
// measures a different string from the one shipped is a guard for nothing.
test('every real stop gets a Russian name, and none of them is Georgian', async (t) => {
  let network
  try {
    network = await getNetwork()
  } catch {
    // The feed sleeps after about 20:00 and the host is sometimes unreachable. A
    // red suite at midnight teaches people to ignore the suite.
    t.skip('upstream unreachable')
    return
  }

  const surviving = network.stopList.filter((stop) => GEORGIAN.test(stop.name.ru))
  assert.deepEqual(
    surviving.map((stop) => `${stop.name.ka} -> ${stop.name.ru}`),
    [],
    'Georgian script survived into a Russian stop name',
  )

  // Coverage, with headroom: measured at 578 of 578. A table that has quietly
  // stopped matching falls off a cliff rather than drifting, and below this the
  // app is silently back to sounding names out — which no screenshot would show.
  const resolved = network.stopList.filter((stop) => lookupName(stop.name.ka) !== null).length
  assert.ok(
    resolved >= network.stopList.length * 0.9,
    `only ${resolved} of ${network.stopList.length} stop names resolved from the OSM table`,
  )
})
