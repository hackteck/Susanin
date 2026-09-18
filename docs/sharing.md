# Sharing

`/share` has the app's link, a QR code for it, and the phone's own share sheet.

- **`SITE_URL` is the one address** (see `.env.example`; the default is the
  production domain). `apps/web/vite.site.ts` reads it at build time. The page
  gets it through `virtual:site`, and `index.html` uses it for `og:url` and
  `og:image`. It must be an absolute URL, so a typo fails the build instead of
  ending up on a printed poster. The deploy's health check reads it back out of
  the build.
- **The QR code is made at build time** with `uqr`: a single SVG path, a
  four-module quiet zone, and error correction level M (version 3, 29 modules).
  It is black on white in both themes, because it is also what gets printed and
  some cameras refuse light on dark. It was verified by decoding both the
  on-screen code and the PNG with `jsQR`.
- **The download is a PNG** drawn at a whole number of pixels per module. A
  fractional scale smears the module edges, and that is what makes a printed code
  fail to scan.
- **Sharing uses `navigator.share` where it exists.** Closing the sheet is not an
  error. Where it doesn't exist (desktop Firefox, and the Android WebView that
  the packaged app runs in), copying the link is the main action. If clipboard
  access is refused, the address is selected instead. The packaged app shares
  `SITE_URL`, not its own `https://localhost`.
