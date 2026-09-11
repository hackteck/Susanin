import { handle } from 'hono/vercel'
import { app } from '../apps/api/src/app.ts'

// Vercel's entry point. The long-running server in apps/api/src/server.ts and
// this file mount the *same* Hono app — the deployment target is the only
// difference, and neither knows anything the other doesn't.
//
// The `{ fetch }` wrapper is load-bearing, and its absence fails silently.
// `handle(app)` is a bare function taking a web Request; a default-exported
// *function* is what Vercel treats as a Node `(req, res)` handler, so it was
// called with an IncomingMessage, Hono never recognised it, nothing was ever
// written to the response, and the invocation sat there until maxDuration —
// a 30-second timeout rather than an error. An object with a `fetch` method is
// how Vercel is told this is a web handler.
export default { fetch: handle(app) }
