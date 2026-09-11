// Everything the API reads from the environment, resolved once with a working
// default — the service must boot with no configuration at all.
const int = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  port: int(process.env.PORT, 8787),

  /**
   * Browsers allowed to call the API cross-origin. The web app is same-origin
   * and needs no entry; the Capacitor build is not — it runs the bundle from
   * `https://localhost` (Android) or `capacitor://localhost` (iOS), so those
   * are allowed by default or the packaged app cannot reach its own API.
   */
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ??
    'http://localhost:5173,http://localhost:5273,http://localhost:4173,https://localhost,capacitor://localhost'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * The Batumi feed's origin. The community Cloudflare Worker
   * (https://bus-proxy.raf003771.workers.dev) mirrors the same two endpoints and
   * is the emergency fallback — it is one person's free-tier account, so it is
   * never the default. See CLAUDE.md.
   */
  upstreamBase: process.env.UPSTREAM_BASE ?? 'https://thetamaps.site:54321',

  /** Upstream request budget, milliseconds. */
  upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS, 15000),

  /** Upstream says `max-age=600` on the dataset and `max-age=4` on positions. */
  datasetTtlMs: int(process.env.DATASET_TTL_MS, 10 * 60 * 1000),
  vehiclesTtlMs: int(process.env.VEHICLES_TTL_MS, 4000),
}
