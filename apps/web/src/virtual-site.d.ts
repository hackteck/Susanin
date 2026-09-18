// Made at build time by vite.site.ts, from SITE_URL.
declare module 'virtual:site' {
  /** Where the app is published, absolute and with its trailing slash. */
  export const siteUrl: string
  /** A QR code for `siteUrl`: a standalone SVG document, black on white. */
  export const qrSvg: string
}
