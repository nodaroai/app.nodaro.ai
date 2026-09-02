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

/**
 * In-flight telemetry writes.
 *
 * The `app_reports` insert below is deliberately NOT awaited by the response
 * path — best-effort telemetry must never add latency to, or fail, the reply
 * it observes. That is right in production and a hazard in tests: the write
 * lands after the request has been answered, so under a slow enough run it
 * executes while a LATER test is in control of the shared Supabase mock, and
 * that test sees one extra `.insert()` it never made. It surfaced as a rare
 * "expected 4 calls, got 5" in generate-character.test.ts, only ever under
 * full-suite load, and it can reach any route test that both triggers a 500
 * and counts DB calls.
 *
 * Tracking the promise costs nothing at runtime and makes the write
 * awaitable, so a test boundary can be a real barrier.
 */
const inFlightReports = new Set<Promise<unknown>>()

function trackReport(p: Promise<unknown>): void {
  inFlightReports.add(p)
  void p.finally(() => inFlightReports.delete(p))
}

/**
 * Test hook — settle every best-effort telemetry write started so far.
 *
 * Loops because a write can start another turn of the microtask queue (the
 * lazy `import()` resolves, THEN the insert begins), so one `Promise.all` over
 * a snapshot is not enough.
 */
export async function __flushHttpErrorTelemetry(): Promise<void> {
  while (inFlightReports.size > 0) {
    await Promise.allSettled([...inFlightReports])
  }
}

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

function requestContext(req: FastifyRequest): { route: string; path: string; userId: string | null } {
  const path = (req.url ?? "").split("?")[0]
  return {
    path,
    route: req.routeOptions?.url ?? path,
    userId: (req as { userId?: string }).userId ?? null,
  }
}

/** Node stream / socket error codes a client can cause by going away
 *  mid-request (tab closed during an upload, connection dropped). */
const CLIENT_ABORT_CODES = new Set(["ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET", "ECONNABORTED"])

/**
 * True when the error is the CLIENT's disconnect, not ours. Both conditions
 * are required: the request socket must be gone (`req.raw.destroyed` — the
 * documented replacement for the deprecated `req.raw.aborted`, DEP0156) AND
 * the error must carry an abort code. Either alone misfires: an ECONNRESET
 * from an OUTBOUND provider fetch inside a handler is a genuine 5xx and must
 * keep filing a report (W0, 2026-09-01: 8 "Premature close" rows on
 * /v1/upload were filed as internal errors).
 */
export function isClientAbort(req: FastifyRequest, err: unknown): boolean {
  const destroyed = (req.raw as { destroyed?: boolean } | undefined)?.destroyed === true
  const code = (err as { code?: unknown } | null)?.code
  return destroyed && typeof code === "string" && CLIENT_ABORT_CODES.has(code)
}

/** Unauthenticated, bot-shaped 400s that carry no product signal. The skip is
 *  ROUTE-WIDE, so it also drops image-proxy's SSRF "URL resolves to a blocked
 *  address" 400 — which `routes/image-proxy.ts` still `req.log.warn`s. */
const STRUCTURED_FAILURE_ROUTE_SKIP = new Set(["/v1/image-proxy"])

/** Throttle-checked, fail-safe report of one HTTP incident into `app_reports`. */
function fileHttpReport(
  req: FastifyRequest,
  opts: {
    kind: string
    severity: "info" | "warning" | "error"
    title: string
    throttleKey: string
    payload: Record<string, unknown>
  },
): void {
  try {
    if (!shouldReportErrorKey(`${opts.kind} ${opts.throttleKey}`)) return
    const { route, path, userId } = requestContext(req)
    // Lazy import: app-reports pulls in the Supabase client at module load, and
    // http-errors is imported by app.ts + nearly every route — keep this module
    // dependency-free so importing it never requires a configured environment.
    trackReport(
      import("./app-reports.js")
      .then(({ insertAppReport }) =>
        insertAppReport({
          node: "http-error-net",
          kind: opts.kind,
          severity: opts.severity,
          title: opts.title,
          payload: {
            method: req.method,
            route,
            path,
            ...(typeof req.headers?.origin === "string" ? { origin: req.headers.origin } : {}),
            ...opts.payload,
          },
          userId,
        }),
      )
        .catch(() => {}),
    )
  } catch {
    // Telemetry must never break the response path it observes.
  }
}

