import assert from 'node:assert/strict'
import { test } from 'node:test'
import { app } from '../app.ts'
import { getJson, UpstreamError } from './http.ts'

// A feed that is not answering at all — no status, no response, the TypeError
// `fetch` throws for a refused connection or a dead DNS name.
const refuse = async (): Promise<Response> => {
  throw new TypeError('fetch failed')
}

test('a feed that does not answer is an upstream error, and it is retried once', async (t) => {
  const real = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return refuse()
  }
  t.after(() => {
    globalThis.fetch = real
  })

  await assert.rejects(getJson('https://example.invalid/api/getDbData'), (error: unknown) => {
    assert.ok(error instanceof UpstreamError, `got ${String(error)}`)
    assert.equal(error.status, 0)
    return true
  })
  assert.equal(calls, 2, 'a dropped connection gets one more go')
})

// The status code is the one thing an operator reads first: 500 says "our
// bug", 502 says "the feed". This was a 500.
test('the API answers 502 for it, not 500', async (t) => {
  const real = globalThis.fetch
  globalThis.fetch = refuse
  t.after(() => {
    globalThis.fetch = real
  })

  const response = await app.fetch(new Request('http://susanin.test/api/routes'))
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'upstream unavailable' })
})
