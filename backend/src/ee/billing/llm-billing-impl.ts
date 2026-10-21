// @registry-enumerates reserves and settles the metered credit id it is given through CreditsService — a credit id, not a node type, so not a @registry-lookup
// Cloud implementation of the metered LLM billing shim (`lib/llm-billing.ts`):
// the reserve, the guard pre-check and the settle. Loaded through a dynamic
// import() only when credits exist, so community/business builds carry none
// of it (the `ee/lib/credit-guard-impl.ts` pattern).

import type { FastifyReply, FastifyRequest } from "fastify"
import {
  LLM_FEATURE_DEFAULTS,
  defaultReasoningEffort,
  llmDefaultsFeature,
  supportsAdvancedMode,
  type LlmFeature,
} from "@nodaro/shared/llm-models"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { getAppSettings } from "../../lib/app-settings.js"
import { supabase } from "../../lib/supabase.js"
import { insertAppReport } from "../../lib/app-reports.js"
import { FAILABLE_STATUSES } from "../../lib/job-failure.js"
import {
  METERED_SWEEP_MAX_ATTEMPTS,
  bumpMeteredSweepAttempts,
  meteredBilledConfirmed,
  meteredSweepMarker,
} from "../../lib/reconcile/metered-sweep-attempts.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import {
  llmBillingLedgerBilled,
  readLlmBillingLedgerAndCost,
  readLlmCallStart,
  writeLlmBillingLedger,
  type LlmBillingLedgerWrite,
} from "../../lib/llm-billing-ledger.js"
import { type LlmPlannedCall, type LlmReserveResult, type LlmSettleOutcome, type LlmSpend, type LlmBillingRecord } from "../../lib/llm-billing.js"
import type { LlmRequest } from "../../lib/llm/types.js"
import { CreditsService } from "./credits.js"
import { computeActualCredits } from "./credit-anomaly.js"
import { LlmUnpricedModelError, llmChargeId, llmHoldBaseCredits } from "./llm-metered.js"
import { parseMeteredLlmId } from "./metered-llm-id.js"
import { sendLlmModelUnpriced } from "./llm-unpriced-reply.js"
import type { MeteredLlmFeature } from "./llm-typical-usage.js"
import { applyServiceMarkup } from "./service-margin.js"

/** The 401 a metered call without a user is answered with (the auth middleware's shape). */
export function sendUnauthenticated(reply: FastifyReply): void {
  reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
}

async function deleteJob(jobId: string): Promise<void> {
  const { error } = await supabase.from("jobs").delete().eq("id", jobId)
  if (error) console.warn(`[llm-billing] failed to delete refused job ${jobId}: ${error.message}`)
}

export async function reserveLlmCallImpl(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  args: { feature: MeteredLlmFeature; calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]] },
): Promise<LlmReserveResult> {
  // `undefined` promises a reply was sent: an unauthenticated call gets the guard's 401, never silence.
  if (!req.userId) {
    sendUnauthenticated(reply)
    return undefined
  }
  let hold: { chargeId: string; holdCredits: number }
  try {
    hold = await llmHoldForCalls(args.feature, args.calls)
  } catch (err) {
    // The backstop for a model chosen after the guard ran (a fallback
    // default): refused before any reservation, and the job row goes too.
    if (!(err instanceof LlmUnpricedModelError)) throw err
    console.warn(`[llm-billing] ${args.feature}: refused unpriced model ${err.modelId} (${err.lane} lane), job=${jobId}`)
    await deleteJob(jobId)
    sendLlmModelUnpriced(reply, err)
    return undefined
  }
  const { chargeId, holdCredits } = hold
  const reservation = await reserveCreditsForJob(req, reply, jobId, chargeId, { holdCredits })
  if (!reservation || reply.sent) return undefined
  return { metered: true, reservation, chargeId, holdCredits }
}

// Pure: sized from the calls alone, in a leaf (no credits.ts / credit-guard import) so a price
// surface (the UGC quote) can size a hold without joining this module's import cycle.
import { llmHoldForCalls } from "./llm-hold-for-calls.js"
export { llmHoldForCalls }

