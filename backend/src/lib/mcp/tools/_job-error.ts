/**
 * Classify a failed job's free-text `error_message` so MCP poll tools
 * (`get_asset`) can tell the model whether retrying the SAME request is
 * pointless — otherwise a permanent failure (e.g. a content-policy block)
 * reads as transient and the model burns credits re-running it.
 *
 * NON-retryable = the same input will fail the same way:
 *  - content-policy / safety / moderation blocks. KIE sanitizes these to
 *    "Content policy violation: The output was blocked by the provider's
 *    safety filter. Try modifying your prompt or input image."
 *    (see providers/kie/client.ts), but other providers reach this layer
 *    with their own wording, so we match on keywords, provider-agnostic.
 *  - input-shape limits (file too large / too long / over a duration cap).
 *
 * Everything else — provider timeout, 5xx, rate limit, "please try again",
 * or no recorded reason — is treated as retryable. The bias is deliberate:
 * only mark non-retryable on high-confidence permanent signals so we never
 * discourage re-running a genuinely transient failure.
 */
// Content-policy / moderation (permanent for the given prompt/image). Split
// out so the app-report rejection sweep can classify EXACTLY this subset —
// input-shape limits are non-retryable too, but they aren't rejections.
const CONTENT_REJECTION_PATTERNS = [
  "content policy",
  "safety filter",
  "safety policy",
  "nsfw",
  "prohibited",
  "inappropriate",
  "violat", // violation / violates
  // NOT the bare word "filtered": ffmpeg's own diagnostics contain it ("No
  // filtered frames for output stream"), which mislabeled plain ffmpeg
  // failures as content rejections in the app-report sweep (2026-07-20
  // extract-frame reports). Match provider-style phrasings only.
  "content filtered",
  "was filtered",
  "filtered by",
  "filtered due",
  // "moderat" (not "moderation"): the provider says "caught by our AI
  // moderator" and the noun form matched nothing, so the block read as
  // retryable to every MCP caller (prod report 2026-09-07). Mirrors the same
  // widening in providers/kie/client.ts SAFETY_RE.
  "moderat",
  // W0 (2026-09-01): the KIE copyright / likeness messages
  // (providers/kie/client.ts CONTENT_POLICY_MESSAGES + the sanitizer's
  // "Blocked for copyright") were filed as plain job failures. Match the
  // short discriminating fragments, never the full sentences.
  "declined this generation",
  "blocked for copyright",
  "real person's likeness",
]

// Input-shape limits (permanent until the caller changes the input).
const INPUT_LIMIT_PATTERNS = [
  "exceeds",
  "too large",
  "too long",
  "file size",
  "duration limit",
  // The provider answered the REQUEST with 400/422 — `createSanitizedError`'s
  // request-reject branch (providers/kie/client.ts, isRequestRejectStatus).
  // Permanent for these inputs, so an MCP caller must not re-run it unchanged;
  // NOT a content rejection, so it stays out of CONTENT_REJECTION_PATTERNS and
  // the app-report sweep keeps filing it as `job-failure`, never as a
  // provider content block.
  "rejected these settings",
  // NOT "gave no reason": the same branch when the 4xx carried only the
  // provider's catch-all sentence ("Generation failed. Please try again
  // later.", job 4064e12e) is retryable — the provider named no permanent
  // cause, and its own words say to try again.
  // The UGC speech split's own deterministic failures: the take, its word
  // timings and the script disagree, or no set of pauses cuts the take within
  // the limits. Each message starts with an uppercase code, matched here
  // lowercased. A re-run of the same take and script fails identically, so
  // only a changed script or recording can succeed. Not content rejections.
  "alignment_mismatch",
  "segmenttexts:",
  "speech_too_long",
  "no_pause_set",
]

// The provider ran and found NOTHING to act on: the input is legal, it just
// produced an empty result (Grounded SAM detecting zero regions for the mask
// prompt — providers/replicate/failure-messages.ts). Permanent for the same
// request, so non-retryable, but deliberately NOT a content rejection: nothing
// was blocked, and the app-report rejection sweep must not read it as one.
const NO_MATCH_PATTERNS = [
  "no region matched",
]

