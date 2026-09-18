import type { Plugin } from 'vite'
import { encode } from 'uqr'

/**
 * The site's own address, and everything that has to agree with it — made once,
 * at build time, from SITE_URL.
 *
 * - `virtual:site` exports the address and a QR code for it, so the share page
 *   carries its code inside the bundle: no request, no library in the browser,
 *   and it works offline like the rest of the app shell.
 * - `index.html`'s link-preview tags get the same address in place of
 *   `__SITE_URL__`. Scrapers do not resolve a relative image against the page,
 *   so those have to be absolute, and they used to be the one place the
 *   production domain was typed into the app by hand.
 *
 * A packaged Android build takes the same address, which is the right one to
 * share from there too: the app's own origin is `https://localhost`.
 */

const VIRTUAL_ID = 'virtual:site'
const RESOLVED_ID = `\0${VIRTUAL_ID}`
const PLACEHOLDER = '__SITE_URL__'

/**
 * The standard's own minimum. Four modules of white round the code is what lets
 * a camera find its edge on a busy background — a poster, a wall, a dark theme.
 */
const QUIET_ZONE = 4

/**
 * Black on white, always, and written into the file rather than themed: this
 * SVG is also the file people download and print, it has no stylesheet there,
 * and a light-on-dark code is one that some phone cameras refuse to read.
 */
export function qrSvg(text: string): string {
  // M, not H: a short URL at M is version 3, 29 modules across, which is the
  // difference between a code that scans from across a counter and one that
  // needs the phone held against it. Nothing is overlaid on it to need H.
  const { data, size } = encode(text, { ecc: 'M', border: 0 })
  const total = size + QUIET_ZONE * 2

  // One path of horizontal runs rather than a rect per module: 29×29 is 841
  // cells and about half are dark, so this is a tenth of the markup.
  let path = ''
  data.forEach((row, y) => {
    for (let x = 0; x < size; ) {
      if (!row[x]) {
        x++
        continue
      }
      let run = 1
      while (x + run < size && row[x + run]) run++
      path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${run}v1h-${run}z`
      x += run
    }
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
  )
}

export function site(address: string): Plugin {
  const svg = qrSvg(address)

  return {
    name: 'susanin:site',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load: (id) =>
      id === RESOLVED_ID
        ? `export const siteUrl = ${JSON.stringify(address)}\nexport const qrSvg = ${JSON.stringify(svg)}\n`
        : undefined,
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => {
        if (!html.includes(PLACEHOLDER)) throw new Error(`index.html has no ${PLACEHOLDER} to fill in`)
        return html.replaceAll(PLACEHOLDER, address)
      },
    },
  }
}
