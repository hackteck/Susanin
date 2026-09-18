import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { site } from './vite.site.ts'

/**
 * Where the app is published — what the share page links to, what its QR code
 * encodes, and what link previews point at. Read from the environment at build
 * time (see .env.example) with the production address as the default, so a
 * build needs no configuration. `new URL` throws on anything that is not an
 * absolute URL, which is the point: a QR code for a typo is printed on paper.
 */
const siteUrl = new URL(process.env.SITE_URL || 'https://susanin-batumi.vercel.app/').href

export default defineConfig(() => {
  return {
    plugins: [
      vue(),
      site(siteUrl),
      VitePWA({
        /**
         * Off for the Capacitor build. Inside a packaged app the assets are
         * already on disk, so precaching buys nothing — but it does add a cache
         * that outlives an APK update, and the first launch after an update
         * would then serve the previous build's HTML. The offline timetable is
         * a real loss there and worth revisiting, but not on a build that
         * cannot be tested from here.
         */
        disable: process.env.VITE_PWA_DISABLED === '1',
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'globals.css'],
        manifest: {
          name: 'Susanin — Batumi buses',
          short_name: 'Susanin',
          description: 'Live bus tracking for Batumi: 28 routes, 578 stops, and every bus on the road.',
          lang: 'ru',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          // No `orientation`: an installed app with `portrait` cannot be turned
          // at all, and a map is the one screen where turning the phone is
          // worth something.
          // Matches the light theme's background so the splash does not flash
          // a colour the app never uses.
          background_color: '#ffffff',
          // Read once, when the app is added to the home screen, and on Android
          // it is the *only* thing that colours the status bar of an installed
          // PWA — the <meta> cannot override it and the page cannot paint there.
          // So it is a single fixed colour by necessity, it matches the default
          // light theme, and index.html's <meta> must be kept equal to it or the
          // icons drawn on this background lose their contrast.
          theme_color: '#ffffff',
          categories: ['travel', 'navigation', 'utilities'],
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          navigateFallback: '/index.html',
          // A navigation is a page load, and the API and the tiles are not
          // pages: typing /api/health into an installed browser got the app
          // shell back from the worker instead of the JSON.
          navigateFallbackDenylist: [/^\/api\//, /^\/tiles\//],
          runtimeCaching: [
            {
              // The network — routes, stops, timetables. This is the whole point
              // of installing the app: at a bus stop with no signal you can
              // still look up when the last bus goes, and plan how to get home.
              // Served from cache first because it changes about once a year.
              urlPattern: ({ url }) => /\/api\/((routes|stops)(\/[^/]+)?|timetable)$/.test(url.pathname),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'susanin-network',
                expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 14 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              // The address table the trip fields search. Not precached — at
              // 190 KB compressed it would be downloaded by every visitor on
              // install, most of whom only glance at the map — but kept once a
              // field has fetched it, so a search works with no signal. Its
              // name carries a content hash, so cache-first is never stale.
              urlPattern: ({ url }) => /\/assets\/places\.data-[\w-]+\.json$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'susanin-places',
                expiration: { maxEntries: 2 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // The basemap is deliberately NOT here, and the reason is mechanical
            // rather than a judgement: it is one 6 MB .pmtiles archive read with
            // HTTP Range requests, and CacheStorage cannot store a 206 — a
            // CacheFirst rule over it would cache nothing while looking correct,
            // which is exactly the trap the OSM raster rule fell into before
            // (accepting only status 200 for opaque tiles, and silently storing
            // zero). The archive is immutable and versioned by the planet build
            // it was cut from, so it is cached by the HTTP cache instead, with
            // the long immutable header vercel.json sets on /tiles/. Serving
            // ranges out of a fully cached copy needs workbox-range-requests and
            // a deliberate 6 MB precache; that is the upgrade if the offline map
            // is ever wanted as a promise rather than a side effect.
          ],
          // Live positions and arrivals are deliberately absent: a cached bus
          // is worse than no bus, because it looks current.
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
      },
    },
    // The frontend talks to its own origin, which is how it is deployed. Both
    // servers proxy to the API so that a production build can be checked the
    // way it will actually run, not just the dev one.
    server: {
      // Pinned rather than left to drift. Vite's default is to take the next
      // free port when 5173 is busy, which means a second `npm run dev` starts
      // a server that looks right, answers on an address nothing documents, and
      // serves whichever checkout it was started from. Failing loudly is the
      // cheaper outcome — it is also the only thing that makes "the dev server
      // is on 5173" a fact rather than a hope.
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
      },
      // A tunnel is the only way to meet this app on the device it is for: iOS
      // will not install a PWA or grant geolocation over plain http, and the
      // bugs that matter here only exist on a real phone. Vite rejects a Host it
      // does not recognise, which a tunnel's hostname always is.
      allowedHosts: ['.trycloudflare.com'],
    },
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
      },
      allowedHosts: ['.trycloudflare.com'],
    },
  } satisfies UserConfig
})
