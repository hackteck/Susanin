# Data source

## What is live

Two JSON endpoints on a .NET/IIS and MongoDB service. They were found in the
string table of the `world.newdigital.getbus` Android app:

```
https://thetamaps.site:54321/api/getDbData
https://thetamaps.site:54321/api/getBusLocsOnRoute?routeId=<RouteIdGeoGps>
```

This is the origin, not a proxy. It sends `X-Powered-By: ARR/3.0` and its own
`Cache-Control` (600 s for the dataset, 4 s for positions). Its TLS certificate
is valid, so plain `fetch` works. There is an internal service behind it, but it
is firewalled and we have no use for it.

There is no agreement, API key or published terms behind this access. It can
change or close at any time.

## Already ruled out (don't check these again)

- **Georgia's `pis-gateway`** (`transit.ttc.com.ge/pis-gateway/api/{v2,v3}`) is
  real, but it serves Tbilisi only. It carries one feed with no city parameter,
  there are no Batumi assets, and every guessable Batumi hostname is NXDOMAIN.
- **There is no GTFS for Batumi.** The Mobility Database's only Georgian feed is
  Georgian Railway, and Transitous finds four rail stops over Batumi.
- **The two other Batumi bus apps have dead backends.**
  `crm.geogps.ge/batsite/engine/engine.php` returns a 404, and
  `bus.kosourov.ge/get-routes` returns a hosting panel's default page.
- **We don't use the community proxy** (`bus-proxy.raf003771.workers.dev`). It
  mirrors the same two endpoints on one person's free Cloudflare account, so
  using it would spend their quota (1.27 MB per dataset call). `UPSTREAM_BASE`
  can point at it in an emergency. It must never be the default.

## Keeping load low

The origin is a small contractor's server. The dataset is 1.27 MB and served
uncompressed. Positions come one route at a time, so "show every bus" takes 28
calls.

- **Every upstream call goes through one TTL cache with single-flight**
  (`apps/api/src/lib/cache.ts`). A hundred viewers cost one request per key per
  TTL. The TTLs match upstream: 10 minutes for the dataset, 4 seconds for
  vehicles.
- **Failures are cached too, briefly.** If only successes were cached, an outage
  would cost more than normal traffic. We measured 56 upstream requests per
  5-second poll during an outage, against a normal ceiling of 28 per 4 seconds.
  `cache.test.ts` guards this.
- **That cache is per process.** On Vercel, every warm instance has its own. The
  shared cache is the CDN: each response sends `s-maxage` equal to its TTL, plus
  `max-age=0` so browsers don't keep a stale bus. Vercel strips `s-maxage`
  before the response reaches the browser, so one header does both jobs. When the
  live routes sent `no-cache`, every poll missed the CDN. `app.test.ts` guards
  this.
- **`fluid: true` in `vercel.json` also reduces load.** It lets one instance
  serve concurrent requests, so fewer instances run and fewer duplicate caches
  exist.
- **One cost remains: a cold instance fetches the dataset once per TTL.** If that
  ever hurts, run `apps/api/src/server.ts` as a long-running process. That is a
  deploy change, not a rewrite. A shared KV cache is the wrong fix: at a
  4-second TTL it adds a network hop and a second failure mode for work the CDN
  already does.