function reportServerError(
  req: FastifyRequest,
  message: string,
  via: "route-catch" | "uncaught" | "sanitizer-net",
  err?: unknown,
): void {
  try {
    if (isClientAbort(req, err)) return
    const { route } = requestContext(req)
    fileHttpReport(req, {
      kind: "internal-error",
      severity: "error",
      title: `${req.method} ${route} — ${message}`,
      throttleKey: `${req.method} ${route} :: ${message.slice(0, 160)}`,
      payload: {
        message,
        via,
        ...(err instanceof Error && err.stack ? { stack: err.stack.slice(0, 2000) } : {}),
      },
    })
  } catch {
    // see fileHttpReport
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

/** Statuses the onSend net inspects. 500 for the sanitize+report flow; the
 *  rest are observe-only product-failure telemetry (never rewritten). */
const TELEMETRY_STATUSES = new Set([400, 402, 500, 503])

/** Observe-only telemetry for structured client-visible failures: credit
 *  walls, parameter rejects that never reach a provider, and missing-price
 *  misconfig. Reports into `app_reports`, response bytes untouched. */
function reportStructuredFailure(
  req: FastifyRequest,
  statusCode: number,
  body: { error?: { code?: string; message?: string; issues?: unknown }; required?: unknown; balance?: unknown },
): void {
  const code = body.error?.code
  const message = body.error?.message ?? ""
  const { route, userId } = requestContext(req)

  if (statusCode === 402 && code === "insufficient_credits") {
    // Keyed per user: the interesting fact is WHO keeps hitting the wall.
    fileHttpReport(req, {
      kind: "insufficient-credits",
      severity: "info",
      title: `Insufficient credits: ${req.method} ${route}`,
      throttleKey: `${req.method} ${route} :: ${userId ?? "anon"}`,
      payload: { message, required: body.required ?? null, balance: body.balance ?? null },
    })
  } else if (statusCode === 400 && code === "validation_error" && !STRUCTURED_FAILURE_ROUTE_SKIP.has(route)) {
    // Wrong parameters that never reach the provider — from our own UI these
    // are OUR bugs (the recurring stale-enum / Zod-reject class).
    fileHttpReport(req, {
      kind: "validation-reject",
      severity: "warning",
      title: `${req.method} ${route} — invalid parameters: ${message.slice(0, 200)}`,
      throttleKey: `${req.method} ${route} :: ${message.slice(0, 160)}`,
      payload: { message, issues: body.error?.issues ?? null },
    })
  } else if (statusCode === 503 && code === "price_not_configured") {
    // Hard-fail pricing policy tripped — ops-critical config gap.
    fileHttpReport(req, {
      kind: "price-not-configured",
      severity: "error",
      title: `Price not configured: ${req.method} ${route} — ${message.slice(0, 200)}`,
      throttleKey: `${req.method} ${route} :: ${message.slice(0, 160)}`,
      payload: { message },
    })
  }
}

/**
 * Global backstop: an `onSend` hook that rewrites the body of ANY `internal_error`
 * 500 response to the generic message (logging the original server-side first),
 * UNLESS the reply was produced by `sendInternalError` (which already curated +
 * logged it). This guarantees no route — present or future — can leak a raw error
 * message in an `internal_error` body just by forgetting the helper.
 *
 * Rewriting is deliberately narrow: only `statusCode === 500` bodies shaped
 * `{ error: { code: "internal_error", ... } }` are ever modified. The same hook
 * ALSO observes (never rewrites) 402 insufficient_credits, 400 validation_error
 * and 503 price_not_configured bodies for `app_reports` telemetry — see
 * `reportStructuredFailure`. Every other structured error (403 `forbidden`,
 * 409 `name_taken`, …) passes straight through untouched. SSE responses write
 * to `reply.raw` and bypass `onSend` entirely, so streams are unaffected.
 */
export function registerInternalErrorSanitizer(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    if (!TELEMETRY_STATUSES.has(reply.statusCode)) return payload
    if (typeof payload !== "string") return payload

    let body: { error?: { code?: string; message?: string; issues?: unknown }; required?: unknown; balance?: unknown }
    try {
      body = JSON.parse(payload)
    } catch {
      return payload // not JSON — leave as-is
    }
    if (!body || typeof body !== "object") return payload

    if (reply.statusCode !== 500) {
      reportStructuredFailure(req, reply.statusCode, body)
      return payload
    }

    if (sanitizedReplies.has(reply)) return payload
    if (body.error?.code !== "internal_error") return payload

    const raw = body.error.message
    if (raw && raw !== GENERIC_INTERNAL_MESSAGE) {
      // Keep full diagnostics in the logs; strip them from the wire.
      req.log.error({ rawMessage: raw, path: req.url }, "sanitized internal_error response body")
    }
    // Marked replies were already reported at the sendInternalError site; this
    // covers routes that composed an internal_error 500 by hand. No throwable
    // reaches here, so `isClientAbort` can never match on this path — a
    // hand-composed internal_error 500 during a client abort is still reported
    // (the 8 observed abort rows arrived via "uncaught", which IS covered).
    reportServerError(req, raw ?? GENERIC_INTERNAL_MESSAGE, "sanitizer-net")
    body.error.message = GENERIC_INTERNAL_MESSAGE

    const out = JSON.stringify(body)
    // onSend does not recompute content-length after a payload change — set it
    // explicitly or the shorter body is sent under a stale (larger) length.
    reply.header("content-length", Buffer.byteLength(out))
    return out
  })
}
