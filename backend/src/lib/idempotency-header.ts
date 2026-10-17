/**
 * The request header a client sends to make a write retry-safe. Routes read it
 * as `req.headers[IDEMPOTENCY_HEADER]` (Node lower-cases incoming names); the
 * SDK sends it as `Idempotency-Key` (`@nodaro/sdk` nodes / collections / edit).
 *
 * It is a CUSTOM header, so a browser only sends it when the CORS preflight
 * lists it in `Access-Control-Allow-Headers` — `buildCorsOptions` in `app.ts`
 * must carry this constant, or every cross-origin SPA that passes an
 * idempotency key (Create Image on the worlds pages was the first) gets a
 * `TypeError: Failed to fetch` on every generation.
 */
export const IDEMPOTENCY_HEADER = "idempotency-key"
