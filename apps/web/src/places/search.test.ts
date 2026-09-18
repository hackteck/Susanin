import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { metresBetween } from '../planner/geo.ts'
import { buildIndex, numberKey, placeAt, searchPlaces, type PlacesData } from './search.ts'

// The real table, as the app ships it: what is being guarded is that the words
// people type find the places they mean in *this* data, not in a toy one.
const data = JSON.parse(readFileSync(new URL('./places.data.json', import.meta.url), 'utf8')) as PlacesData
const index = buildIndex(data)
const centre = { lat: 41.6415, lon: 41.6283 }
const search = (query: string) => searchPlaces(index, query, { near: centre })
const first = (query: string) => search(query)[0]

const GEORGIAN = /[Ⴀ-ჿ]/

test('a street and a number find the house', () => {
  const house = first('Горгиладзе 45')
  assert.equal(house?.kind, 'address')
  assert.equal(house?.name.ru, 'улица Зураба Горгиладзе, 45')
})

test('the same house is found from any of the three alphabets', () => {
  const ids = ['Горгиладзе 45', 'gorgiladze 45', 'გორგილაძის 45', 'ул. Горгиладзе, д. 45'].map((query) => first(query)?.id)
  assert.ok(ids[0])
  assert.deepEqual(new Set(ids).size, 1, ids.join(' | '))
})

test('a house letter is one letter whichever keyboard typed it', () => {
  assert.equal(numberKey('10ა'), numberKey('10а'))
  assert.equal(numberKey('10ა'), numberKey('10A'))
  const ids = ['Пушкина 10а', 'pushkin 10a', 'პუშკინის 10ა'].map((query) => first(query)?.id)
  assert.ok(ids[0]?.startsWith('address:'))
  assert.equal(new Set(ids).size, 1, ids.join(' | '))
})

test('houses that only start with the number come in house order, not by distance', () => {
  const numbers = search('пушкина 1')
    .filter((place) => place.kind === 'address')
    .map((place) => place.name.ru.split(', ').at(-1)!)
  assert.ok(numbers.length >= 4, numbers.join(' '))
  const order = numbers.map((number) => parseInt(number, 10))
  assert.deepEqual(order, [...order].sort((a, b) => a - b), numbers.join(' '))
})

test('a number that is part of the street name is not taken for a house', () => {
  assert.equal(first('26 мая')?.name.ru, 'улица 26 Мая')
})

test('a street comes before its own lanes and dead ends', () => {
  assert.equal(first('адли')?.name.en, 'Adlia Street')
})

test('one street is offered once, however its houses spell it', () => {
  // Houses on Zurab Gorgiladze Street carry its name in Georgian and in
  // English, and the English ones used to become a second street of their own.
  const streets = search('Горгиладзе').filter((place) => place.kind === 'street' && place.name.en.includes('Zurab'))
  assert.equal(streets.length, 1, streets.map((place) => `${place.name.ka} @ ${place.lat},${place.lon}`).join(' | '))
  // «ადლიის ქუჩა» on 162 houses, «ადლიას ქუჩა» on the road: one street.
  const adlia = search('адлиа').filter((place) => place.kind === 'street' && !/тупик/.test(place.name.ru))
  assert.equal(adlia.length, 1, adlia.map((place) => place.name.ru).join(' | '))
})

test('a Latin name is found by its Russian sound', () => {
  assert.equal(first('хилтон')?.name.en, 'Hilton Batumi')
  assert.match(first('шератон')?.name.en ?? '', /Sheraton/)
  // Russian has one «с» where the name has two: both sides have to be reduced.
  assert.match(first('радиссон')?.name.en ?? '', /Radisson/)
})

test('a kind of place is found by what it is, and a place named so comes first', () => {
  const pharmacies = search('аптека')
  assert.ok(pharmacies.length >= 5)
  assert.ok(pharmacies.every((place) => place.kind === 'health'), pharmacies.map((place) => place.name.en).join(' | '))
  assert.equal(first('автовокзал')?.name.en, 'Batumi Bus Terminal')
})

test('a village is where "Gonio" goes, before the fortress named after it', () => {
  assert.equal(first('гонио')?.kind, 'area')
})

test('no Russian or English name is Georgian script', () => {
  // The whole point of the table's three columns: a reader who cannot read
  // Georgian must never be handed it, however the name was arrived at.
  const offenders = [
    ...index.areas.map((area) => area.name),
    ...index.streets.map((street) => street.name),
    ...index.places.map((place) => place.name),
  ].filter((name) => GEORGIAN.test(name.ru) || GEORGIAN.test(name.en))
  assert.deepEqual(offenders.slice(0, 5), [])

  // House numbers carry Georgian letters, and those are spelled out too.
  for (const query of ['Пушкина 10а', 'pushkin 10a']) {
    const house = first(query)!
    assert.ok(!GEORGIAN.test(house.name.ru) && !GEORGIAN.test(house.name.en), JSON.stringify(house.name))
  }
})

test('a tap on a house is named by its address, and a tap on the sea by nothing', () => {
  const house = first('Горгиладзе 45')!
  const tapped = placeAt(index, { lat: house.lat + 0.00005, lon: house.lon })
  assert.ok(tapped, 'nothing found beside a known house')
  assert.ok(GEORGIAN.test(tapped.name.ka))
  assert.equal(placeAt(index, { lat: 41.66, lon: 41.6 }), null)

  // Whatever names a tap is close to it: a name from across the block is a
  // wrong answer that looks like a right one. Over a grid across the centre,
  // and against a number of its own rather than the module's, which a change
  // to the module would move along with it.
  let named = 0
  for (let lat = 41.63; lat < 41.655; lat += 0.0007) {
    for (let lon = 41.615; lon < 41.645; lon += 0.0009) {
      const found = placeAt(index, { lat, lon })
      if (!found) continue
      named++
      assert.ok(metresBetween({ lat, lon }, found) <= 50, `${found.name.ka} is too far from ${lat},${lon}`)
    }
  }
  assert.ok(named > 100, `only ${named} taps named anything`)
})

test('an empty or all-noise query finds nothing rather than everything', () => {
  assert.deepEqual(search(''), [])
  assert.deepEqual(search('ул.'), [])
  assert.deepEqual(search('   '), [])
})
