import { serve } from '@hono/node-server'
import { app } from './app.ts'
import { config } from './config.ts'

// Local development and any long-running host. On Vercel the same `app` is
// mounted by `api/index.ts` instead, so this file never runs there.
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`susanin api on http://localhost:${info.port}/api`)
  console.log(`upstream ${config.upstreamBase}`)
})
