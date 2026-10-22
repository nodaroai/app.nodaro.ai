// @registry-enumerates refunds the usage logs it is given through CreditsService — a credit id, not a node type, so not a @registry-lookup
/**
 * R38: the reconcile sweep's pass over CANCELLED jobs that still hold a
 * reserved metered LLM hold.
 *
 * A cancel keeps a metered hold whose job's call had started with nothing
 * billed recorded yet (R36: billed-unknown — never refunded on a guess, D10).
 * The worker or route still running that call settles it when the call ends
 * (R38), but one that died first — a deploy, an OOM, a sync route whose
 * request was torn down — leaves the hold reserved on a row no other sweep
 * reads: the main scan, the never-started and the stuck sweeps all look at
 * live rows only.
 *
 * After the SAME grace the live sweep gives the row's kind (from its call's
 * start stamp, else its creation), the hold is settled from the ledger the
 * job recorded — its billed actual charged, a hold nothing billed refunded
 * only when its call never started (R62: a call that started with nothing
 * billed recorded is billed-unknown and keeps its hold to the D10 cap, as in
 * the live sweep, R60) — and the row stays `cancelled`. A settle that cannot be confirmed is retried
 * on later ticks (the attempts counter advances on the cancelled row); at the
 * D10 attempt cap the live sweep's own cap rule runs: a billed hold is charged
 * whole (reported), one never confirmed billed is refunded. Nothing is left
 * reserved silently.
 *
 * Driven from the reserved usage logs (not the cancelled jobs): the set of
 * reserved holds on cancelled rows is small and drains as they settle, where
 * a scan of cancelled jobs would return the same oldest rows forever.
 */
import { supabase } from "../supabase.js"
import { hasCredits } from "../config.js"
import { llmMeteredSchemaReady } from "../llm-metered-schema-gate.js"
import { declaredJobBudgetMs } from "../job-budget.js"
import { NODE_TIMEOUT_MS } from "../../services/workflow-engine/types.js"
import { STALE_THRESHOLD_MS, MIN_STALE_THRESHOLD_MS, type ProviderKind } from "./types.js"
import { METERED_SWEEP_MAX_ATTEMPTS, bumpMeteredSweepAttempts, meteredBilledConfirmed } from "./metered-sweep-attempts.js"

/** Per-tick cap, as the main scan's. */
const BATCH_LIMIT = 500

const MIN = 60_000

/** The reconcile cron's cadence (`lib/reconcile/start.ts`: every 5 minutes). */
export const RECONCILE_TICK_MS = 5 * MIN

/**
 * The video queue's `defaultJobOptions.attempts` (`lib/queue.ts`): how many
 * times one job can be picked up and run. Held to that file by the sweep's test.
 */
export const VIDEO_QUEUE_ATTEMPTS = 3

/**
 * How old a reserved hold can be when this pass must still be settling it
 * (R46). A hold is reserved before its job is queued, then:
 *  - the job waits to be picked up — at most the never-started sweep's 30 min;
 *  - it runs, once per BullMQ attempt ({@link VIDEO_QUEUE_ATTEMPTS}), each run
 *    beating its stamp for at most the per-node ceiling
 *    (`PRE_TASK_HEARTBEAT_MAX_MS` = `NODE_TIMEOUT_MS`, 90 min) — the backoff
 *    between attempts is seconds;
 *  - the cancelled row waits out its grace — at most the pre-task threshold
 *    plus that same ceiling ({@link cancelledHoldPastGrace}; a sync route's
 *    40 min is shorter);
 *  - then the D10 cap — `METERED_SWEEP_MAX_ATTEMPTS` ticks, one more to land.
 * 30 + 3 × 90 + (30 + 90) + 6 × 5 min = 450 min, 7.5 hours.
 */
export const CANCELLED_HOLD_HORIZON_MS =
  30 * MIN +
  VIDEO_QUEUE_ATTEMPTS * NODE_TIMEOUT_MS +
  (STALE_THRESHOLD_MS["pre-task"] + NODE_TIMEOUT_MS) +
  (METERED_SWEEP_MAX_ATTEMPTS + 1) * RECONCILE_TICK_MS

/**
 * The recency window the query reads (R46): the holds reserved in the last 24
 * hours — over three times {@link CANCELLED_HOLD_HORIZON_MS} (7.5 hours), so a
 * slow drain or a missed tick never pushes a due hold out of it, while
 * the scan stays a bounded range on `usage_logs.created_at` (its index,
 * migration 099) instead of the whole table. A hold older than the window has
 * long been settled, or was reported at the cap (`metered-hold-*-at-cap`).
 */