const NON_RETRYABLE_PATTERNS = [
  ...CONTENT_REJECTION_PATTERNS,
  ...INPUT_LIMIT_PATTERNS,
  ...NO_MATCH_PATTERNS,
]

/**
 * True when the error reads as a provider content-policy / moderation block —
 * the safety-filter subset of the non-retryable vocabulary. Used by the
 * app-report rejection sweep; absent/unknown reasons are NOT rejections.
 */
/**
 * Local tool output, never a provider verdict: `runFfmpeg` prefixes every
 * shell failure with "ffmpeg failed:" and appends the raw stderr dump, which
 * can contain ANY keyword (filter-graph diagnostics, codec banners). Keyword
 * matching over that blob is meaningless — bail out before it.
 */
function isLocalFfmpegError(lower: string): boolean {
  return lower.startsWith("ffmpeg failed")
}

export function isContentRejection(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false
  const lower = errorMessage.toLowerCase()
  if (isLocalFfmpegError(lower)) return false
  return CONTENT_REJECTION_PATTERNS.some((p) => lower.includes(p))
}

export type RejectionClass = "copyright" | "likeness" | "safety"

/** Which kind of content block a rejection message describes. Copyright is
 *  tested first (its messages also say "violation"), then likeness, then any
 *  other rejection is safety/moderation. Null when not a rejection at all. */
export function rejectionClassOf(errorMessage: string | null | undefined): RejectionClass | null {
  if (!isContentRejection(errorMessage)) return null
  const lower = errorMessage!.toLowerCase()
  if (lower.includes("copyright") || lower.includes("intellectual property") || lower.includes("trademark")) return "copyright"
  if (lower.includes("likeness") || lower.includes("public figure") || lower.includes("celebrit")) return "likeness"
  return "safety"
}

/**
 * The platform's own provider account was out (balance, quota or key) — the
 * sentence `PLATFORM_CAPACITY_MESSAGE` (lib/llm-platform-exhaustion.ts) that
 * every lane says it with. Transient by construction: the same request
 * succeeds once the account is topped up, and no NON_RETRYABLE pattern may
 * ever claim it (guarded by its test).
 */
const PLATFORM_CAPACITY_FRAGMENT = "out of capacity on our side"

export function isPlatformCapacityOutage(errorMessage: string | null | undefined): boolean {
  return typeof errorMessage === "string" && errorMessage.toLowerCase().includes(PLATFORM_CAPACITY_FRAGMENT)
}

/**
 * True when re-running the same request could plausibly succeed. Defaults to
 * `true` (transient) for an unknown or absent reason; returns `false` only on
 * a high-confidence permanent-failure signal.
 */
export function isRetryableFailure(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return true
  const lower = errorMessage.toLowerCase()
  // ffmpeg stderr keywords are not high-confidence permanence signals —
  // default to retryable, per the bias documented above.
  if (isLocalFfmpegError(lower)) return true
  return !NON_RETRYABLE_PATTERNS.some((p) => lower.includes(p))
}

/**
 * PR9 (2026-09-03) — `jobs.error_hint` (migration 376) carries the worker's
 * OWN safety-block verdict, which is strictly more useful to an MCP client
 * than re-deriving one from `error_message` keywords: it names the exact
 * class, whether the worker already spent its one bonus attempt, and — when
 * the catalog declares a fallback for the model that failed — a REAL model id
 * the same prompt/references can be retried on.
 *
 * `retryable` stays exactly `isRetryableFailure(error_message)` — a
 * safety-block is never retryable as the SAME request, and every
 * `safetyBlockMessage()` / KIE content-policy string already reads as
 * non-retryable via the keyword classifier above, so there is nothing to
 * override. `error_hint` only changes `guidance` (and adds `suggestedProvider`
 * when the hint offers one) — it is additive, not a second source of truth
 * for `retryable`.
 *
 * THE ONE DELIBERATE EXCEPTION — `kind: "policy-block"` (spec
 * 2026-09-03-job-policy-hook-design §6.5). The reasoning above depends on the
 * message being OURS or KIE's. A policy block's message is written by an
 * arbitrary registered policy in whatever language its deployment speaks, so it
 * matches none of NON_RETRYABLE_PATTERNS and `isRetryableFailure` answers
 * `true` — and an MCP agent then re-runs a permanently blocked request in a
 * loop against a gate that will block it identically every time. For that arm
 * the hint IS the source of truth.
 *
 * `kind: "credits"` is the same case: the job ran out of credits partway (a
 * step's own reservation was refused), was refunded, and the identical request
 * fails again until the balance or the cap changes — so `retryable: false` and
 * guidance to top up, whatever words the message happens to use.
 *
 * A refused INPUT VIDEO is the same case again: `kind: "input-refused"` (the
 * provider refused the file without naming a policy class — "File processing
 * failed" reads as transient to the classifier) or a safety-block with
 * `subject: "input_video"`. The provider refused the clip itself, so the same
 * clip is refused again on any retry — `retryable: false`, and the guidance
 * names the input to change instead of the prompt or a fallback model.
 */
