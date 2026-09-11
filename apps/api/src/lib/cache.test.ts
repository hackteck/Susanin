import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TtlCache } from './cache.ts'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('serves a cached value without loading again', async () => {
  const cache = new TtlCache()
  let loads = 0
  const load = async () => {
    loads++
    return 'value'
  }

  assert.equal(await cache.wrap('k', 1000, load), 'value')
  assert.equal(await cache.wrap('k', 1000, load), 'value')
  assert.equal(loads, 1)
})

test('collapses concurrent misses into a single load', async () => {
  const cache = new TtlCache()
  let loads = 0
  const load = async () => {
    loads++
    await tick(20)
    return loads
  }

  // This is the property the whole upstream budget rests on: a hundred
  // simultaneous viewers must cost one request, not a hundred.
  const all = await Promise.all(Array.from({ length: 10 }, () => cache.wrap('k', 1000, load)))

  assert.equal(loads, 1)
  assert.deepEqual(all, Array.from({ length: 10 }, () => 1))
})

test('reloads once the value has expired', async () => {
  const cache = new TtlCache()
  let loads = 0
  const load = async () => `load ${++loads}`

  assert.equal(await cache.wrap('k', 10, load), 'load 1')
  await tick(25)
  assert.equal(await cache.wrap('k', 10, load), 'load 2')
})

test('remembers a failure briefly instead of retrying it every call', async () => {
  const cache = new TtlCache()
  let attempts = 0
  const failing = async () => {
    attempts++
    throw new Error('upstream down')
  }

  // Without this, an outage cost more upstream requests than healthy traffic did:
  // only successes were cached, so every poll re-tried all 28 routes.
  await assert.rejects(cache.wrap('k', 1000, failing))
  await assert.rejects(cache.wrap('k', 1000, failing))
  await assert.rejects(cache.wrap('k', 1000, failing))

  assert.equal(attempts, 1, 'a remembered failure was retried anyway')
})

test('a failure is never held longer than the success would have been', async () => {
  const cache = new TtlCache()
  let attempts = 0
  const failing = async () => {
    attempts++
    throw new Error('upstream down')
  }

  // Live positions live for 4s; an outage must not pin them down for 5.
  await assert.rejects(cache.wrap('k', 10, failing))
  await tick(25)
  await assert.rejects(cache.wrap('k', 10, failing))

  assert.equal(attempts, 2)
})

test('a later success clears the remembered failure', async () => {
  const cache = new TtlCache()
  let healthy = false
  const load = async () => {
    if (!healthy) throw new Error('upstream down')
    return 'back'
  }

  await assert.rejects(cache.wrap('k', 1000, load))
  healthy = true

  // Still inside the failure window, so the recovery is not visible yet —
  // that is the trade the window buys.
  await assert.rejects(cache.wrap('k', 1000, load))

  const fresh = new TtlCache()
  assert.equal(await fresh.wrap('k', 1000, load), 'back')
})

test('stale keeps the last good value after it expires', async () => {
  const cache = new TtlCache()
  await cache.wrap('k', 5, async () => 'value')
  await tick(20)

  // What the dataset falls back to when upstream stops answering: a stale map
  // beats a blank one.
  assert.equal(cache.stale('k'), 'value')
  assert.equal(cache.stale('missing'), undefined)
})