export function llmPrecheckBaseCreditsImpl(
  feature: MeteredLlmFeature,
  body: { llmModel?: string; reasoningEffort?: string; advancedMode?: boolean; maxTokens?: number },
  bodyChars: number,
): number {
  // The feature whose defaults (model, effort) the route runs with when the
  // body names none — one table with `llmPriceKey` (`LLM_FEATURE_DEFAULTS_FROM`).
  const defaults = llmDefaultsFeature(feature) as LlmFeature
  const modelId = body.llmModel || LLM_FEATURE_DEFAULTS[defaults]
  if (!modelId) throw new LlmUnpricedModelError(String(body.llmModel ?? feature), "kie")
  const reasoningEffort = body.reasoningEffort ?? defaultReasoningEffort(defaults, body.llmModel)
  const request: LlmRequest = {
    modelId,
    system: "",
    messages: [],
    maxTokens: body.maxTokens,
    reasoningEffort: reasoningEffort as LlmRequest["reasoningEffort"],
    // Advanced mode is the direct pin the route sends; a stale flag on a model with no direct lane is ignored.
    requireLane: body.advancedMode && supportsAdvancedMode(modelId) ? "direct" : undefined,
  }
  // The body's length counted as ASCII text (never a string of that length).
  return llmHoldBaseCredits(modelId, { request, extraTextChars: Math.max(0, Math.floor(Number.isFinite(bodyChars) ? bodyChars : 0)) })
}

/**
 * The billing ledger written to the server-only column `jobs.llm_billing`
 * (migration 552 — never `output_data`, which users can read) — the settled
 * record, or, for a billed call whose cost could not be computed, a ledger
 * with no cost (`costUsd: null`, `source: "uncomputable"`). A non-empty
 * ledger (`calls > 0`) is what tells the reconcile sweep a metered job WAS
 * billed, so it charges the hold instead of refunding (R20).
 */
type JobBillingLedger = LlmBillingLedgerWrite

/**
 * `provider_cost` when known and `credits_actual` only from a confirmed
 * receipt, then the server-only ledger column — two writes, so a failed
 * ledger write never takes the charge it records with it.
 */
async function writeJobBilling(jobId: string, billing: JobBillingLedger, charged: number | undefined): Promise<void> {
  try {
    if (billing.costUsd !== null || charged !== undefined) {
      const { error } = await supabase
        .from("jobs")
        .update({
          ...(billing.costUsd !== null ? { provider_cost: billing.costUsd } : {}),
          ...(charged !== undefined ? { credits_actual: charged } : {}),
        })
        .eq("id", jobId)
      if (error) console.warn(`[llm-billing] failed to record the charge on job ${jobId}: ${error.message}`)
    }
    await writeLlmBillingLedger(jobId, billing)
  } catch (err) {
    console.warn(`[llm-billing] failed to record billing on job ${jobId}: ${(err as Error).message}`)
  }
}

/**
 * Where a settle records what it charged: by default the JOB's row
 * ({@link writeJobBilling}: `provider_cost`, `credits_actual`, the ledger
 * column). A metered SIDE hold (migration 554, `llm-side-hold-impl.ts`) passes
 * its own, which writes only its `llm_side_holds` row — the job's billing is
 * never touched by a call made beside it.
 */
export type LlmBillingSink = (billing: LlmBillingLedgerWrite, charged: number | undefined) => Promise<void>

/** The size of a usage log's hold (`credits_used`), or undefined when it cannot be read. */
async function readHold(usageLogId: string): Promise<number | undefined> {
  const { data } = await supabase.from("usage_logs").select("credits_used").eq("id", usageLogId).maybeSingle()
  const used = (data as { credits_used?: unknown } | null)?.credits_used
  return typeof used === "number" && Number.isFinite(used) ? used : undefined
}

/**
 * Commit the hold WHOLE — for a call whose cost cannot be computed (a lane or
 * model with no rate, a non-finite figure). It reached the vendor, so it is
 * never refunded; the hold is what it was priced at. Through the METERED
 * commit (`collectOverHold`, actual = the hold), whose receipt is the only
 * proof it settled: no receipt → `unsettled` (the row stays reserved for the
 * sweep, which charges it too — the ledger marks the job billed). Loud,
 * because it means a rate is missing.
 */