export const CANCELLED_HOLD_WINDOW_MS = 24 * 60 * MIN

/** The status this sweep reads and writes — the row is never flipped. */
const CANCELLED: readonly string[] = ["cancelled"]

export interface CancelledHoldSweepResult {
  scanned: number
  swept: number
  notStale: number
  errors: number
}

interface CancelledJobRow {
  status?: unknown
  provider_kind?: unknown
  provider_call_started_at?: unknown
  created_at?: unknown
  reconcile_attempts?: unknown
  reconcile_last_error?: unknown
  job_type?: unknown
  input_data?: unknown
}

interface ReservedLogRow {
  id: string
  job_id: string | null
  action: unknown
  jobs: CancelledJobRow | CancelledJobRow[] | null
}

/**
 * Past the grace — from the call's last stamp, else the row's creation. The
 * live sweep's threshold for the row's kind, and for a WORKER job's `pre-task`
 * stamp that threshold PLUS the longest the worker may legitimately still be
 * running (m2): a cancelled row's stamp is no longer beaten by the pre-task
 * heartbeat (a CAS on `processing`), while the worker's call may still be in
 * flight — its own settle charges it, and this pass must never refund it
 * first. The per-node ceiling (`NODE_TIMEOUT_MS`, the heartbeat's cap), or the
 * job's own declared budget when it is longer.
 */
export function cancelledHoldPastGrace(job: CancelledJobRow, nowMs: number): boolean {
  const kind = typeof job.provider_kind === "string" && job.provider_kind in STALE_THRESHOLD_MS ? (job.provider_kind as ProviderKind) : "pre-task"
  const anchor = typeof job.provider_call_started_at === "string" ? job.provider_call_started_at : job.created_at
  const anchorMs = typeof anchor === "string" ? Date.parse(anchor) : NaN
  // An unreadable anchor is treated as old: the settle reads the ledger, it never guesses.
  if (!Number.isFinite(anchorMs)) return true
  let grace = STALE_THRESHOLD_MS[kind]
  if (kind === "pre-task") {
    const declared = typeof job.job_type === "string" ? declaredJobBudgetMs(job.job_type, job.input_data) : undefined
    grace += Math.max(NODE_TIMEOUT_MS, declared ?? 0)
  }
  return nowMs - anchorMs > grace
}

export async function sweepCancelledMeteredHolds(result: CancelledHoldSweepResult): Promise<void> {
  // Keyed off the RESERVATION, never the pricing switch (R15): a metered hold
  // reserved before a rollback flip — or by another process before this one's
  // R33 probe answered — is still settled here. Only a database that never had
  // the metered schema can hold none, so that alone skips the query (a skipped
  // tick is harmless: the next one runs). Tier holds are filtered out below by
  // the exact id parse, so the rollback stays byte-identical for them.
  if (!hasCredits() || !llmMeteredSchemaReady()) return
  const now = Date.now()
  // A bounded range on usage_logs.created_at (R46): the recency window, and a
  // pre-filter (the precise grace is per row, below) — no hold younger than
  // the shortest threshold can be due.
  const windowStart = new Date(now - CANCELLED_HOLD_WINDOW_MS).toISOString()
  const cutoff = new Date(now - MIN_STALE_THRESHOLD_MS).toISOString()
  const { METERED_LLM_FEATURES } = await import("../../ee/billing/llm-typical-usage.js")
  const { data, error } = await supabase
    .from("usage_logs")
    .select("id, job_id, action, jobs!inner(status, provider_kind, provider_call_started_at, created_at, reconcile_attempts, reconcile_last_error, job_type, input_data)")
    .eq("status", "reserved")
    .gte("created_at", windowStart)
    .lt("created_at", cutoff)
    // The metered id filter in SQL: `<feature>:` prefixes. A tier id shares
    // its feature's prefix (`llm-chat:premium`) and is dropped below by the
    // exact parse — the window bounds what few of those there are.
    .or(meteredActionPrefixFilter(METERED_LLM_FEATURES))
    .eq("jobs.status", "cancelled")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT)
  if (error) {
    console.error(`[reconcile/cancelled-holds] query failed:`, error.message)
    result.errors++
    return
  }
  const { parseMeteredLlmId } = await import("../../ee/billing/metered-llm-id.js")
  const byJob = new Map<string, { job: CancelledJobRow; logs: Array<{ id: string; chargeId: string }> }>()
  for (const row of (Array.isArray(data) ? data : []) as unknown as ReservedLogRow[]) {
    // Only a metered hold: a tier or fixed hold never reaches this pass (the
    // rollback is byte-identical).
    if (typeof row.action !== "string" || parseMeteredLlmId(row.action) === null || !row.job_id) continue
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    if (!job || job.status !== "cancelled") continue
    const entry = byJob.get(row.job_id) ?? { job, logs: [] }
    entry.logs.push({ id: row.id, chargeId: row.action })
    byJob.set(row.job_id, entry)
  }
  for (const [jobId, { job, logs }] of byJob) {
    result.scanned++
    if (!cancelledHoldPastGrace(job, now)) {
      result.notStale++
      continue
    }
    try {
      await settleCancelledJobHolds(jobId, job, logs)
      result.swept++
    } catch (err) {
      console.error(`[reconcile/cancelled-holds] job ${jobId}: settle failed:`, err)
      result.errors++
    }
  }
  await sweepCancelledLedgerHolds(result, now, windowStart, cutoff, parseMeteredLlmId)
}

