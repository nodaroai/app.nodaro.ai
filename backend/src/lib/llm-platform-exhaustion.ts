/**
 * The PLATFORM's own provider account cannot serve a model call: its prepaid
 * balance or quota ran out, or its key was refused.
 *
 * Nothing about it is the user's doing, and nothing the user can change fixes
 * it. Staging 2026-10-14 (job 61b2e080): a UGC Script run failed and stored the
 * vendor's raw reply as the job's error —
 * `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your
 * credit balance is too low to access the … API …"},"request_id":"req_…"}` —
 * a vendor name, a billing page and a request id on the user's screen. The
 * media lanes already said this one honestly (`providers/kie/client.ts`, the
 * sound-effect lane); the LLM lanes said it raw.
 *
 * One classifier for every LLM lane: {@link PLATFORM_EXHAUSTION_RULES} is DATA,
 * one row per provider shape, so a new provider or a new spelling is a row,
 * not a new branch in some adapter. It reads only an error's HTTP status (or a
 * service envelope's code) and its text — never its class — so it is the same
 * call for every SDK and wire.
 *
 * What a caller does with a match lives in `llm-client.ts`
 * (`LlmPlatformExhaustedError`): it is never transport-retried, a direct lane
 * that hit it is retried ONCE on KIE serving the same registry model, and the
 * person reads {@link platformExhaustionMessage} while the raw reply stays in
 * the operator's `error_detail` and logs.
 */
import { hasCredits } from "./config.js"

/** Why the platform's account refused: out of balance/quota, or the key itself. */
export type PlatformExhaustion = "billing" | "auth"

/** The two things the classifier reads off a failure. */
export interface ExhaustionSignal {
  /** HTTP status, or a 200-envelope's service code (KIE's `{code, msg}`). */
  status?: number
  /** The error's message plus any structured body it carries, as text. */
  text: string
}

interface ExhaustionRule {
  /** Whose shape this row describes — for the alert line, never for the user. */
  provider: string
  kind: PlatformExhaustion
  /** When set, the status must be one of these. */
  statuses?: readonly number[]
  /** When set, one of these must appear in the lower-cased text. */
  phrases?: readonly string[]
}

/**
 * Every known shape of "the platform's account cannot serve this".
 *
 * Precision over recall, because a false match hides a real reason behind
 * "out of capacity" and moves the call to another lane:
 * - A plain 429 is a RATE limit and stays the "busy" path with its transport
 *   retries. Only a 429 that names the account (`insufficient_quota`, a
 *   depleted prepayment) is matched — never the sentence "You exceeded your
 *   current quota, please check your plan and billing details", which Google
 *   sends for an ordinary per-minute limit as well.
 * - 401 / 402 / 403 on a model call are the platform's key or balance:
 *   nothing a request can carry makes a provider answer them.
 */
export const PLATFORM_EXHAUSTION_RULES: readonly ExhaustionRule[] = [
  // Anthropic: a drained balance is a 400 invalid_request_error.
  { provider: "anthropic", kind: "billing", phrases: ["credit balance is too low", "billing_error"] },
  { provider: "anthropic", kind: "auth", phrases: ["invalid x-api-key", "authentication_error", "permission_error"] },
  // OpenAI (and OpenAI-shaped aggregators): 429 with code insufficient_quota.
  { provider: "openai", kind: "billing", phrases: ["insufficient_quota", "billing_hard_limit_reached"] },
  { provider: "openai", kind: "auth", phrases: ["invalid_api_key", "incorrect api key", "account_deactivated"] },
  // Google Gemini API: prepaid credits gone, billing off, key invalid/expired.
  {
    provider: "google",
    kind: "billing",
    phrases: ["prepayment credits are depleted", "billing to be enabled", "billing is not enabled"],
  },
  { provider: "google", kind: "auth", phrases: ["api key not valid", "api_key_invalid", "api key expired"] },
  // OpenRouter: 402 "requires more credits".
  { provider: "openrouter", kind: "billing", phrases: ["requires more credits"] },
  // KIE: its LLM wire's envelope / HTTP 402 "Credits insufficient".
  { provider: "kie", kind: "billing", phrases: ["credits insufficient", "insufficient credits", "insufficient balance"] },
  // Any provider: the status alone says it.
  { provider: "any", kind: "billing", statuses: [402] },
  { provider: "any", kind: "auth", statuses: [401, 403] },
]

