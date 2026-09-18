# Deploy

`.github/workflows/vercel.yml` runs on every push to `master`, and can be started
by hand. **A push to `master` is a release.**

1. **`verify`**: typecheck and tests. It also runs on pull requests. A red suite
   stops the release.
2. **Vercel's prebuilt flow**: `link` → `pull` → `build --prod` →
   `deploy --prebuilt --prod`. It needs the `VERCEL_TOKEN` secret.
3. **A health check** on the production domain's `/api/health`. A 200, or a 503
   when Batumi's feed is down, passes. Vercel's `NOT_FOUND`, a timeout, or the
   app's HTML fails. `/api` has twice shipped returning nothing while every step
   was green. The domain is `SITE_URL`, read back out of the built `index.html`.
   The deployment's own generated URL can't be used, because Deployment
   Protection answers it with a redirect to a login page.
4. **`remove --safe`** runs only after the check, so a broken release leaves the
   previous deployment in place to roll back to.

`vercel.json` is committed. It sets the build command, the web app's output, the
`/api` function, and a one-year immutable cache on `/assets/*`. Vercel's default
made browsers re-check every file on every visit. No environment variables are
required.

## Traps

- **`api/index.ts` must default-export `{ fetch }`**, not `handle(app)`. Vercel
  treats a bare function as a Node `(req, res)` handler. Hono then never answers,
  and each request hangs until `maxDuration`.
- **The `/api/(.*) → /api` rewrite is required.** Vercel matches `api/index.ts`
  only to the exact path `/api`, and it checks files before rewrites, so
  `/api/health` got Vercel's own `NOT_FOUND`. The rewrite keeps the original URL,
  so Hono's `basePath` still matches.
- **The root `tsconfig.json` exists only for Vercel.** Its function builder finds
  that file, not `apps/api/tsconfig.json`. Imports carry `.ts` extensions because
  Node needs them.
  - **Don't add `allowImportingTsExtensions`.** The builder emits `.js` files but
    leaves `'./config.ts'` imports in place. The result is `ERR_MODULE_NOT_FOUND`
    in production behind a green build.
  - **Use `rewriteRelativeImportExtensions`**, which fixes the imports when the
    files are emitted.
- **`functions.maxDuration` (30 s) must stay above `UPSTREAM_TIMEOUT_MS`
  (15 s).** A cold start fetches the whole 1.27 MB dataset. If you lower one,
  lower the other with it. Otherwise the caller gets Vercel's 504 instead of our
  502.
- **Region.** The feed is in Georgia, and Vercel's default region is US East.
  Set `fra1`, or somewhere nearer, in the Vercel dashboard. `regions` in
  `vercel.json` needs a paid plan.
- **The basemap is built during the deploy.** See [basemap.md](basemap.md).
