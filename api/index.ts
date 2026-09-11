import { handle } from 'hono/vercel'
import { app } from '../apps/api/src/app.ts'

// Vercel's entry point. The long-running server in apps/api/src/server.ts and
// this file mount the *same* Hono app — the deployment target is the only
// difference, and neither knows anything the other doesn't.
export default handle(app)