/** The first rule a failure matches, or null when it is not a platform-account failure. */
export function matchPlatformExhaustion(signal: ExhaustionSignal): ExhaustionRule | null {
  const text = signal.text.toLowerCase()
  for (const rule of PLATFORM_EXHAUSTION_RULES) {
    if (rule.statuses && (signal.status === undefined || !rule.statuses.includes(signal.status))) continue
    if (rule.phrases && !rule.phrases.some((p) => text.includes(p))) continue
    return rule
  }
  return null
}

export function classifyPlatformExhaustion(signal: ExhaustionSignal): PlatformExhaustion | null {
  return matchPlatformExhaustion(signal)?.kind ?? null
}

/**
 * The signal an SDK or wire error carries, read by shape: the Anthropic SDK's
 * `APIError` (`status`, `error` = the JSON body, `message` = "400 {…}"),
 * Google's `ApiError` (`status`, a JSON `message`), and `LlmLaneError`
 * (`httpStatus` / `bodyCode`, the wire text in `message`).
 */
export function exhaustionSignalOf(err: unknown): ExhaustionSignal | null {
  if (!err || typeof err !== "object") return null
  const e = err as { status?: unknown; httpStatus?: unknown; bodyCode?: unknown; message?: unknown; error?: unknown }
  const status = [e.status, e.httpStatus, e.bodyCode].find((s): s is number => typeof s === "number")
  let body = ""
  if (e.error && typeof e.error === "object") {
    try {
      body = JSON.stringify(e.error)
    } catch {
      body = ""
    }
  }
  const message = typeof e.message === "string" ? e.message : ""
  return { ...(status !== undefined ? { status } : {}), text: `${message} ${body}` }
}

/**
 * The sentence the person running a job reads when the platform's own
 * provider account is out — the one KIE's media lane already says, word for
 * word, so `lib/mcp/tools/_job-error.ts` reads it as transient everywhere.
 */
export const PLATFORM_CAPACITY_MESSAGE =
  "The generation service is temporarily out of capacity on our side — your credits were not charged. Please try again later or contact support."

/**
 * Edition-aware: on a self-hosted install there are no credits, and the
 * account that refused is the operator's own, so the sentence says what to
 * check rather than promising a refund. Names no vendor.
 */
export function platformExhaustionMessage(): string {
  return hasCredits()
    ? PLATFORM_CAPACITY_MESSAGE
    : "The AI model's provider account configured on this install is out of credit or its key was refused. " +
        "Check it in Install health → Provider keys."
}

/** One alert per provider + kind per this window, so a dry account cannot flood the logs. */
const ALERT_DEDUPE_MS = 60_000
const lastAlertAt = new Map<string, number>()

/**
 * The operator hook: a greppable `[ALERT]` line, the same marker the KIE
 * balance branch and the hourly KIE runway check emit. Deduplicated per
 * process for a minute; the raw provider text rides along (logs only).
 */
export function alertPlatformExhaustion(opts: {
  provider: string
  kind: PlatformExhaustion
  lane: string
  modelId: string
  detail: string
  now?: number
}): boolean {
  const now = opts.now ?? Date.now()
  const key = `${opts.provider}:${opts.kind}`
  const last = lastAlertAt.get(key)
  if (last !== undefined && now - last < ALERT_DEDUPE_MS) return false
  lastAlertAt.set(key, now)
  const what = opts.kind === "billing" ? "account out of credit / quota — top up required" : "API key refused — fix the key"
  console.error(
    `[ALERT] LLM provider ${opts.provider}: ${what} (lane ${opts.lane}, model ${opts.modelId}) — ` +
      opts.detail.replace(/\s+/g, " ").slice(0, 400),
  )
  return true
}

/** Test seam: forget every alert already sent. */
export function __resetPlatformExhaustionAlerts(): void {
  lastAlertAt.clear()
}
