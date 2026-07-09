import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

/** The single generic string every unmarked `internal_error` 500 collapses to. */
const GENERIC_INTERNAL_MESSAGE = "Internal server error"

/**
 * Replies produced by `sendInternalError` are recorded here so the `onSend`
 * net below leaves their message untouched. We key on the reply OBJECT (not the
 * message text) because a raw DB leak and an intentional friendly message are
 * both just non-generic strings — intent is the only reliable signal, and this
 * is how a route declares "this message is safe, and I already logged the
 * error". A WeakSet means dead replies are GC'd with no bookkeeping.
 */
const sanitizedReplies = new WeakSet<object>()

/**
 * Send a sanitized HTTP 500 without leaking internal detail to the client.
 *
 * The real error (raw DB/provider messages, stack) is logged server-side via
 * `req.log` and is NEVER placed in the response body. Clients only ever see the
 * stable machine-readable `internal_error` code plus a safe, generic message.
 *
 * Behaviour-neutral for consumers: the SDK (`throwFromResponse`), CLI, frontend
 * (`throwApiError`) and studio all dispatch on `error.code` / HTTP status, never
 * on the message text — so swapping a raw message for a curated one changes only
 * display strings, not control flow.
 *
 * Pairs with `registerInternalErrorSanitizer`: this marks the reply so the net
 * preserves the caller's `clientMessage`; any `internal_error` 500 that does NOT
 * go through here is genericized by the net as a backstop.
 */
export function sendInternalError(
  reply: FastifyReply,
  req: FastifyRequest,
  err: unknown,
  clientMessage = GENERIC_INTERNAL_MESSAGE,
): FastifyReply {
  req.log.error({ err }, clientMessage)
  sanitizedReplies.add(reply)
  return reply.status(500).send({
    error: { code: "internal_error", message: clientMessage },
  })
}

/**
 * Global backstop: an `onSend` hook that rewrites the body of ANY `internal_error`
 * 500 response to the generic message (logging the original server-side first),
 * UNLESS the reply was produced by `sendInternalError` (which already curated +
 * logged it). This guarantees no route — present or future — can leak a raw error
 * message in an `internal_error` body just by forgetting the helper.
 *
 * Scope is deliberately narrow so nothing else is touched:
 *  - only `statusCode === 500`
 *  - only bodies shaped `{ error: { code: "internal_error", ... } }`
 * Structured errors (402 insufficient_credits, 403 forbidden, 409 name_taken, …)
 * have different codes/statuses and pass straight through untouched. SSE responses
 * write to `reply.raw` and bypass `onSend` entirely, so streams are unaffected.
 */
export function registerInternalErrorSanitizer(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode !== 500) return payload
    if (sanitizedReplies.has(reply)) return payload
    if (typeof payload !== "string") return payload

    let body: { error?: { code?: string; message?: string } }
    try {
      body = JSON.parse(payload)
    } catch {
      return payload // not JSON — leave as-is
    }
    if (!body || typeof body !== "object" || body.error?.code !== "internal_error") {
      return payload
    }

    const raw = body.error.message
    if (raw && raw !== GENERIC_INTERNAL_MESSAGE) {
      // Keep full diagnostics in the logs; strip them from the wire.
      req.log.error({ rawMessage: raw, path: req.url }, "sanitized internal_error response body")
    }
    body.error.message = GENERIC_INTERNAL_MESSAGE

    const out = JSON.stringify(body)
    // onSend does not recompute content-length after a payload change — set it
    // explicitly or the shorter body is sent under a stale (larger) length.
    reply.header("content-length", Buffer.byteLength(out))
    return out
  })
}
