import type { FastifyInstance } from "fastify"

/**
 * Drop a misleading `Content-Type: application/json` header from a request that
 * carries NO body, so Fastify skips JSON parsing instead of rejecting it with a
 * 400 ("Body cannot be empty when content-type is set to 'application/json'").
 *
 * The `@nodaro/client` SDK sets that header on every non-multipart request,
 * including bodyless writes (e.g. `DELETE /v1/admin/community/listings/:id` for
 * community unpublish). Stripping it only when the body is empty (content-length
 * absent or `0`) lets those succeed; requests that actually carry a body are
 * untouched, so normal parsing is unaffected.
 *
 * Implemented as an `onRequest` hook rather than a custom `application/json`
 * content-type parser on purpose: the Stripe webhook route registers its OWN
 * `application/json` parser, and a second registration throws
 * `FST_ERR_CTP_ALREADY_PRESENT` at boot.
 */
export function installEmptyJsonBodyFix(app: FastifyInstance): void {
  app.addHook("onRequest", async (req) => {
    const len = req.headers["content-length"]
    const ct = req.headers["content-type"]
    if (
      (len === undefined || len === "0") &&
      typeof ct === "string" &&
      ct.includes("application/json")
    ) {
      delete req.headers["content-type"]
    }
  })
}