export function failureGuidance(job: {
  error_message?: string | null
  error_hint?: unknown
}): { retryable: boolean; suggestedProvider?: string; guidance: string } {
  const retryable = isRetryableFailure(job.error_message)
  const hint = job.error_hint as
    | { kind?: unknown; suggestedProvider?: unknown; reason?: unknown; code?: unknown; subject?: unknown }
    | null
    | undefined

  // FIRST — before the safety-block arm and before the message classifier: a
  // policy reason routinely contains the same words a provider refusal does,
  // and only the structured `kind` can tell whose decision it was.
  if (hint && hint.kind === "policy-block") {
    const reason = typeof hint.reason === "string" && hint.reason.trim() ? hint.reason.trim() : null
    return {
      // See the exception documented above: NOT isRetryableFailure(message).
      retryable: false,
      guidance:
        "This was blocked by THIS DEPLOYMENT's content policy — not by the model provider. " +
        "Retrying the identical request will be blocked again, and switching providers will not help. " +
        (reason ? `Reason given: ${reason}. ` : "") +
        "Change the prompt or inputs, or report the reason to the user.",
    }
  }

  // A credits refusal partway through (a step's own reservation was refused):
  // the job was refunded, and the same request fails again until the balance
  // or the cap changes — so not retryable as-is, whatever the message says.
  if (hint && hint.kind === "credits") {
    const code = typeof hint.code === "string" && /^[a-z0-9_]{1,64}$/.test(hint.code) ? hint.code : null
    return {
      retryable: false,
      guidance:
        "The account ran out of credits partway through this job" +
        (code ? ` (${code})` : "") +
        ", so it stopped and its credits were refunded. Ask the user to top up (check_balance shows the balance) " +
        "or raise the plan or workspace cap, then run the same request again.",
    }
  }

  // The provider refused the INPUT VIDEO itself (with or without a policy
  // class): the clip is what failed, so neither the same request nor the
  // fallback model is offered — only a different clip can succeed.
  if (
    hint &&
    (hint.kind === "input-refused" || (hint.kind === "safety-block" && hint.subject === "input_video"))
  ) {
    return {
      retryable: false,
      guidance:
        "The provider refused the input video itself; the same clip will be refused again. " +
        "Send a different clip (or ask the user for one) — changing the prompt or retrying will not help.",
    }
  }

  if (hint && hint.kind === "safety-block") {
    const suggestedProvider =
      typeof hint.suggestedProvider === "string" ? hint.suggestedProvider : undefined
    return suggestedProvider
      ? {
          retryable,
          suggestedProvider,
          guidance:
            `The provider's safety filter blocked this output twice; retry the SAME ` +
            `prompt and references with provider "${suggestedProvider}".`,
        }
      : {
          retryable,
          guidance: "The provider's safety filter blocked this output; change the prompt or the input image.",
        }
  }

  if (isPlatformCapacityOutage(job.error_message)) {
    return {
      retryable: true,
      guidance:
        "The platform's own provider capacity was out — nothing about this request caused it, and its credits " +
        "were refunded. Retry the SAME request unchanged after a few minutes; changing the prompt or inputs will not help.",
    }
  }

  return {
    retryable,
    guidance: retryable
      ? "This may be transient — retrying the same request is reasonable."
      : "This is a permanent failure for this input: do NOT retry the same " +
        "request unchanged. Change the prompt/input, or report the reason to the user.",
  }
}