async function commitHoldWhole(
  usageLogId: string,
  jobId: string,
  chargeId: string,
  spend: LlmSpend,
  reason: unknown,
  holdCredits: number | undefined,
  sink: LlmBillingSink,
): Promise<LlmSettleOutcome> {
  console.error(`[llm-billing] ALERT: the cost of job ${jobId} (${chargeId}) cannot be computed — committing its hold whole:`, reason)
  const ledger: JobBillingLedger = { costUsd: null, source: "uncomputable", calls: spend.attempts.length, lanes: spend.attempts.map((a) => a.lane), chargeId }
  const hold = holdCredits ?? (await readHold(usageLogId))
  if (hold === undefined) {
    // Nothing is committed without an amount the receipt can confirm. The
    // ledger marks the job billed, so the sweep charges the hold (R20).
    console.error(`[llm-billing] job ${jobId}: its hold could not be read — left reserved for the reconcile sweep`)
    await sink(ledger, undefined)
    return { outcome: "unsettled" }
  }
  const receipt = await CreditsService.commitCredits(usageLogId, hold, { collectOverHold: true })
  // A log another settle already COMMITTED (a re-run after a confirmed
  // settle) is charged — never `unsettled`.
  const committed = receipt ? undefined : await alreadyCommittedCharge(usageLogId, jobId, chargeId, hold, null)
  await sink(ledger, receipt ? receipt.charged : committed?.charged)
  if (committed) return { outcome: "charged", charged: committed.charged, shortfall: committed.uncollected }
  if (!receipt) {
    console.error(`[llm-billing] job ${jobId}: the whole-hold commit (${hold} credits) was not confirmed — left to the reconcile sweep`)
    return { outcome: "unsettled" }
  }
  return { outcome: "charged", charged: receipt.charged, shortfall: receipt.shortfall }
}

/**
 * A metered commit refused because the log is ALREADY COMMITTED
 * (`commit_credits_metered` locks only `status = 'reserved'` and raises "Usage
 * log not found" otherwise; its wrapper answers undefined for every error, so
 * the log's own state is read to tell the two apart). The case: a worker job
 * re-run after a CONFIRMED settle — a stall re-pick of a process that died
 * between the commit and the job's terminal write (an LLM job has no
 * provider task to resume, and the re-pick does not bump `attemptsMade`).
 *
 * The job IS charged — the log's `credits_charged`, its `credits_actual` —
 * so it is never `unsettled`: the reconcile sweep reads only `reserved` logs,
 * would answer not-metered and FAIL a job the user already paid for (D10).
 * What this settle would charge beyond that — the re-run's own calls, carried
 * in on top of the earlier attempt's cost by the start floor — cannot be
 * collected on a committed log, so it is logged as an `uncollected_overrun`
 * anomaly (the earlier settle's own shortfall, already logged by the RPC, is
 * not counted twice). Undefined — today's `unsettled` — for a log still
 * `reserved` (a real RPC failure), refunded, or unreadable.
 */