/**
 * A FIXED-price hold carrying metered calls on a cancelled row (the scrapes'
 * per-item analysis: one usage log under the scrape's fixed id, the calls'
 * spend in the job's ledger). A cancel that found a call in flight
 * (`inFlight > 0`, the call-start marker) kept the hold for the job's own
 * settle; one whose process died first leaves it here. After the same grace,
 * it is settled from the ledger as the cancel would have — the billed calls
 * charged at their actual, the rest released; a call still marked in flight
 * died with its process (counted unbilled, as everywhere). Not confirmed →
 * the row's attempts advance; at the D10 cap it is reported, never refunded
 * on a guess while billed.
 */
async function sweepCancelledLedgerHolds(
  result: CancelledHoldSweepResult,
  now: number,
  windowStart: string,
  cutoff: string,
  parseMeteredLlmId: (id: string) => unknown,
): Promise<void> {
  const { data, error } = await supabase
    .from("usage_logs")
    .select("id, job_id, action, jobs!inner(status, provider_kind, provider_call_started_at, created_at, reconcile_attempts, reconcile_last_error, job_type, input_data, llm_billing)")
    .eq("status", "reserved")
    .gte("created_at", windowStart)
    .lt("created_at", cutoff)
    .eq("jobs.status", "cancelled")
    .not("jobs.llm_billing", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT)
  if (error) {
    console.error(`[reconcile/cancelled-holds] ledger-hold query failed:`, error.message)
    result.errors++
    return
  }
  const seen = new Set<string>()
  for (const row of (Array.isArray(data) ? data : []) as unknown as ReservedLogRow[]) {
    // A metered hold is the pass above's; this one is the fixed + calls hold.
    if (!row.job_id || seen.has(row.job_id) || (typeof row.action === "string" && parseMeteredLlmId(row.action) !== null)) continue
    const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs
    if (!job || job.status !== "cancelled") continue
    seen.add(row.job_id)
    result.scanned++
    if (!cancelledHoldPastGrace(job, now)) {
      result.notStale++
      continue
    }
    try {
      await settleCancelledLedgerHold(row.job_id, job)
      result.swept++
    } catch (err) {
      console.error(`[reconcile/cancelled-holds] job ${row.job_id}: ledger settle failed:`, err)
      result.errors++
    }
  }
}

async function settleCancelledLedgerHold(jobId: string, job: CancelledJobRow): Promise<void> {
  const reconcileAttempts = typeof job.reconcile_attempts === "number" ? job.reconcile_attempts : 0
  const lastError = typeof job.reconcile_last_error === "string" ? job.reconcile_last_error : null
  const attempt = reconcileAttempts + 1
  const { settleBilledLedgerBeforeCancelImpl } = await import("../../ee/billing/llm-cancel-settle.js")
  const verdict = await settleBilledLedgerBeforeCancelImpl(jobId, { ignoreInFlight: true })
  if (verdict === "settled") {
    console.warn(`[reconcile/cancelled-holds] cancelled job ${jobId}: its fixed + calls hold was settled from its ledger`)
    // Anything still reserved (a second log) is the cancel's refund.
    const { refundReservedCreditsForJob } = await import("../credits-job-lifecycle.js")
    await refundReservedCreditsForJob(jobId)
    return
  }
  if (verdict === "not-metered") {
    // Nothing billed on the ledger: the hold is refunded, as the cancel would have.
    const { refundReservedCreditsForJob } = await import("../credits-job-lifecycle.js")
    await refundReservedCreditsForJob(jobId)
    return
  }
  // Not confirmed (a read or a commit failed): never refunded on a guess.
  await bumpMeteredSweepAttempts(jobId, attempt, "cancelled fixed + calls hold: its settle was not confirmed", meteredBilledConfirmed(lastError), CANCELLED)
  if (attempt >= METERED_SWEEP_MAX_ATTEMPTS) {
    const { insertAppReport } = await import("../app-reports.js")
    await insertAppReport({
      node: "llm-billing-sweep",
      kind: "metered-ledger-hold-unsettled-at-cap",
      severity: "error",
      title: `Cancelled job ${jobId}: its fixed + metered-calls hold is still unsettled after ${attempt} sweep attempts — never refunded while billed`,
      payload: { jobId, attempts: attempt },
      jobId,
    })
  }
}

