// @reads-none reads and writes one jobs column through the service-role client; reads no repo file
/**
 * The metered LLM billing ledger of a job — THE way to read or write it.
 *
 * The ledger (`{ costUsd, source, calls, lanes, … }`) is the provider's own
 * dollar cost and the serving lanes of a metered LLM job: Nodaro's economics,
 * never shown to the person who ran the job. It lives in the server-only
 * column `jobs.llm_billing` (migration 552), granted to no client role — never
 * in `output_data`, which the job's owner reads straight over PostgREST and on
 * every Realtime UPDATE (migration 347's grant), whatever the API redacts.
 *
 * Every call here runs on the service-role client: use it from the settle,
 * the reconcile sweep, a cancel's classification, admin tooling and cost
 * monitoring — never to answer a user with what it reads. A user-facing
 * serializer must not select the column; `src/__tests__/llm-billing-ledger-private.test.ts`
 * fails a new file that names it, and any `output_data` that carries a
 * `billing` key.
 */
import { supabase } from "./supabase.js"
import type { LlmServedLane } from "./llm/types.js"
import { LLM_BILLING_LEDGER_COLUMN } from "./llm-metered-schema-probe.js"
import { IN_FLIGHT_JOB_STATUSES, isParkedJobStatus } from "./job-status.js"

/** The `jobs` column the ledger lives in (migration 552) — declared beside the R33 probe, a leaf module. */
export { LLM_BILLING_LEDGER_COLUMN }

/**
 * A job's billing ledger: what the settle recorded (`LlmBillingRecord`), or,
 * for a billed call whose cost could not be computed, `costUsd: null` with
 * `source: "uncomputable"`. Extra fields a feature records beside it (a
 * multi-call feature's `chargeId`) ride along.
 */
export interface LlmBillingLedger {
  costUsd: number | null
  source: "kie-stated" | "kie-size-estimate" | "provider-usage" | "abort-estimate" | "floor" | "uncomputable"
  /** Attempts billed. `> 0` is what marks the job billed (`llmBillingLedgerBilled`). */
  calls: number
  lanes: LlmServedLane[]
  /**
   * The charge id the ledger was recorded under (`<feature>:<model>`). Every
   * ledger WRITTEN carries it ({@link writeLlmBillingLedger} requires it); a
   * ledger READ may predate that.
   */
  chargeId?: string
  /**
   * A worker job's running ledger: every attempt billed so far, across BullMQ
   * attempts (R31) — what a retry of the job seeds its spend from. The settle's
   * final ledger has none.
   */
  attempts?: unknown[]
  /**
   * A fixed + metered-calls job's running ledger (the scrapes' per-item
   * analysis, `lib/llm-fixed-plus-calls.ts`): how many of its calls have
   * STARTED and not yet been recorded. Written, CAS on a live row, before each
   * call is sent; a cancel that finds it above 0 keeps the hold for the job's
   * own settle (a call is in flight), never committing or refunding under it.
   */
  inFlight?: number
}

/** A ledger as written: its charge id is always recorded. */
export type LlmBillingLedgerWrite = LlmBillingLedger & { chargeId: string }

/** Is `value` a billing ledger the settle wrote (an object with a numeric `calls`)? Pure — for a row already read. */
export function isLlmBillingLedger(value: unknown): value is LlmBillingLedger {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { calls?: unknown }).calls === "number"
}

/** Did the ledger record a billed call (`calls > 0`)? */
export function llmBillingLedgerBilled(value: unknown): boolean {
  return isLlmBillingLedger(value) && value.calls > 0
}

/**
 * Read a job's ledger by id. `{ ok: true, ledger }` — the ledger, or null when
 * the job has none (a tier job, or one not settled yet);
 * `{ ok: false, error }` — the read failed: a caller deciding money (refund or
 * charge) must treat this as unknown, never as "no ledger".
 */
