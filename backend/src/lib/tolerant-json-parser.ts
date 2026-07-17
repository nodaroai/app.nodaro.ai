import type { FastifyInstance } from "fastify"

/**
 * Root-level `application/json` parser that tolerates EMPTY bodies.
 *
 * Two production incidents define its contract:
 *
 * 1. June bug — the `@nodaro/sdk` sets `Content-Type: application/json` on
 *    every non-multipart request, including bodyless writes (e.g. `DELETE
 *    /v1/admin/community/listings/:id`). Fastify's default JSON parser rejects
 *    an empty body with a 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`). Empty body must
 *    parse to `undefined`, not 400.
 *
 * 2. 2026-07-17 outage — the previous fix was an `onRequest` hook that DELETED
 *    the content-type header whenever `content-length` was absent, equating
 *    "no content-length" with "no body". When the edge in front of the origin
 *    (Cloudflare/Railway) switched to forwarding request bodies chunked
 *    (transfer-encoding, no content-length), the hook stripped the
 *    content-type from EVERY json request, leaving bodied requests with no
 *    registered parser -> platform-wide 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`
 *    on prod + staging simultaneously, with no deploy involved.
 *
 * Header surgery cannot fix both: behind a chunking proxy, bodyless requests
 * may ALSO arrive chunked, so "has transfer-encoding" does not imply "has a
 * body" — empty-chunked and bodied-chunked are indistinguishable before the
 * body is read. So we decide AFTER reading it: empty string -> `undefined`
 * (bodyless write with a misleading header), anything else -> Fastify's
 * default secure-json-parse pipeline (proto-poisoning protection intact).
 *
 * Boot-safety with scoped parsers: the Stripe webhook
 * (`ee/routes/stripe-webhook.ts`) and the Replicate training webhook
 * (`routes/replicate-training-webhook.ts`) register their own
 * `application/json` parsers to capture the raw body for signature
 * verification. Fastify's `existingParser()` treats an inherited CUSTOM
 * `application/json` parser as "already present" even inside an encapsulated
 * child scope (only the BUILT-IN default is exempt), so those plugins MUST
 * call `app.removeContentTypeParser("application/json")` (scoped — root
 * routes keep this parser) before their own `addContentTypeParser`, or boot
 * dies with `FST_ERR_CTP_ALREADY_PRESENT`. Any future raw-body route needs
 * the same remove-then-add pair inside its own `app.register()` scope.
 *
 * Guarded by `lib/__tests__/tolerant-json-parser.test.ts`.
 */
export function installTolerantJsonParser(app: FastifyInstance): void {
  // Same poisoning semantics as Fastify's built-in default ('error'/'error').
  const defaultParser = app.getDefaultJsonParser("error", "error")

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      // parseAs: "string" guarantees a string at runtime; the TS overload is
      // just wider (string | Buffer), so normalize instead of casting.
      const text = typeof body === "string" ? body : body.toString("utf8")
      if (!text) {
        done(null, undefined)
        return
      }
      defaultParser(req, text, done)
    },
  )
}
