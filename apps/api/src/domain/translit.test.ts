import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCyrillic } from './translit.ts'

const GEORGIAN = /[Ⴀ-ჿ]/

test('sounds a name out in Cyrillic', () => {
  assert.equal(toCyrillic('ცოტნე დადიანის ქუჩა #9'), 'Улица Цотне Дадиани №9')
})

test('moves the street type to the front, as Russian expects', () => {
  // Not "Гришашвили улица" — and the type is found even though a house number
  // trails it, which is what the first version of this got wrong.
  assert.equal(toCyrillic('გრიშაშვილის ქუჩა #14'), 'Улица Гришашвили №14')
  assert.equal(toCyrillic('აეროპორტის გზატკეცილი'), 'Шоссе Аеропорти')
  assert.equal(toCyrillic('თბილისის მოედანი'), 'Площадь Тбилиси')
})

test('drops the genitive left dangling by that move', () => {
  // ხალვაშის is "Khalvashi's". Once "улица" leads, the -ს has nothing to mark,
  // and leaving it on gives "Улица Фридон Халвашис".
  assert.equal(toCyrillic('ფრიდონ ხალვაშის ქუჩა'), 'Улица Фридон Халваши')
})

test('reads the ordinal prefix, with either dash the feed uses', () => {
  assert.equal(toCyrillic('მე-18 საჯარო სკოლა'), '18-я публичная школа')
  // The feed writes this one with an en dash, and only some of the time.
  assert.equal(toCyrillic('მე–6 საჯარო სკოლა'), '6-я публичная школа')
})

test('leaves a name that is already Latin alone', () => {
  assert.equal(toCyrillic('Cathedral'), 'Cathedral')
  assert.equal(toCyrillic('Public Service Hall'), 'Public Service Hall')
})

test('leaves no Georgian letter behind', () => {
  // The whole point: a Russian reader must never be shown Georgian script.
  // Every letter of the alphabet, so a missing row in the table fails here.
  const alphabet = 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ'
  const out = toCyrillic(`${alphabet} ქუჩა`)
  assert.ok(!GEORGIAN.test(out), `Georgian survived: ${out}`)
})

test('keeps a name that is only punctuation and digits intact', () => {
  assert.equal(toCyrillic('№14'), '№14')
  assert.equal(toCyrillic(''), '')
})
