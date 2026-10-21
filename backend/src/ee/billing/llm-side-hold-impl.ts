// @registry-enumerates reserves, commits and refunds the metered credit id it is given through CreditsService — a credit id, not a node type, so not a @registry-lookup
// Cloud implementation of metered LLM SIDE holds (`lib/llm-side-hold.ts`,
// migration 554): the reserve (the credit guard's checks, then
// `reserve_llm_side_hold`), the ledger, the settle (the ordinary metered
// settle with the hold's OWN row as its sink — the job's billing columns are
// never written), the post-flip cancel rule and the sweep's settle. Loaded by
// dynamic import only when credits exist.

import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { supabase } from "../../lib/supabase.js"
import { insertAppReport } from "../../lib/app-reports.js"
import { isBillingContext, isDeploymentBillingContext, type BillingContext } from "../../lib/billing-context.js"
import { mapReserveError } from "../../lib/reserve-errors.js"
import { LlmSpend, type LlmSettleOutcome } from "../../lib/llm-billing.js"
import type { LlmBillingLedgerWrite } from "../../lib/llm-billing-ledger.js"
import type { LlmSideHoldRefusal, LlmSideHoldReserveArgs, LlmSideReserveImplResult } from "../../lib/llm-side-hold.js"
import { METERED_SWEEP_MAX_ATTEMPTS } from "../../lib/reconcile/metered-sweep-attempts.js"
import { CreditsService, PriceNotConfiguredError } from "./credits.js"
import { computeActualCredits } from "./credit-anomaly.js"
import { LlmUnpricedModelError, llmChargeId } from "./llm-metered.js"
import { llmHoldForCalls, settleLlmUsageLogImpl } from "./llm-billing-impl.js"
import { parseMeteredLlmId } from "./metered-llm-id.js"
import { ConsentRequiredError } from "../lib/consent-required.js"

export { llmHoldForCalls } from "./llm-billing-impl.js"

const TABLE = "llm_side_holds"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function refusal(code: LlmSideHoldRefusal["code"], message: string, extra: { required?: number; balance?: number } = {}): LlmSideHoldRefusal {
  return { ok: false, code, message, ...extra }
}

/**
 * The payer carried from the job's admission, checked: a context of another
 * user, or a malformed one, is refused (never degraded to someone's pocket).
 */
function payerContext(args: LlmSideHoldReserveArgs): { ok: true; ctx: BillingContext | undefined } | { ok: false } {
  const ctx = args.payer?.billingContext
  if (ctx === undefined) return { ok: true, ctx: undefined }
  if (!(isBillingContext(ctx) || isDeploymentBillingContext(ctx)) || ctx.userId !== args.userId) return { ok: false }
  return { ok: true, ctx }
}

