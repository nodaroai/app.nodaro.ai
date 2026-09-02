/**
 * The single write-side chokepoint for `jobs.error_detail` (migration 367,
 * spec 2026-09-01-app-reports-triage-design.md §6.1-6.2).
 *
 * A provider's raw error is diagnostic gold (the KIE failCode/failMsg, the
 * echoed field name of a rejected parameter) and a leak hazard (KIE echoes
 * request URLs, result JSON carries output media URLs, moderation messages
 * quote the prompt). This helper keeps the text and the URL HOST — the host
 * is the signal (R2 vs CDN vs provider) — and drops everything after it,
 * strips bearer/secret query values, then caps the length. Every writer of
 * error_detail MUST go through here; a writer that stores raw text is a bug.
 *
 * Deliberately dependency-free (no KieError import): it is called from the
 * worker, the reconcile writers and the plugin toolkit, and duck-types the
 * `{ internalDetails: string }` shape that KieError carries.
 */

export const ERROR_DETAIL_MAX = 500

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi
const SECRET_QUERY_RE = /([?&](?:signature|sig|token|access_token|api_key|apikey|key)=)[^&\s"'<>]+/gi

export function redactProviderDetail(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null
  let s = raw.replace(URL_RE, (u) => {
    try {
      return `${new URL(u).host}/…`
    } catch {
      return "<url>"
    }
  })
  s = s.replace(BEARER_RE, "Bearer <redacted>")
  s = s.replace(SECRET_QUERY_RE, "$1<redacted>")
  s = s.replace(/\s+/g, " ").trim()
  if (s.length === 0) return null
  return s.length > ERROR_DETAIL_MAX ? s.slice(0, ERROR_DETAIL_MAX) : s
}

/** The redacted detail for a thrown error, or null when the error carries no
 *  provider text (a plain Error, a string, undefined). */
export function providerDetailOf(err: unknown): string | null {
  if (!err || typeof err !== "object") return null
  const details = (err as { internalDetails?: unknown }).internalDetails
  return typeof details === "string" ? redactProviderDetail(details) : null
}

/**
 * One line, at failure time, from a path that otherwise says nothing.
 *
 * WHY THIS EXISTS (spec §11.3, log pull 2026-09-02): nine G1 rows — six from a
 * single ~7-minute burst, one user, all gpt-image-2 — produced NO log line at
 * all while the same deployment logged other traffic in the window.
 * `lib/reconcile/kie.ts` had zero `console.*` calls, and `bump-attempts.ts`
 * logged only at exhaustion, so a job the cron failed left no trace anywhere
 * and the raw provider text was unrecoverable even from historical logs.
 *
 * ONE line on purpose: Railway log filters match single lines, so an
 * id-filtered search must surface the actual error rather than a bare prefix
 * (same rationale as workers/video-worker.ts's single-line failure log).
 * Redaction happens HERE so no call site can forget it; it is idempotent on
 * text a writer already passed through `redactProviderDetail`/`providerDetailOf`.
 */
export function logProviderFailure(
  scope: string,
  jobId: string,
  userMessage: string,
  detail: string | null | undefined,
): void {
  const redacted = redactProviderDetail(detail) ?? "<none>"
  console.error(
    `[${scope}] job ${jobId} failed: ${userMessage.slice(0, 200)} | provider: ${redacted}`,
  )
}
