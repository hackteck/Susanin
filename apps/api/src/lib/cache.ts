type Entry<T> = { value: T; expiresAt: number }
type Failure = { error: unknown; expiresAt: number }

/**
 * How long a failure is remembered. Short, because an outage should not outlive
 * itself — but not zero, which is what turns one upstream wobble into a storm:
 * only successes were cached, so during an outage every poll of the map re-tried
 * all 28 routes, and each of those retries once more inside the fetch helper.
 * Measured at 56 upstream requests per five-second poll, against a healthy
 * ceiling of 28 per four seconds.
 */
const FAILURE_TTL_MS = 5000

// A TTL cache that also collapses concurrent misses: ten browsers asking for
// live vehicles in the same second must make one upstream request, not ten.
export class TtlCache {
  #entries = new Map<string, Entry<unknown>>()
  #failures = new Map<string, Failure>()
  #inflight = new Map<string, Promise<unknown>>()

  async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now()

    const hit = this.#entries.get(key)
    if (hit && hit.expiresAt > now) return hit.value as T

    const failed = this.#failures.get(key)
    if (failed && failed.expiresAt > now) throw failed.error

    const pending = this.#inflight.get(key)
    if (pending) return pending as Promise<T>

    const request = load()
      .then((value) => {
        this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs })
        this.#failures.delete(key)
        return value
      })
      .catch((error: unknown) => {
        // Never longer than the success would have lived: a four-second feed
        // must not be held down for five.
        this.#failures.set(key, { error, expiresAt: Date.now() + Math.min(ttlMs, FAILURE_TTL_MS) })
        throw error
      })
      .finally(() => this.#inflight.delete(key))

    this.#inflight.set(key, request)
    return request
  }

  /** The last value for a key, expired or not — the fallback when upstream dies. */
  stale<T>(key: string): T | undefined {
    return this.#entries.get(key)?.value as T | undefined
  }

  clear() {
    this.#entries.clear()
    this.#failures.clear()
  }
}

export const cache = new TtlCache()