export async function reserveLlmSideHoldImpl(args: LlmSideHoldReserveArgs): Promise<LlmSideReserveImplResult> {
  if (typeof args.jobId !== "string" || !UUID.test(args.jobId) || typeof args.userId !== "string" || !UUID.test(args.userId)) {
    return refusal("invalid_request", "A side hold needs the job's id and its owner's id")
  }
  // The planned calls, checked before anything reads them: a malformed list is a refusal, never a throw.
  const calls: unknown = (args as { calls?: unknown }).calls
  if (!Array.isArray(calls) || calls.length === 0 || !calls.every((c) => !!c && typeof c === "object" && typeof (c as { modelId?: unknown }).modelId === "string" && (c as { modelId: string }).modelId.length > 0)) {
    return refusal("invalid_request", "A side hold needs its planned calls: a non-empty list, each naming its model")
  }
  if (typeof args.key !== "string" || args.key.length === 0 || args.key.length > 200) {
    return refusal("invalid_request", "A side hold needs its key: a string of 1–200 characters, unique per job")
  }
  const payer = payerContext(args)
  if (!payer.ok) return refusal("conflict", "The payer is not the job's")

  // A replay FIRST — before any pricing or credit check: the hold its key already names is answered
  // as it is (never refused for a balance its own reservation already paid, never re-priced, and
  // replayed even if its model has since lost its price). The charge id needs no price.
  const replayChargeId = llmChargeId(args.feature, args.calls[0].modelId)
  const keyed = await keyedHold(args.jobId, args.userId, args.key, replayChargeId)
  if (keyed) return keyed

  let hold: { chargeId: string; holdCredits: number }
  try {
    hold = await llmHoldForCalls(args.feature, args.calls)
  } catch (err) {
    if (err instanceof LlmUnpricedModelError) {
      console.warn(`[llm-side-hold] ${args.feature}: refused unpriced model ${err.modelId} (${err.lane} lane), job=${args.jobId}`)
      return refusal("llm_model_unpriced", `The model ${err.modelId} has no price`)
    }
    console.warn(`[llm-side-hold] ${args.feature}: no hold for job ${args.jobId}:`, err)
    return refusal("invalid_request", err instanceof Error ? err.message : String(err))
  }
  const { chargeId, holdCredits } = hold
  const isAppRun = args.payer?.isAppRun
  const webFreeMode = args.payer?.webFreeMode ?? false

  // The route guard's own pre-check (credit-guard-impl `holdCovered`): a short
  // balance is a clear refusal that names the hold, with nothing reserved.
  let check: Awaited<ReturnType<typeof CreditsService.checkCredits>>
  try {
    check = await CreditsService.checkCredits(args.userId, chargeId, isAppRun, holdCredits, {
      billingContext: payer.ctx,
      webFreeMode,
    })
  } catch (err) {
    if (err instanceof PriceNotConfiguredError) return refusal("llm_model_unpriced", `${chargeId} has no price`)
    console.error(`[llm-side-hold] job ${args.jobId}: the credit check failed:`, err)
    return refusal("reservation_failed", "Failed to check credits")
  }
  if (!check.allowed) {
    if (check.code === "free_video_limit") return refusal("free_video_limit", check.error ?? "Not available on free credits")
    if (check.subscriptionRequired) return refusal("subscription_required", check.error ?? "A subscription is required")
    if (payer.ctx?.payer === "deployment") {
      return refusal("insufficient_credits", "This deployment is out of credits. Contact your administrator.", { required: holdCredits })
    }
    const shortBalance = check.balance !== undefined && check.balance < holdCredits
    return refusal("insufficient_credits", shortBalance ? `Needs up to ${holdCredits} credits` : check.error ?? "Insufficient credits", {
      required: holdCredits,
      ...(check.balance !== undefined ? { balance: check.balance } : {}),
    })
  }

  try {
    const reservation = await CreditsService.reserveCredits(args.userId, args.jobId, chargeId, 0, 0, {
      billingContext: payer.ctx,
      isAppRun,
      creditOverride: holdCredits,
      webFreeMode,
      ...(args.payer?.skipAutoRecharge ? { skipAutoRecharge: true } : {}),
      ...(args.payer?.communityInstance ? { communityInstance: true } : {}),
      sideHold: { key: args.key },
    })
    const prior = (reservation.sideLedger as { attempts?: unknown } | undefined)?.attempts
    return {
      ok: true,
      usageLogId: reservation.usageLogId,
      chargeId,
      holdCredits: reservation.creditsReserved,
      replayed: reservation.replayed === true,
      priorAttempts: Array.isArray(prior) ? prior : [],
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (err instanceof ConsentRequiredError) return refusal("consent_required", err.message)
    if (err instanceof PriceNotConfiguredError) return refusal("llm_model_unpriced", `${chargeId} has no price`)
    if (detail.includes("SUBSCRIPTION_REQUIRED:")) return refusal("subscription_required", "A subscription is required")
    if (detail.includes("SIDE_HOLD_INACTIVE:")) return refusal("job_not_live", "The job is no longer running")
    if (detail.includes("SIDE_HOLD_KEY_SETTLED:")) return refusal("key_settled", "This reading was already settled — reserve under a new key")
    // The same key reserved concurrently (the unique index won against this one): the other's hold.
    if (detail.includes("llm_side_holds_job_key") || /duplicate key|23505/.test(detail)) {
      const other = await keyedHold(args.jobId, args.userId, args.key, chargeId)
      if (other) return other
      return refusal("key_in_use", "This reading is being reserved by another attempt — retry")
    }
    if (detail.includes("SIDE_HOLD_CONFLICT:")) return refusal("conflict", "The hold conflicts with the job or an earlier hold")
    const mapped = mapReserveError(err)
    if (mapped) return refusal(mapped.code, mapped.message)
    if (/insufficient/i.test(detail)) return refusal("insufficient_credits", `Needs up to ${holdCredits} credits`, { required: holdCredits })
    console.error(`[llm-side-hold] job ${args.jobId}: the side-hold reservation failed (a hold it may have made is released by the side-hold sweep): ${detail}`)
    return refusal("reservation_failed", "Failed to reserve credits")
  }
}

/**
 * The hold `key` already names on this job, answered before any credit check: an OPEN hold of the
 * same charge id is replayed (its recorded spend carried in), a settled or closed one is
 * `key_settled`, another charge id is `conflict`; undefined — no such hold.
 */
async function keyedHold(jobId: string, userId: string, key: string, chargeId: string): Promise<LlmSideReserveImplResult | undefined> {
  const { data, error } = await supabase
    .from(TABLE as "assets")
    .select("usage_log_id, charge_id, hold_credits, closed_at, settled_at, ledger, usage_logs!inner(status)")
    .eq("job_id", jobId)
    // Only the job owner's own hold is ever answered (the job id alone is not proof of who asks).
    .eq("user_id", userId)
    .eq("hold_key", key)
    .maybeSingle()
  if (error || !data) return undefined
  const row = data as unknown as {
    usage_log_id: string; charge_id: string; hold_credits: number; closed_at: string | null; settled_at: string | null; ledger: unknown
    usage_logs?: { status?: unknown } | Array<{ status?: unknown }> | null
  }
  if (row.charge_id !== chargeId) return refusal("conflict", "The key names another hold")
  const log = Array.isArray(row.usage_logs) ? row.usage_logs[0] : row.usage_logs
  if (row.closed_at !== null || row.settled_at !== null || log?.status !== "reserved") {
    return refusal("key_settled", "This reading was already settled — reserve under a new key")
  }
  const prior = (row.ledger as { attempts?: unknown } | null)?.attempts
  return { ok: true, usageLogId: row.usage_log_id, chargeId, holdCredits: row.hold_credits, replayed: true, priorAttempts: Array.isArray(prior) ? prior : [] }
}

/** What the settle would charge for `spend` — its own arithmetic. */
export async function sideCreditsForImpl(chargeId: string, spend: LlmSpend): Promise<number> {
  return computeActualCredits(Math.max(spend.costUsd, CREDIT_BASE_USD), chargeId)
}

/** The hold's running ledger for `spend`: its record (or an uncomputable one) with every attempt. */
function ledgerOf(chargeId: string, spend: LlmSpend): LlmBillingLedgerWrite {
  const attempts = [...spend.attempts]
  try {
    const record = spend.record
    if (!Number.isFinite(record.costUsd) || record.costUsd < 0) throw new Error(`non-finite cost ${record.costUsd}`)
    return { ...record, chargeId, attempts }
  } catch {
    return { costUsd: null, source: "uncomputable", calls: attempts.length, lanes: attempts.map((a) => a.lane), chargeId, attempts }
  }
}

/** Record `spend` on the hold's ledger (the sweep's evidence). Throws on a failed write (the caller warns). */
export async function noteSideHoldSpendImpl(usageLogId: string, chargeId: string, spend: LlmSpend): Promise<void> {
  // Never over a settled hold: its ledger is what was charged (and audited).
  const { error } = await supabase
    .from(TABLE as "assets")
    .update({ ledger: ledgerOf(chargeId, spend) } as Record<string, unknown>)
    .eq("usage_log_id", usageLogId)
    .is("settled_at", null)
  if (error) throw new Error(error.message)
}

/** Close the hold: no call may start on it from now on. Answers whether THIS write closed it (a CAS on `cond`). */
async function closeHold(usageLogId: string, cond: { preCall?: boolean; callStartedAt?: string | null } = {}): Promise<boolean> {
  let q = supabase
    .from(TABLE as "assets")
    .update({ closed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("usage_log_id", usageLogId)
    .is("closed_at", null)
  if (cond.preCall !== undefined) q = q.eq("pre_call", cond.preCall)
  if (cond.callStartedAt !== undefined) q = cond.callStartedAt === null ? q.is("call_started_at", null) : q.eq("call_started_at", cond.callStartedAt)
  const { data, error } = await q.select("usage_log_id")
  if (error) throw new Error(error.message)
  return Array.isArray(data) && data.length > 0
}

/** Mark the hold settled (once: a later settle never rewrites the outcome). */
async function markSettled(usageLogId: string, outcome: "charged" | "refunded", ledger?: LlmBillingLedgerWrite): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from(TABLE as "assets")
    .update({ settled_at: now, outcome, ...(ledger ? { ledger } : {}) } as Record<string, unknown>)
    .eq("usage_log_id", usageLogId)
    .is("settled_at", null)
  if (error) console.warn(`[llm-side-hold] could not mark side hold ${usageLogId} settled (${outcome}): ${error.message}`)
  // `closed_at` too, apart: a settled hold never starts a call (the RPC also refuses a non-reserved log).
  await supabase.from(TABLE as "assets").update({ closed_at: now } as Record<string, unknown>).eq("usage_log_id", usageLogId).is("closed_at", null)
}

/**
 * Settle a side hold at its actual: the ordinary metered settle
 * (`settleLlmUsageLogImpl` — D1's metered commit, the floor, the
 * already-committed re-run case, a cost that cannot be computed charged as
 * the hold) whose SINK is the hold's own row — `jobs.provider_cost`,
 * `credits_actual` and its billing ledger are never written. The hold is closed
 * first (no call starts on a hold being settled).
 */
export async function settleSideHoldImpl(input: {
  usageLogId: string
  jobId: string
  chargeId: string
  holdCredits: number | undefined
  spend: LlmSpend
}): Promise<LlmSettleOutcome> {
  const { usageLogId, jobId, chargeId, spend } = input
  try {
    // The close and the FINAL ledger in one write: whoever settles a closed hold (a cancel, the sweep,
    // after the closed grace) reads this spend, charges the same actual, and the second commit dedupes.
    await closeHoldWithLedger(usageLogId, spend.billedAnything ? ledgerOf(chargeId, spend) : undefined)
  } catch (err) {
    console.warn(`[llm-side-hold] could not close side hold ${usageLogId} before its settle:`, err)
  }
  const attempts = [...spend.attempts]
  const sink = async (billing: LlmBillingLedgerWrite, charged: number | undefined): Promise<void> => {
    const ledger: LlmBillingLedgerWrite = { ...billing, attempts }
    if (charged !== undefined) {
      await markSettled(usageLogId, "charged", ledger)
      return
    }
    // Not confirmed: the ledger is the sweep's evidence (it never claims a charge).
    const { error } = await supabase.from(TABLE as "assets").update({ ledger } as Record<string, unknown>).eq("usage_log_id", usageLogId)
    if (error) console.warn(`[llm-side-hold] could not record the ledger of side hold ${usageLogId}: ${error.message}`)
  }
  const outcome = await settleLlmUsageLogImpl(usageLogId, jobId, chargeId, spend, input.holdCredits, sink)
  if (outcome.outcome === "refunded") {
    // The refund is confirmed only by the log having moved (a refund RPC that did nothing leaves it
    // `reserved`): until then the hold stays open, and the sweep settles it on a later tick.
    const status = await readLogStatus(usageLogId)
    if (status !== undefined && status !== "reserved") await markSettled(usageLogId, status === "refunded" ? "refunded" : "charged")
    else console.warn(`[llm-side-hold] side hold ${usageLogId}: its refund was not confirmed — left open for the side-hold sweep`)
  }
  return outcome
}

/**
 * Close the hold and record its final ledger in ONE update (or, a hold another writer closed
 * already, record the ledger alone while it is unsettled). Throws on a failed write.
 */
async function closeHoldWithLedger(usageLogId: string, ledger: LlmBillingLedgerWrite | undefined): Promise<void> {
  const { data, error } = await supabase
    .from(TABLE as "assets")
    .update({ closed_at: new Date().toISOString(), ...(ledger ? { ledger } : {}) } as Record<string, unknown>)
    .eq("usage_log_id", usageLogId)
    .is("closed_at", null)
    .select("usage_log_id")
  if (error) throw new Error(error.message)
  if (ledger && !(Array.isArray(data) && data.length > 0)) {
    const { error: ledgerError } = await supabase
      .from(TABLE as "assets")
      .update({ ledger } as Record<string, unknown>)
      .eq("usage_log_id", usageLogId)
      .is("settled_at", null)
    if (ledgerError) throw new Error(ledgerError.message)
  }
}

/**
 * How long a hold another writer CLOSED (a worker's own settle under way) is left to that writer
 * before a cancel or the sweep settles it from its ledger.
 */
export const SIDE_HOLD_CLOSED_GRACE_MS = 2 * 60_000

function closedWithinGrace(closedAt: string | null, nowMs: number): boolean {
  if (closedAt === null) return false
  const at = Date.parse(closedAt)
  return Number.isFinite(at) && nowMs - at <= SIDE_HOLD_CLOSED_GRACE_MS
}

/** The spend a hold's ledger recorded — its attempts, else its cost as one stated charge. `billed-unpriceable`: billed calls whose cost the ledger cannot give. */
export function spendFromSideLedger(chargeId: string, ledger: unknown): { spend: LlmSpend } | { billedUnpriceable: true } {
  const spend = new LlmSpend()
  const l = (ledger && typeof ledger === "object" ? ledger : {}) as { attempts?: unknown; costUsd?: unknown; calls?: unknown; lanes?: unknown }
  const modelId = parseMeteredLlmId(chargeId)?.modelId ?? chargeId
  const request = { modelId, system: "", messages: [] }
  const attempts = Array.isArray(l.attempts) ? l.attempts : []
  if (attempts.length > 0) {
    try {
      spend.add(modelId, request, { output: { attempts } as never })
      return { spend }
    } catch {
      // Unreadable attempts: the stated cost below stands for them.
    }
  }
  if (typeof l.costUsd === "number" && Number.isFinite(l.costUsd) && l.costUsd > 0) {
    const lanes = Array.isArray(l.lanes) ? l.lanes : []
    const lane = lanes.find((x) => x === "kie" || x === "direct-gemini" || x === "direct-anthropic") ?? "kie"
    spend.add(modelId, request, { output: { attempts: [{ lane, modelId, requestChars: 0, inputTokens: 0, outputTokens: 0, creditsUsd: l.costUsd }] } as never })
    return { spend }
  }
  if (typeof l.calls === "number" && l.calls > 0) return { billedUnpriceable: true }
  return { spend }
}

interface OpenHoldRow {
  usage_log_id: string
  job_id: string | null
  charge_id: string
  hold_credits: number
  pre_call: boolean
  call_started_at: string | null
  closed_at: string | null
  ledger: unknown
  sweep_attempts: number
  sweep_billed: boolean
  created_at: string
  usage_logs?: { status?: unknown; credits_used?: unknown } | Array<{ status?: unknown; credits_used?: unknown }> | null
}

const OPEN_COLUMNS = "usage_log_id, job_id, charge_id, hold_credits, pre_call, call_started_at, closed_at, ledger, sweep_attempts, sweep_billed, created_at, usage_logs!inner(status, credits_used)"

function logOf(row: OpenHoldRow): { status?: unknown; credits_used?: unknown } | undefined {
  return Array.isArray(row.usage_logs) ? row.usage_logs[0] : row.usage_logs ?? undefined
}

/** Settle one closed hold from its ledger (no call can start on it). */
async function settleClosedFromLedger(row: OpenHoldRow): Promise<"settled" | "unsettled" | "billed-unpriceable"> {
  const from = spendFromSideLedger(row.charge_id, row.ledger)
  if ("billedUnpriceable" in from) return "billed-unpriceable"
  const outcome = await settleSideHoldImpl({
    usageLogId: row.usage_log_id,
    jobId: row.job_id ?? "",
    chargeId: row.charge_id,
    holdCredits: row.hold_credits,
    spend: from.spend,
  })
  if (outcome.outcome === "unsettled") return "unsettled"
  // A refund counts only once the log moved (a refund RPC that did nothing leaves it reserved).
  if (outcome.outcome === "refunded" && (await readLogStatus(row.usage_log_id)) === "reserved") return "unsettled"
  return "settled"
}

/**
 * The post-flip cancel rule for the side holds of `jobIds` (see
 * `settleSideHoldsAfterFlip`). Reads only jobs whose row IS cancelled.
 */
export async function settleSideHoldsAfterFlipImpl(jobIds: readonly string[]): Promise<void> {
  const { data: jobs, error: jobsError } = await supabase.from("jobs").select("id, status").in("id", [...jobIds])
  if (jobsError) throw new Error(jobsError.message)
  const cancelled = ((jobs ?? []) as Array<{ id: string; status?: unknown }>).filter((j) => j.status === "cancelled").map((j) => j.id)
  if (cancelled.length === 0) return
  const { data, error } = await supabase
    .from(TABLE as "assets")
    .select(OPEN_COLUMNS)
    .in("job_id", cancelled)
    .is("settled_at", null)
  if (error) throw new Error(error.message)
  for (const row of (data ?? []) as unknown as OpenHoldRow[]) {
    if (logOf(row)?.status !== "reserved") continue
    if (row.closed_at !== null && closedWithinGrace(row.closed_at, Date.now())) {
      // Its own settle is under way (closed with its final ledger): left to it, the sweep otherwise.
      continue
    }
    if (row.closed_at === null) {
      if (!row.pre_call) {
        // Started: a call may be in flight — kept for the worker's settle at
        // the actual (D10: never refunded on a guess); the sweep otherwise.
        console.warn(`[llm-side-hold] cancelled job ${row.job_id}: side hold ${row.usage_log_id}'s call has started — kept for its own settle`)
        continue
      }
      // Not started: closed only while it is still pre-call (the CAS), so a
      // call that started meanwhile is kept, never settled under it.
      if (!(await closeHold(row.usage_log_id, { preCall: true }))) continue
    }
    const settled = await settleClosedFromLedger(row)
    if (settled !== "settled") {
      console.warn(`[llm-side-hold] cancelled job ${row.job_id}: side hold ${row.usage_log_id} not settled yet (${settled}) — left to the side-hold sweep`)
    }
  }
}

/**
 * How long after its last stamp (the call's start, else its reservation) an
 * open side hold may still have a call in flight: the live sweep's pre-task
 * threshold plus the per-node ceiling — the cancelled-hold sweep's own grace
 * for a worker's call (R38 m2).
 */
export function sideHoldPastGrace(row: { call_started_at: string | null; created_at: string; closed_at: string | null }, nowMs: number, graceMs: number): boolean {
  // A closed hold can start no call: the one it ran, if any, ended when it was closed — but the
  // writer that closed it is given a short grace to finish its own settle.
  if (row.closed_at !== null) return !closedWithinGrace(row.closed_at, nowMs)
  const anchorMs = Date.parse(row.call_started_at ?? row.created_at)
  if (!Number.isFinite(anchorMs)) return true
  return nowMs - anchorMs > graceMs
}

export interface SideHoldSweepResult {
  scanned: number
  settled: number
  notStale: number
  retried: number
  errors: number
}

/**
 * The side-hold sweep's pass: every hold no settle confirmed, whatever its
 * job's state (live, cancelled, finished, deleted).
 *  - the usage log is no longer reserved → recorded as settled (another
 *    writer settled it);
 *  - within the grace → left (its worker may still be calling);
 *  - past it → closed (a CAS on the stamp it read: a call that started since
 *    is left alone), then settled from its ledger: the billed actual charged,
 *    nothing billed refunded;
 *  - not confirmed → its own `sweep_attempts` advance; at
 *    {@link METERED_SWEEP_MAX_ATTEMPTS} (D10): a billed hold is charged whole
 *    through the plain commit and reported; one never billed is refunded.
 * Nothing is left reserved silently.
 */
export async function sweepSideHoldsImpl(result: SideHoldSweepResult, opts: { graceMs: number; limit: number; nowMs?: number }): Promise<void> {
  const now = opts.nowMs ?? Date.now()
  const { data, error } = await supabase
    .from(TABLE as "assets")
    .select(OPEN_COLUMNS)
    .is("settled_at", null)
    // Fewest attempts first: holds retried at the D10 cap never starve newer ones (head of line).
    .order("sweep_attempts", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(opts.limit)
  if (error) {
    console.error(`[reconcile/side-holds] query failed:`, error.message)
    result.errors++
    return
  }
  for (const row of (data ?? []) as unknown as OpenHoldRow[]) {
    result.scanned++
    try {
      await sweepOne(row, now, opts.graceMs, result)
    } catch (err) {
      console.error(`[reconcile/side-holds] side hold ${row.usage_log_id}: settle failed:`, err)
      result.errors++
    }
  }
}

async function sweepOne(row: OpenHoldRow, now: number, graceMs: number, result: SideHoldSweepResult): Promise<void> {
  const logStatus = logOf(row)?.status
  if (logStatus !== "reserved") {
    // Settled by another writer (a settle whose bookkeeping write failed).
    await markSettled(row.usage_log_id, logStatus === "refunded" ? "refunded" : "charged")
    result.settled++
    return
  }
  if (!sideHoldPastGrace(row, now, graceMs)) {
    result.notStale++
    return
  }
  if (row.closed_at === null && !(await closeHold(row.usage_log_id, { preCall: row.pre_call, callStartedAt: row.call_started_at }))) {
    // Its stamp moved since the read (a call started): not stale after all.
    result.notStale++
    return
  }
  const attempt = row.sweep_attempts + 1
  const settled = await settleClosedFromLedger(row)
  if (settled === "settled") {
    console.warn(`[reconcile/side-holds] side hold ${row.usage_log_id} (job ${row.job_id ?? "deleted"}, ${row.charge_id}) was never settled by its worker — settled from its ledger`)
    result.settled++
    return
  }
  const billed = settled === "billed-unpriceable" || row.sweep_billed || ledgerBilled(row.ledger)
  if (attempt < METERED_SWEEP_MAX_ATTEMPTS) {
    await bumpSideAttempts(row.usage_log_id, attempt, billed, `side hold not settled (${settled})`)
    result.retried++
    return
  }
  await settleAtCap(row, attempt, billed)
  result.settled++
}

function ledgerBilled(ledger: unknown): boolean {
  return !!ledger && typeof ledger === "object" && typeof (ledger as { calls?: unknown }).calls === "number" && (ledger as { calls: number }).calls > 0
}

async function bumpSideAttempts(usageLogId: string, attempts: number, billed: boolean, why: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE as "assets")
    .update({ sweep_attempts: attempts, sweep_last_error: why.slice(0, 500), ...(billed ? { sweep_billed: true } : {}) } as Record<string, unknown>)
    .eq("usage_log_id", usageLogId)
  if (error) console.error(`[reconcile/side-holds] could not bump the attempts of side hold ${usageLogId}: ${error.message}`)
}

/**
 * D10 at the attempt cap: a billed hold is charged WHOLE through the plain
 * commit (confirmed by re-reading the log) and reported; a hold never
 * confirmed billed is refunded. A log another writer settled meanwhile is left
 * as it recorded it.
 */
async function settleAtCap(row: OpenHoldRow, attempt: number, billed: boolean): Promise<void> {
  const id = row.usage_log_id
  if (!billed) {
    try {
      await CreditsService.refundCredits(id)
    } catch (err) {
      console.error(`[reconcile/side-holds] refund of side hold ${id} at the cap threw:`, err)
    }
    const after = await readLogStatus(id)
    if (after !== "reserved" && after !== undefined) {
      console.error(`[reconcile/side-holds] ALERT: side hold ${id} could not be settled after ${attempt} attempts and nothing billed was confirmed — refunded`)
      await markSettled(id, after === "refunded" ? "refunded" : "charged")
      await report(row, "metered-side-hold-refunded-at-cap", `Metered side hold ${id}: unsettled after ${attempt} sweep attempts, nothing billed confirmed — refunded`, attempt)
      return
    }
    // The refund did not land: kept for the next tick (its counter advances), never reported as done.
    await bumpSideAttempts(id, attempt, false, "the refund at the cap could not be confirmed")
    return
  }
  let threw = false
  try {
    await CreditsService.commitCredits(id, row.hold_credits)
  } catch (err) {
    threw = true
    console.error(`[reconcile/side-holds] plain commit of side hold ${id} threw:`, err)
  }
  const after = await readLogStatus(id)
  if (after === "committed" || after === "refunded") {
    await markSettled(id, after === "refunded" ? "refunded" : "charged")
    await report(row, "metered-side-hold-charged-at-cap", `Metered side hold ${id}: billed, never settled — hold charged whole after ${attempt} sweep attempts`, attempt)
    return
  }
  console.error(`[reconcile/side-holds] ALERT: side hold ${id} still unsettled at the cap (threw: ${threw}) — kept for the next tick, never refunded`)
  await bumpSideAttempts(id, attempt, true, "the plain commit at the cap could not be confirmed")
  await report(row, "metered-side-hold-unsettled-at-cap", `Metered side hold ${id}: billed, hold still unsettled after ${attempt} sweep attempts`, attempt)
}

async function readLogStatus(usageLogId: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase.from("usage_logs").select("status").eq("id", usageLogId).maybeSingle()
    if (error || !data) return undefined
    const status = (data as { status?: unknown }).status
    return typeof status === "string" ? status : undefined
  } catch {
    return undefined
  }
}

async function report(row: OpenHoldRow, kind: string, title: string, attempts: number): Promise<void> {
  await insertAppReport({
    node: "llm-billing-side-hold",
    kind,
    severity: "error",
    title,
    payload: { usageLogId: row.usage_log_id, chargeId: row.charge_id, hold: row.hold_credits, attempts },
    ...(row.job_id ? { jobId: row.job_id } : {}),
  })
}

/**
 * R57 / R61: a DELIBERATE platform refund of a job's side holds already charged — a held job its owner
 * withdraws (`billing_force_refund`), or a job a result policy blocks or a reviewer rejects, is refunded
 * whole, its readings too, as when they sat inside its own reservation. Not the D10 case (a billed call stays charged everywhere else). Each charged side
 * log is reversed by `refund_settled_side_hold`; an external-wallet row (its journal is not reversed
 * here) or a failed refund is reported, never silent. Answers how many were refunded.
 */
export async function refundSettledSideHoldsImpl(jobId: string): Promise<number> {
  const { data, error } = await supabase
    .from(TABLE as "assets")
    .select("usage_log_id, charge_id, hold_credits, job_id, usage_logs!inner(status)")
    .eq("job_id", jobId)
    .eq("usage_logs.status", "committed")
  if (error) throw new Error(error.message)
  let refunded = 0
  for (const row of (data ?? []) as unknown as OpenHoldRow[]) {
    let answer: unknown
    let failure: string | undefined
    try {
      const { data: out, error: rpcError } = await supabase.rpc("refund_settled_side_hold", { p_usage_log_id: row.usage_log_id })
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
      node: "llm-billing-side-hold",
      kind: "side-hold-withdraw-refund-not-applied",
      severity: "error",
      title: `Job ${jobId} (refunded by the platform): its charged side hold ${row.usage_log_id} was not refunded (${answer === "unsupported" ? "external wallet" : failure ?? String(answer)}) — refund it by hand`,
      payload: { usageLogId: row.usage_log_id, chargeId: row.charge_id, answer: answer ?? null, failure: failure ?? null },
      jobId,
    })
  }
  return refunded
}