async function alreadyCommittedCharge(
  usageLogId: string,
  jobId: string,
  chargeId: string,
  wouldCharge: number,
  costUsd: number | null,
): Promise<{ charged: number; uncollected: number } | undefined> {
  let row: { status?: unknown; credits_charged?: unknown; credits_used?: unknown; user_id?: unknown; metadata?: unknown }
  try {
    const { data, error } = await supabase
      .from("usage_logs")
      .select("status, credits_charged, credits_used, user_id, metadata")
      .eq("id", usageLogId)
      .maybeSingle()
    if (error || !data) return undefined
    row = data as typeof row
  } catch {
    return undefined
  }
  const charged = row.credits_charged
  if (row.status !== "committed" || typeof charged !== "number" || !Number.isInteger(charged) || charged < 0) return undefined
  const overrun = (row.metadata as { overrun?: { shortfall?: unknown } } | null)?.overrun
  const priorShortfall = typeof overrun?.shortfall === "number" && Number.isInteger(overrun.shortfall) && overrun.shortfall > 0 ? overrun.shortfall : 0
  const uncollected = Math.max(0, wouldCharge - charged - priorShortfall)
  console.error(
    `[llm-billing] job ${jobId}: usage log ${usageLogId} (${chargeId}) was already committed at ${charged} credits — charged; ` +
      `${uncollected} credit(s) this settle would add cannot be collected on a committed log`,
  )
  if (uncollected > 0 && (await uncollectedOverrunLogged(usageLogId, uncollected, wouldCharge))) {
    // R39: an IDENTICAL repeat — the same log, type and amount (a settle and a
    // failure net both landing here, a second re-run of the same spend) — is
    // already flagged for review: never a duplicate. A DIFFERENT shortfall on
    // the same log (a re-run that billed more; the RPC's own shortfall row is
    // another amount) is a new fact and is logged.
    console.warn(`[llm-billing] job ${jobId}: usage log ${usageLogId} already has this uncollected_overrun anomaly (${uncollected} credit(s)) — not logged again`)
  } else if (uncollected > 0) {
    let logged = false
    try {
      const { error } = await supabase.from("credit_anomalies" as "assets").insert({
        // A side hold whose job was deleted settles with no job ("").
        job_id: jobId || null,
        user_id: typeof row.user_id === "string" ? row.user_id : null,
        usage_log_id: usageLogId,
        model_identifier: chargeId,
        credits_estimated: typeof row.credits_used === "number" ? row.credits_used : charged,
        credits_actual: wouldCharge,
        diff: uncollected,
        ...(costUsd !== null ? { provider_cost_usd: costUsd } : {}),
        anomaly_type: "uncollected_overrun",
        status: "pending",
      } as Record<string, unknown>)
      if (error) console.error(`[llm-billing] job ${jobId}: could not log its uncollected overrun: ${error.message}`)
      else logged = true
    } catch (err) {
      console.error(`[llm-billing] job ${jobId}: could not log its uncollected overrun:`, err)
    }
    // Never silent (D10): the anomaly row, else an app report.
    if (!logged) {
      await insertAppReport({
        node: "llm-billing",
        kind: "metered-uncollected-overrun",
        severity: "error",
        title: `Metered LLM job ${jobId} re-ran after its settle: ${uncollected} credit(s) could not be collected`,
        payload: { usageLogId, chargeId, charged, wouldCharge, uncollected },
        ...(jobId ? { jobId } : {}),
      })
    }
  }
  return { charged, uncollected }
}

/**
 * Whether `usage_logs` row `usageLogId` already has an `uncollected_overrun`
 * anomaly for exactly `uncollected` credits against the same `wouldCharge`
 * (R39 + m4 — the dedupe key: usage log × type × amount × actual: the
 * anomaly's `diff`, the credits that could not be collected — the quantity the
 * RPC's own row records as its shortfall — and its `credits_actual`, the charge
 * that shortfall was measured against). A read that fails answers false — the
 * row is logged again rather than not at all (never silent).
 */
async function uncollectedOverrunLogged(usageLogId: string, uncollected: number, wouldCharge: number): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("credit_anomalies" as "assets")
      .select("id")
      .eq("usage_log_id", usageLogId)
      .eq("anomaly_type", "uncollected_overrun")
      .eq("diff", uncollected)
      .eq("credits_actual", wouldCharge)
      .limit(1)
    if (error) return false
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

export async function settleLlmUsageLogImpl(
  usageLogId: string,
  jobId: string,
  chargeId: string,
  spend: LlmSpend,
  holdCredits?: number,
  /** Where the charge is recorded — default the job's row; a side hold passes its own (554). */
  sink: LlmBillingSink = (billing, charged) => writeJobBilling(jobId, billing, charged),
): Promise<LlmSettleOutcome> {
  try {
    if (!spend.billedAnything) {
      await CreditsService.refundCredits(usageLogId)
      return { outcome: "refunded" }
    }
    let record: LlmBillingRecord
    try {
      record = spend.record
      if (!Number.isFinite(record.costUsd) || record.costUsd < 0) throw new Error(`non-finite cost ${record.costUsd}`)
    } catch (err) {
      // Billed, but not costable: charge the hold, never refund (a refund would make an unpriced lane free).
      return await commitHoldWhole(usageLogId, jobId, chargeId, spend, err, holdCredits, sink)
    }
    // A call that reached the vendor is charged at least the floor (1 base credit).
    const credits = await computeActualCredits(Math.max(record.costUsd, CREDIT_BASE_USD), chargeId)
    // D1: an overrun above the hold is the expected outcome — commit_credits_metered
    // collects it from the payer and logs a true shortfall itself; no anomaly here.
    const outcome = await CreditsService.commitCredits(usageLogId, credits, { collectOverHold: true })
    // `undefined` is a failed RPC (the row stays reserved) OR a log already
    // committed by an earlier settle (a re-run after a confirmed settle): the
    // log's state tells them apart. Committed → charged at what it recorded.
    const committed = outcome ? undefined : await alreadyCommittedCharge(usageLogId, jobId, chargeId, credits, record.costUsd)
    // R13: credits_actual is a confirmed charge — the receipt's `charged`, or the committed log's.
    await sink({ ...record, chargeId }, outcome ? outcome.charged : committed?.charged)
    if (committed) return { outcome: "charged", charged: committed.charged, shortfall: committed.uncollected }
    if (!outcome) {
      // Nothing is claimed as charged; the still-reserved hold is the
      // reconcile sweep's (C3).
      console.error(`[llm-billing] settle of job ${jobId} (log ${usageLogId}, ${chargeId}, ${credits} credits) was not confirmed — left to the reconcile sweep`)
      return { outcome: "unsettled" }
    }
    return { outcome: "charged", charged: outcome.charged, shortfall: outcome.shortfall }
  } catch (err) {
    console.error(`[llm-billing] settle of job ${jobId} (log ${usageLogId}, ${chargeId}) failed — the hold stays reserved for the reconcile sweep:`, err)
    return { outcome: "unsettled" }
  }
}

