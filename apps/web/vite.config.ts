import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(() => {
  return {
    plugins: [
      vue(),
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
          orientation: 'portrait',
          // Matches the light theme's background so the splash does not flash
          // a colour the app never uses.
          background_color: '#ffffff',
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
          runtimeCaching: [
            {
              // The network — routes, stops, timetables. This is the whole point
              // of installing the app: at a bus stop with no signal you can
              // still look up when the last bus goes. Served from cache first
              // because it changes about once a year.
              urlPattern: ({ url }) => /\/api\/(routes|stops)(\/[^/]+)?$/.test(url.pathname),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'susanin-network',
                expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 14 },
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
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: 'http://localhost:8787', changeOrigin: true },
      },
    },
  } satisfies UserConfig
})
