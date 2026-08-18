import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

/** The single generic string every unmarked `internal_error` 500 collapses to. */
const GENERIC_INTERNAL_MESSAGE = "Internal server error"

/**
 * Server-error telemetry: every 5xx the API produces — an uncaught route throw,
 * a `sendInternalError` call, or a body the sanitizer net had to genericize —
 * also drops a `kind: "internal-error"` row into `app_reports`, so real user-
 * facing failures surface in /admin/app-reports instead of living only in
 * container logs. Best-effort by contract (insertAppReport swallows failures)
 * and throttled per (method, route, message) so an error storm on one endpoint
 * produces one report per window, not thousands of rows.
 */
const ERROR_REPORT_THROTTLE_MS = 5 * 60_000
const recentErrorReports = new Map<string, number>()

/** Test hook — clears the in-process throttle window. */
export function __resetHttpErrorTelemetry(): void {
  recentErrorReports.clear()
}

function shouldReportErrorKey(key: string): boolean {
  const now = Date.now()
  const last = recentErrorReports.get(key)
  if (last !== undefined && now - last < ERROR_REPORT_THROTTLE_MS) return false
  recentErrorReports.set(key, now)
  if (recentErrorReports.size > 500) {
    for (const [k, ts] of recentErrorReports) {
      if (now - ts >= ERROR_REPORT_THROTTLE_MS) recentErrorReports.delete(k)
    }
  }
  return true
}

function reportServerError(
  req: FastifyRequest,
  message: string,
  via: "route-catch" | "uncaught" | "sanitizer-net",
  err?: unknown,
): void {
  try {
    const path = (req.url ?? "").split("?")[0]
    const route = req.routeOptions?.url ?? path
    if (!shouldReportErrorKey(`${req.method} ${route} :: ${message.slice(0, 160)}`)) return
    // Lazy import: app-reports pulls in the Supabase client at module load, and
    // http-errors is imported by app.ts + nearly every route — keep this module
    // dependency-free so importing it never requires a configured environment.
    void import("./app-reports.js")
      .then(({ insertAppReport }) =>
        insertAppReport({
          node: "http-error-net",
          kind: "internal-error",
          severity: "error",
          title: `${req.method} ${route} — ${message}`,
          payload: {
            method: req.method,
            route,
            path,
            message,
            via,
            ...(err instanceof Error && err.stack ? { stack: err.stack.slice(0, 2000) } : {}),
            ...(typeof req.headers?.origin === "string" ? { origin: req.headers.origin } : {}),
          },
          userId: (req as { userId?: string }).userId ?? null,
        }),
      )
      .catch(() => {})
  } catch {
    // Telemetry must never break the error-response path it observes.
  }
}

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
  reportServerError(req, err instanceof Error ? err.message : clientMessage, "route-catch", err)
  sanitizedReplies.add(reply)
  return reply.status(500).send({
    error: { code: "internal_error", message: clientMessage },
  })
}

/**
 * Error telemetry for UNCAUGHT route errors: Fastify's default error handler
 * turns a thrown error into a 500 without passing through `sendInternalError`
 * or matching the sanitizer net's body shape, so without this hook those
 * failures never reach `app_reports`. `onError` observes the error (with its
 * stack) and cannot modify the reply, so response behavior is untouched.
 * Register alongside `registerInternalErrorSanitizer` in app.ts.
 */
export function registerErrorTelemetry(app: FastifyInstance): void {
  app.addHook("onError", async (req, _reply, error) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status < 500) return // 4xx = client errors (validation, auth) — not telemetry
    reportServerError(req, error.message || "Unknown error", "uncaught", error)
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
    // Marked replies were already reported at the sendInternalError site; this
    // covers routes that composed an internal_error 500 by hand.
    reportServerError(req, raw ?? GENERIC_INTERNAL_MESSAGE, "sanitizer-net")
    body.error.message = GENERIC_INTERNAL_MESSAGE

    const out = JSON.stringify(body)
    // onSend does not recompute content-length after a payload change — set it
    // explicitly or the shorter body is sent under a stale (larger) length.
    reply.header("content-length", Buffer.byteLength(out))
    return out
  })
}