/** What the sweep does with a stale job after `settleSweptMeteredLlmJobImpl`. */
export type SweptMeteredLlmVerdict =
  /** No metered hold, or a metered job that CONFIRMEDLY billed nothing: refund as today. */
  | "not-metered"
  /** Every billed metered hold is committed (confirmed): fail the job, refund any other hold. */
  | "settled"
  /** Not settled yet (an error, no receipt): attempts bumped, the job left sweepable for the next tick. */
  | "retry"

export { METERED_SWEEP_MAX_ATTEMPTS } from "../../lib/reconcile/metered-sweep-attempts.js"

/** A usage log's settlement state, or undefined when it cannot be read. */
async function readLogState(usageLogId: string): Promise<{ status: unknown; creditsCharged: unknown } | undefined> {
  try {
    const { data, error } = await supabase.from("usage_logs").select("status, credits_charged").eq("id", usageLogId).maybeSingle()
    if (error || !data) return undefined
    const row = data as { status?: unknown; credits_charged?: unknown }
    return { status: row.status, creditsCharged: row.credits_charged }
  } catch {
    return undefined
  }
}

/**
 * The reconcile sweep's settle for a stale job, run BEFORE its terminal flip
 * ("a metered call is never left free"; D10 for the cap):
 *
 *  - `not-metered` — none of the job's reserved logs is a metered id, or the
 *    job CONFIRMEDLY recorded no billed cost AND its call never started (no
 *    stamp, or still the worker's pre-call marker): the sweep refunds as today.
 *  - billed (`provider_cost > 0`, or a billed `llm_billing` ledger), before
 *    the cap (R59, superseding R20): the hold is settled from what the ROW
 *    recorded billed at the ACTUAL (`meteredSpendFromRow` →
 *    {@link settleLlmUsageLogImpl}, the cancelled-hold sweep's path) — D1's
 *    metered commit, an overrun collected, the rest released (D14). A ledger
 *    that cannot be priced (no spend recoverable from a row that says billed,
 *    a row that cannot be read, several metered holds on one job) commits the
 *    hold WHOLE through the metered commit instead. Every receipt in →
 *    `settled` (the sweep then fails the job). Any hold without one →
 *    attempts bumped, `retry`.
 *  - billed-unknown (R60 / R36): no billed figure, but the call STARTED (the
 *    row is stamped and carries no pre-call marker) — or an earlier tick
 *    confirmed it billed: the cost is unknown, never refunded. `retry` until
 *    the cap, where the hold is charged whole (D10).
 *  - at {@link METERED_SWEEP_MAX_ATTEMPTS} (D10): the hold is charged through
 *    the plain `commit_credits(log, hold)` (actual = hold, no overrun),
 *    CONFIRMED by re-reading the log's status, and an app report filed; only
 *    then `settled`. Not confirmable → `retry` with an alert.
 *  - any read or RPC error → `retry` (attempts bumped), never a refund: an
 *    unknown is never treated as "not billed". At the cap, a job whose
 *    metered + billed state was never CONFIRMED (a read that keeps failing)
 *    falls back to today's fail + refund; a confirmed one follows D10.
 *  - at the cap the hold counts as charged only when THIS commit moved its
 *    row (reserved before, committed after at the hold); a row another writer
 *    settled is left as it recorded it.
 */
