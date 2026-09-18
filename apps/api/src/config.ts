// Everything the API reads from the environment, resolved once with a working
// default — the service must boot with no configuration at all.
const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: int(process.env.PORT, 8787),

  /**
   * Browsers allowed to call the API cross-origin — which in practice is only
   * the packaged app. The web app is same-origin everywhere it runs: deployed it
   * shares a domain with the API, and in dev both Vite servers proxy `/api`, so
   * the browser makes no cross-origin request and sends no `Origin` at all.
   * Measured by emptying this of localhost and loading the app: it works.
   *
   * Capacitor is the exception and cannot be proxied — it serves the bundle from
   * `https://localhost` (Android) or `capacitor://localhost` (iOS). Those two
   * stay, or the packaged app goes blank.
   *
   * The dev ports that used to sit here were doing nothing: they only ever
   * applied to a browser pointed straight at this port instead of through the
   * proxy, one of them (5273) matched nothing in this repo at all, and Vite
   * silently moves to the next free port when one is busy — so the list could
   * not be relied on even for the case it was written for. `vite.config.ts` now
   * pins the ports, and ALLOWED_ORIGINS is how you talk to the API directly.
   */
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'https://localhost,capacitor://localhost')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * The Batumi feed's origin. The community Cloudflare Worker
   * (https://bus-proxy.raf003771.workers.dev) mirrors the same two endpoints and
   * is the emergency fallback — it is one person's free-tier account, so it is
   * never the default. See docs/data-source.md.
   */
  upstreamBase: process.env.UPSTREAM_BASE ?? 'https://thetamaps.site:54321',

  /** Upstream request budget, milliseconds. */
  upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS, 15000),

  /** Upstream says `max-age=600` on the dataset and `max-age=4` on positions. */
  datasetTtlMs: int(process.env.DATASET_TTL_MS, 10 * 60 * 1000),
  vehiclesTtlMs: int(process.env.VEHICLES_TTL_MS, 4000),
}