export async function readLlmBillingLedger(jobId: string): Promise<{ ok: true; ledger: LlmBillingLedger | null } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.from("jobs").select(LLM_BILLING_LEDGER_COLUMN).eq("id", jobId).maybeSingle()
    if (error) return { ok: false, error: error.message }
    const value = (data as Record<string, unknown> | null)?.[LLM_BILLING_LEDGER_COLUMN]
    return { ok: true, ledger: isLlmBillingLedger(value) ? value : null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Read a job's ledger together with its cumulative `provider_cost`, in ONE
 * select — what a worker's start carry and floor compare (R31). Same answer
 * shape as {@link readLlmBillingLedger}; `providerCost` is absent when the row
 * has none.
 */
export async function readLlmBillingLedgerAndCost(
  jobId: string,
): Promise<{ ok: true; ledger: LlmBillingLedger | null; providerCost?: number } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.from("jobs").select(`provider_cost, ${LLM_BILLING_LEDGER_COLUMN}`).eq("id", jobId).maybeSingle()
    if (error) return { ok: false, error: error.message }
    const row = data as Record<string, unknown> | null
    const value = row?.[LLM_BILLING_LEDGER_COLUMN]
    const providerCost = row?.provider_cost
    return {
      ok: true,
      ledger: isLlmBillingLedger(value) ? value : null,
      ...(typeof providerCost === "number" ? { providerCost } : {}),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Read the ledgers of a batch of jobs (a cancel-all's flipped jobs). `{ ok:
 * true, ledgers }` maps each job that HAS a ledger to it (a job with none is
 * absent); `{ ok: false }` — the read failed, every job's ledger is unknown.
 */
export async function readLlmBillingLedgers(
  jobIds: readonly string[],
): Promise<{ ok: true; ledgers: Map<string, LlmBillingLedger> } | { ok: false; error: string }> {
  const ledgers = new Map<string, LlmBillingLedger>()
  if (jobIds.length === 0) return { ok: true, ledgers }
  try {
    const { data, error } = await supabase
      .from("jobs") // tenant-scope-ignore: ids the caller already owns
      .select(`id, ${LLM_BILLING_LEDGER_COLUMN}`)
      .in("id", [...jobIds])
    if (error) return { ok: false, error: error.message }
    for (const row of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
      const value = row[LLM_BILLING_LEDGER_COLUMN]
      if (typeof row.id === "string" && isLlmBillingLedger(value)) ledgers.set(row.id, value)
    }
    return { ok: true, ledgers }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Write a job's ledger by id (replacing any earlier one). Never throws;
 * answers whether it was written (a failure is warned; the charge itself is
 * recorded in `provider_cost` / `credits_actual`, never here). `providerCost`
 * rides the SAME update when given (a worker's running spend: the cost and the
 * attempts it sums are written together, never one without the other).
 */
export async function writeLlmBillingLedger(
  jobId: string,
  ledger: LlmBillingLedgerWrite,
  opts: { providerCost?: number } = {},
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ [LLM_BILLING_LEDGER_COLUMN]: ledger, ...(opts.providerCost !== undefined ? { provider_cost: opts.providerCost } : {}) })
      .eq("id", jobId)
    if (!error) return true
    console.warn(`[llm-billing] failed to record the billing ledger on job ${jobId}: ${error.message}`)
    return false
  } catch (err) {
    console.warn(`[llm-billing] failed to record the billing ledger on job ${jobId}: ${(err as Error).message}`)
    return false
  }
}

/**
 * Write a job's running ledger ONLY while the row is live (in flight, not
 * parked) — the call-start CAS of a fixed + metered-calls job: `"written"` —
 * the call may be sent; `"not-live"` — the row was cancelled (or finished)
 * first: the call must NOT be sent; `"error"` — not written: not sent either.
 */
export async function writeLlmBillingLedgerIfLive(jobId: string, ledger: LlmBillingLedgerWrite): Promise<"written" | "not-live" | "error"> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({ [LLM_BILLING_LEDGER_COLUMN]: ledger })
      .eq("id", jobId)
      .in("status", [...PRE_CALL_LIVE_STATUSES])
      .select("id")
    if (error) {
      console.warn(`[llm-billing] job ${jobId}: could not record its call's start: ${error.message}`)
      return "error"
    }
    return Array.isArray(data) && data.length > 0 ? "written" : "not-live"
  } catch (err) {
    console.warn(`[llm-billing] job ${jobId}: could not record its call's start:`, err)
    return "error"
  }
}

/** Clear a job's ledger column (a fixed + calls job whose calls billed nothing). Never throws. */
export async function clearLlmBillingLedger(jobId: string): Promise<void> {
  try {
    const { error } = await supabase.from("jobs").update({ [LLM_BILLING_LEDGER_COLUMN]: null }).eq("id", jobId)
    if (error) console.warn(`[llm-billing] job ${jobId}: could not clear its running ledger: ${error.message}`)
  } catch (err) {
    console.warn(`[llm-billing] job ${jobId}: could not clear its running ledger:`, err)
  }
}

// ── R38: the pre-call marker ─────────────────────────────────────────────────
//
// A metered LLM WORKER job is stamped (`provider_call_started_at`) at pickup —
// the reconcile sweep's crash backstop for every worker job — long before its
// first LLM call (an analysis wait, preprocessing). A cancel that read the
// stamp alone (R36) treated every picked-up job as "its call has started" and
// kept its hold. So the worker marks the row "pre-call" in this column when it
// opens its metered billing, and clears the marker — re-stamping
// `provider_call_started_at` — immediately before its first call (a CAS on a
// live status, so a row cancelled first never makes the call). A cancel that
// sees the marker knows nothing has been sent: the hold is refunded at once.
// The marker is not a ledger (`isLlmBillingLedger` is false for it), so every
// ledger reader sees "no ledger" — it never marks a job billed.