export async function settleSweptMeteredLlmJobImpl(
  job: {
    id: string
    reconcile_attempts: number
    reconcile_last_error?: string | null
  },
  /**
   * The statuses its own row writes (the attempts bump, the billed marker) may
   * touch. Default: the live sweep's `FAILABLE_STATUSES`. The cancelled-hold
   * sweep (R38) passes `cancelled` — its row stays cancelled, and its counter
   * must still advance to the cap.
   */
  opts: { statuses?: readonly string[] } = {},
): Promise<SweptMeteredLlmVerdict> {
  const statuses = opts.statuses ?? FAILABLE_STATUSES
  const jobId = job.id
  const attempt = job.reconcile_attempts + 1
  const atCap = attempt >= METERED_SWEEP_MAX_ATTEMPTS
  // An EARLIER tick confirmed this job metered + billed (the persisted
  // marker): it is never refunded, whatever this tick's reads say.
  const confirmedEarlier = meteredBilledConfirmed(job.reconcile_last_error)
  /**
   * Retry next tick (attempts bumped). `confirmed` = this job is KNOWN to hold
   * a billed metered reservation: only such a job keeps retrying past the cap
   * (D10 — never refunded). A job whose state could not be confirmed (a read
   * that keeps failing) falls back at the cap to today's fail + refund.
   */
  const retry = async (why: string, confirmedNow: boolean): Promise<SweptMeteredLlmVerdict> => {
    const confirmed = confirmedNow || confirmedEarlier
    if (atCap && !confirmed) {
      console.error(`[llm-billing] ALERT: sweep could not classify job ${jobId} after ${attempt} attempts (${why}) — falling back to fail + refund`)
      return "not-metered"
    }
    if (atCap) {
      console.error(`[llm-billing] ALERT: sweep could not settle billed metered job ${jobId} after ${attempt} attempts (${why}) — kept sweepable, never refunded`)
    } else {
      console.warn(`[llm-billing] sweep: job ${jobId} not settled yet (${why}) — retrying next tick (attempt ${attempt})`)
    }
    await bumpMeteredSweepAttempts(jobId, attempt, why, confirmed, statuses)
    return "retry"
  }

  const { data: logs, error } = await supabase
    .from("usage_logs")
    .select("id, action, credits_used")
    .eq("job_id", jobId)
    .eq("status", "reserved")
  if (error) return retry(`usage_logs read failed: ${error.message}`, false)
  const rows = (Array.isArray(logs) ? logs : []) as Array<{ id: string; action?: unknown; credits_used?: unknown }>
  const metered = rows.filter((l) => typeof l.action === "string" && parseMeteredLlmId(l.action) !== null)
  if (metered.length === 0) return "not-metered"

  // No migration-window fallback (R33): a metered reservation exists only once
  // the schema is confirmed, so a failed read here is an error — retried, never
  // read as "not billed". The server-only ledger column through its reader (R32).
  const read = await readLlmBillingLedgerAndCost(jobId)
  if (!read.ok) return retry(`jobs read failed: ${read.error}`, false)
  const billed = (typeof read.providerCost === "number" && read.providerCost > 0) || llmBillingLedgerBilled(read.ledger)
  if (!billed && !confirmedEarlier) {
    // R60 (R36 for the live sweep): nothing billed recorded — but a call that
    // STARTED (stamped, no pre-call marker) may have been billed with its
    // spend never written (the process died mid-call). Never refunded on a
    // guess: kept to the D10 cap, then charged whole. Unreadable → retried.
    const started = await readLlmCallStart(jobId)
    if (started === "unknown") return retry("its call start could not be read", false)
    if (started === "not-started") return "not-metered"
  }
  // Billed, billed-unknown, or an earlier tick's confirmation: from here the
  // job is never refunded.
  const billedUnknown = !billed

  // Remember the confirmation BEFORE any commit, so a throw later in this tick
  // (caught by the shim) still finds the job billed on the next one.
  if (!confirmedEarlier) {
    try {
      const { error: markerError } = await supabase
        .from("jobs")
        .update({ reconcile_last_error: meteredSweepMarker(billedUnknown ? "confirmed metered + call started (cost unknown)" : "confirmed metered + billed", true) })
        .eq("id", jobId)
        .in("status", [...statuses])
      if (markerError) console.error(`[llm-billing] sweep: could not persist the billed marker on job ${jobId}: ${markerError.message}`)
    } catch (err) {
      console.error(`[llm-billing] sweep: could not persist the billed marker on job ${jobId}:`, err)
    }
  }

  // Billed-unknown before the cap: the hold is kept (R60) — retried, never refunded.
  if (billedUnknown && !atCap) return retry("its call started with no billed figure recorded (cost unknown) — the hold is kept to the D10 cap", true)

  // R59: before the cap, a billed job is settled at its ACTUAL from what the
  // row recorded (one metered hold: the row's spend is that hold's). Anything
  // that cannot be priced from the row commits the hold whole (below).
  if (!billedUnknown && !atCap && metered.length === 1) {
    const log = metered[0]!
    const chargeId = log.action as string
    const hold = typeof log.credits_used === "number" && Number.isFinite(log.credits_used) ? log.credits_used : undefined
    const { meteredSpendFromRow } = await import("../../lib/llm-row-spend.js")
    const fromRow = await meteredSpendFromRow(jobId, chargeId)
    if (fromRow?.readFailed) return retry("its billing ledger could not be read", true)
    if (fromRow && fromRow.spend.billedAnything) {
      const settled = await settleLlmUsageLogImpl(log.id, jobId, chargeId, fromRow.spend, hold)
      if (settled.outcome === "charged") {
        console.warn(`[llm-billing] sweep: job ${jobId} was billed but never settled — charged its actual (${settled.charged} credits, ${chargeId})`)
        return "settled"
      }
      return retry("its settle at the actual was not confirmed", true)
    }
    // Billed per the row, yet no spend could be recovered from it: the hold whole (below).
    console.error(`[llm-billing] ALERT: sweep: job ${jobId} recorded a billed call whose spend cannot be priced — committing its hold whole`)
  }

  const unsettled: Array<{ id: string; action: unknown; hold: number | undefined }> = []
  for (const log of metered) {
    const hold = typeof log.credits_used === "number" && Number.isFinite(log.credits_used) ? log.credits_used : undefined
    let receipt: Awaited<ReturnType<typeof CreditsService.commitCredits>> = undefined
    if (hold !== undefined) {
      try {
        receipt = await CreditsService.commitCredits(log.id, hold, { collectOverHold: true })
      } catch (err) {
        // A throw is a missing receipt: it counts toward the cap like any other.
        console.error(`[llm-billing] sweep: metered commit of log ${log.id} threw:`, err)
      }
    }
    if (!receipt) {
      unsettled.push({ id: log.id, action: log.action, hold })
      continue
    }
    console.warn(`[llm-billing] sweep: job ${jobId} was billed but never settled — committed its hold whole (${receipt.charged} credits, ${String(log.action)})`)
    const { error: writeError } = await supabase.from("jobs").update({ credits_actual: receipt.charged }).eq("id", jobId)
    if (writeError) console.warn(`[llm-billing] sweep: failed to record credits_actual on job ${jobId}: ${writeError.message}`)
  }
  if (unsettled.length === 0) return "settled"
  if (!atCap) return retry(`${unsettled.length} metered hold(s) without a receipt`, true)

  // D10: the cap — charge the hold through the plain commit. Every await in
  // this loop is non-throwing (readLogState and insertAppReport catch; the
  // commit is wrapped; the jobs writes answer errors) — and should one throw
  // regardless, the persisted billed marker keeps the shim from refunding.
  // It counts as
  // OUR charge only when this commit moved the row: reserved just before it,
  // committed after with credits_charged = the hold. A row someone else
  // settled meanwhile (the route's late settle winning the CAS) is left as
  // that writer recorded it: no report, no credits_actual of ours.
  let allSettled = true
  for (const log of unsettled) {
    const before = await readLogState(log.id)
    if (before === undefined) {
      allSettled = false
      continue
    }
    if (before.status !== "reserved") {
      console.warn(`[llm-billing] sweep: job ${jobId} log ${log.id} was settled by another writer (${String(before.status)}) — left as recorded`)
      continue
    }
    let threw = false
    try {
      await CreditsService.commitCredits(log.id, log.hold)
    } catch (err) {
      threw = true
      console.error(`[llm-billing] sweep: plain commit of log ${log.id} threw:`, err)
    }
    const after = await readLogState(log.id)
    // Ours: reserved just before, committed now, at the hold — or with no
    // credits_charged at all after a call of ours that did not throw (a TS
    // fallback commit from before it wrote credits_charged).
    const ours = after?.status === "committed" &&
      (log.hold === undefined || after.creditsCharged === log.hold || (after.creditsCharged == null && !threw))
    if (!ours && after !== undefined && after.status !== "reserved") {
      console.warn(`[llm-billing] sweep: job ${jobId} log ${log.id} was settled by another writer during the cap commit — left as recorded`)
      continue
    }
    if (!ours) allSettled = false
    await insertAppReport({
      node: "llm-billing-sweep",
      kind: ours ? "metered-hold-charged-at-cap" : "metered-hold-unsettled-at-cap",
      severity: "error",
      title: ours
        ? `Metered LLM job ${jobId}: billed, never settled — hold charged whole after ${attempt} sweep attempts`
        : `Metered LLM job ${jobId}: billed, hold still unsettled after ${attempt} sweep attempts`,
      payload: { usageLogId: log.id, action: log.action, hold: log.hold ?? null, attempts: attempt },
      jobId,
    })
    if (ours) {
      console.error(`[llm-billing] ALERT: sweep charged job ${jobId}'s hold (log ${log.id}) through the plain commit at the attempt cap (D10)`)
      const charged = log.hold ?? (typeof after?.creditsCharged === "number" ? after.creditsCharged : undefined)
      if (charged !== undefined) {
        const { error: writeError } = await supabase.from("jobs").update({ credits_actual: charged }).eq("id", jobId)
        if (writeError) console.warn(`[llm-billing] sweep: failed to record credits_actual on job ${jobId}: ${writeError.message}`)
      }
    }
  }
  return allSettled ? "settled" : retry("the plain commit at the cap could not be confirmed", true)
}

