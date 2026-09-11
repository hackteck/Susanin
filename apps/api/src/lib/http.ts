import { config } from '../config.ts'

export class UpstreamError extends Error {
  // Written out rather than declared as constructor parameter properties:
  // Node strips types instead of compiling them, so TS-only syntax can't run.
  /** The HTTP status, or 0 when there was no response at all. */
  status: number
  url: string

  constructor(message: string, status: number, url: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UpstreamError'
    this.status = status
    this.url = url
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// One place where every upstream call gets its timeout, its retry and its
// user agent — an undocumented municipal API is exactly the kind that drops a
// connection once and answers the second time.
export async function getJson<T>(url: string, init?: RequestInit & { attempts?: number }): Promise<T> {
  const attempts = init?.attempts ?? 2
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
        headers: {
          accept: 'application/json',
          // Points at the issue tracker, not just the repo: an operator who
          // wants this traffic to stop needs somewhere to say so.
          'user-agent': 'susanin-batumi-bus/0.1 (+https://github.com/hackteck/susanin/issues)',
          ...init?.headers,
        },
      })

      if (!response.ok) {
        throw new UpstreamError(`upstream ${response.status} ${response.statusText}`, response.status, url)
      }

      return (await response.json()) as T
    } catch (error) {
      // A timeout or a refused connection is upstream's failure as much as a 503
      // is, and the caller has to be able to say so. Left as the TypeError it
      // arrives as, it fell through to the generic handler and the API answered
      // 500 — our fault, by the status code — for a feed that was simply down.
      lastError =
        error instanceof UpstreamError
          ? error
          : new UpstreamError(`upstream unreachable: ${(error as Error).message}`, 0, url, { cause: error })
      // A 4xx is an answer, not a hiccup — retrying it just costs time.
      if (error instanceof UpstreamError && error.status >= 400 && error.status < 500) break
      if (attempt < attempts) await sleep(250 * attempt)
    }
  }

  throw lastError
}