/** The pre-call marker {@link writeLlmPreCallMarker} writes in the ledger column. */
export interface LlmPreCallMarker {
  preCall: true
  /** The metered charge id the job's hold was reserved under. */
  chargeId: string
}

/** Is `value` the pre-call marker (and not a ledger)? Pure — for a row already read. */
export function isLlmPreCallMarker(value: unknown): value is LlmPreCallMarker {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (value as { preCall?: unknown }).preCall === true &&
    !isLlmBillingLedger(value)
}

/** The live statuses a pre-call write may touch: in flight and not parked on a reviewer. */
const PRE_CALL_LIVE_STATUSES: readonly string[] = IN_FLIGHT_JOB_STATUSES.filter((s) => !isParkedJobStatus(s))

/**
 * Mark a live metered worker job "pre-call" — only when its ledger column is
 * empty or already holds a marker (a crashed earlier attempt's): a billed
 * earlier attempt's ledger is never replaced. Answers whether THIS write put
 * the marker on the row. Never throws (a failure leaves the row unmarked: a
 * cancel then keeps the hold, R36's conservative answer).
 */
export async function writeLlmPreCallMarker(jobId: string, chargeId: string): Promise<boolean> {
  try {
    const marker: LlmPreCallMarker = { preCall: true, chargeId }
    const { data, error } = await supabase
      .from("jobs")
      .update({ [LLM_BILLING_LEDGER_COLUMN]: marker })
      .eq("id", jobId)
      .in("status", [...PRE_CALL_LIVE_STATUSES])
      .or(`${LLM_BILLING_LEDGER_COLUMN}.is.null,${LLM_BILLING_LEDGER_COLUMN}->>preCall.eq.true`)
      .select("id")
    if (error) {
      console.warn(`[llm-billing] job ${jobId}: could not mark it pre-call: ${error.message}`)
      return false
    }
    return Array.isArray(data) && data.length > 0
  } catch (err) {
    console.warn(`[llm-billing] job ${jobId}: could not mark it pre-call:`, err)
    return false
  }
}

/**
 * The job's first LLM call is about to be sent: clear the pre-call marker and
 * stamp `provider_call_started_at`, in ONE update, CAS on a live status and on
 * the marker. `"started"` — the row is now "call started"; `"not-live"` — the
 * row is no longer live (cancelled first): the call must NOT be made;
 * `"error"` — the write failed: the call must not be made either (a cancel
 * would read the marker and refund a call in flight).
 */
export async function clearLlmPreCallMarker(jobId: string): Promise<"started" | "not-live" | "error"> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({ [LLM_BILLING_LEDGER_COLUMN]: null, provider_call_started_at: new Date().toISOString() })
      .eq("id", jobId)
      .in("status", [...PRE_CALL_LIVE_STATUSES])
      .eq(`${LLM_BILLING_LEDGER_COLUMN}->>preCall`, "true")
      .select("id")
    if (error) {
      console.warn(`[llm-billing] job ${jobId}: could not record its first call's start: ${error.message}`)
      return "error"
    }
    return Array.isArray(data) && data.length > 0 ? "started" : "not-live"
  } catch (err) {
    console.warn(`[llm-billing] job ${jobId}: could not record its first call's start:`, err)
    return "error"
  }
}

/**
 * Whether a job's provider call has started, for a cancel deciding a metered
 * hold with no billed cost recorded (R36/R38): `started` — stamped
 * (`provider_call_started_at`) and not pre-call; `not-started` — never
 * stamped, or still pre-call (nothing sent); `unknown` — the row could not be
 * read (treated as started: never refunded on a guess).
 */
export async function readLlmCallStart(jobId: string): Promise<"started" | "not-started" | "unknown"> {
  try {
    const { data, error } = await supabase
      .from("jobs") // tenant-scope-ignore: the caller owns this job id
      .select(`provider_call_started_at, ${LLM_BILLING_LEDGER_COLUMN}`)
      .eq("id", jobId)
      .maybeSingle()
    if (error) {
      console.warn(`[llm-billing] could not read whether job ${jobId}'s provider call started: ${error.message}`)
      return "unknown"
    }
    const row = data as Record<string, unknown> | null
    if (row?.provider_call_started_at == null) return "not-started"
    return isLlmPreCallMarker(row[LLM_BILLING_LEDGER_COLUMN]) ? "not-started" : "started"
  } catch (err) {
    console.warn(`[llm-billing] could not read whether job ${jobId}'s provider call started:`, err)
    return "unknown"
  }
}