/**
 * R61: a DELIBERATE platform refund of a job's OWN metered charges, already
 * settled — a result-policy block, a reviewer's reject or the owner's
 * withdraw of a held job ("a platform gate's false positives are ours", D19;
 * the same shape as R57's side-hold refund). A metered LLM job settles BEFORE
 * its completion write, so the gate finds its hold committed and the job's
 * reservation refund (reserved logs only) cannot reach it. Each committed
 * metered log of the job is reversed by `refund_settled_metered_charge`
 * (migration 554: per payer, for what the commit actually moved, once, the
 * job no longer live). An external-wallet row (its journal is not reversed
 * there), a refusal or a failed RPC is reported — never silent. Answers how
 * many were refunded. Never a D10 path: no other caller refunds a billed call.
 */
export async function refundSettledMeteredJobChargesImpl(jobId: string): Promise<number> {
  const { data, error } = await supabase
    .from("usage_logs")
    .select("id, action")
    .eq("job_id", jobId)
    .eq("status", "committed")
  if (error) throw new Error(error.message)
  let refunded = 0
  for (const row of (Array.isArray(data) ? data : []) as Array<{ id?: unknown; action?: unknown }>) {
    if (typeof row.id !== "string" || typeof row.action !== "string" || parseMeteredLlmId(row.action) === null) continue
    let answer: unknown
    let failure: string | undefined
    try {
      const { data: out, error: rpcError } = await supabase.rpc("refund_settled_metered_charge", { p_usage_log_id: row.id, p_job_id: jobId })
      if (rpcError) failure = rpcError.message
      else answer = out
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)
    }
    if (answer === "refunded") {
      refunded++
      continue
    }
    if (answer === "not-committed") continue
    await insertAppReport({
      node: "llm-billing",
      kind: "metered-charge-platform-refund-not-applied",
      severity: "error",
      title: `Job ${jobId}: its settled metered charge ${row.id} was not refunded by the platform (${answer === "unsupported" ? "external wallet" : failure ?? String(answer)}) — refund it by hand`,
      payload: { usageLogId: row.id, chargeId: row.action, answer: answer ?? null, failure: failure ?? null },
      jobId,
    })
  }
  return refunded
}