/** PostgREST `or` over the metered features' id prefixes: `action.like.<feature>:*,…`. */
export function meteredActionPrefixFilter(features: readonly string[]): string {
  return features.map((f) => `action.like.${f}:*`).join(",")
}

async function settleCancelledJobHolds(
  jobId: string,
  job: CancelledJobRow,
  logs: Array<{ id: string; chargeId: string }>,
): Promise<void> {
  const reconcileAttempts = typeof job.reconcile_attempts === "number" ? job.reconcile_attempts : 0
  const lastError = typeof job.reconcile_last_error === "string" ? job.reconcile_last_error : null
  const attempt = reconcileAttempts + 1

  if (attempt >= METERED_SWEEP_MAX_ATTEMPTS) {
    // D10 at the cap — the live sweep's own rule, on the cancelled row: a
    // billed hold is charged whole (and reported); one never confirmed billed
    // answers `not-metered` and is refunded here. The row stays cancelled.
    const { settleSweptMeteredLlmJob } = await import("../llm-billing.js")
    const verdict = await settleSweptMeteredLlmJob({ id: jobId, reconcile_attempts: reconcileAttempts, reconcile_last_error: lastError }, { statuses: CANCELLED })
    if (verdict === "not-metered") {
      console.warn(`[reconcile/cancelled-holds] job ${jobId}: no billed metered call confirmed at the attempt cap — its hold is refunded`)
      await refundLogs(jobId, logs)
    }
    return
  }

  const { meteredSpendFromRow } = await import("../llm-row-spend.js")
  const { settleLlmUsageLog } = await import("../llm-billing.js")
  for (const log of logs) {
    const fromRow = await meteredSpendFromRow(jobId, log.chargeId)
    if (!fromRow || fromRow.readFailed) {
      // What the job billed is unknown: never settled or refunded on a guess.
      await bumpMeteredSweepAttempts(jobId, attempt, "cancelled hold: its billing ledger could not be read", meteredBilledConfirmed(lastError), CANCELLED)
      return
    }
    if (!fromRow.spend.billedAnything) {
      // R62 (R60 for this sweep): nothing billed recorded — but a call that
      // STARTED (stamped, no pre-call marker) may have been billed with its
      // spend never written (its process died mid-call). Billed-unknown: the
      // hold is kept to the D10 cap rule (charged whole there), never
      // refunded; an earlier tick's billed confirmation counts the same.
      // Unreadable → retried unconfirmed. Only a call that never started is
      // refunded (the settle below, with the empty spend).
      const { readLlmCallStart } = await import("../llm-billing-ledger.js")
      const started = meteredBilledConfirmed(lastError) ? "started" : await readLlmCallStart(jobId)
      if (started === "unknown") {
        await bumpMeteredSweepAttempts(jobId, attempt, "cancelled hold: its call start could not be read", false, CANCELLED)
        return
      }
      if (started === "started") {
        await bumpMeteredSweepAttempts(jobId, attempt, "cancelled hold: its call started with no billed figure recorded (cost unknown) — kept to the D10 cap", true, CANCELLED)
        return
      }
    }
    const settled = await settleLlmUsageLog(log.id, jobId, log.chargeId, fromRow.spend)
    if (settled.outcome === "unsettled") {
      await bumpMeteredSweepAttempts(
        jobId,
        attempt,
        "cancelled hold: its settle was not confirmed",
        fromRow.spend.billedAnything || meteredBilledConfirmed(lastError),
        CANCELLED,
      )
      return
    }
    console.warn(
      `[reconcile/cancelled-holds] cancelled job ${jobId}: its stranded metered hold (log ${log.id}) was settled from its ledger — ${settled.outcome}` +
        (settled.outcome === "charged" ? ` (${settled.charged} credits)` : ""),
    )
  }
}

async function refundLogs(jobId: string, logs: Array<{ id: string }>): Promise<void> {
  const { CreditsService } = await import("../../ee/billing/credits.js")
  for (const log of logs) {
    try {
      await CreditsService.refundCredits(log.id)
    } catch (err) {
      console.error(`[reconcile/cancelled-holds] job ${jobId}: refund of log ${log.id} failed:`, err)
    }
  }
}
