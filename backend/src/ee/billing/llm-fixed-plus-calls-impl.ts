// @registry-enumerates reserves and settles the fixed and metered credit ids it is given through getModelCreditCostFromDB / CreditsService — credit ids, not node types, so not a @registry-lookup
/**
 * Cloud implementation of `lib/llm-fixed-plus-calls.ts`: a FIXED-price job
 * that also makes metered LLM calls, in ONE reservation (the scrapes'
 * per-item analysis, B5). Reached only through the core shim's dynamic
 * `import()`, so core never statically imports `ee/`.
 */
import { isFixedPlusLlmCallsHoldId } from "../../lib/llm-ledger-holds.js"
import type { FastifyReply, FastifyRequest } from "fastify"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { getAppSettings } from "../../lib/app-settings.js"
import { supabase } from "../../lib/supabase.js"
import { writeLlmBillingLedger, type LlmBillingLedgerWrite } from "../../lib/llm-billing-ledger.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import type { LlmBillingRecord, LlmPlannedCall, LlmSpend } from "../../lib/llm-billing.js"
import type { FixedPlusLlmHold, FixedPlusLlmSettle } from "../../lib/llm-fixed-plus-calls.js"
import { CreditsService, getModelCreditCostFromDB } from "./credits.js"
import { computeActualCredits } from "./credit-anomaly.js"
import { LlmUnpricedModelError, llmChargeId, llmEstimateBaseCredits, llmHoldBaseCredits } from "./llm-metered.js"
import { sendLlmModelUnpriced } from "./llm-unpriced-reply.js"
import { parseMeteredLlmId } from "./metered-llm-id.js"
import type { MeteredLlmFeature } from "./llm-typical-usage.js"
import { applyServiceMarkup } from "./service-margin.js"

export async function reserveFixedPlusLlmCallsImpl(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  args: { fixedId: string; feature: MeteredLlmFeature; modelId: string; items: number; plannedRequest: LlmPlannedCall["request"] },
): Promise<FixedPlusLlmHold | undefined> {
  const chargeId = llmChargeId(args.feature, args.modelId)
  if (!parseMeteredLlmId(chargeId)) throw new Error(`reserveFixedPlusLlmCalls: "${args.feature}" is not a metered LLM feature`)
  // R63: a cancel consults the job's ledger only for holds that can carry one —
  // a fixed id outside the registry would be refunded without that read.
  if (!isFixedPlusLlmCallsHoldId(args.fixedId)) {
    throw new Error(`reserveFixedPlusLlmCalls: "${args.fixedId}" is not a registered fixed + calls id (lib/llm-ledger-holds.ts FIXED_PLUS_LLM_CALLS_NODE_TYPES)`)
  }
  let perItemBase: number
  try {
    // Fail closed first: the model must be priced on every lane it may be
    // served on (the 1-attempt hold's own check) — the figure is not used.
    llmHoldBaseCredits(args.modelId, { request: args.plannedRequest })
    // D12: each item is held at its TYPICAL cost (LLM_TYPICAL_USAGE), not
    // one attempt at the full output cap; the actual is collected at settle.
    perItemBase = llmEstimateBaseCredits(args.feature, args.modelId)
  } catch (err) {
    if (!(err instanceof LlmUnpricedModelError)) throw err
    console.warn(`[llm-billing] ${args.feature}: refused unpriced model ${err.modelId} (${err.lane} lane), job=${jobId}`)
    const { error } = await supabase.from("jobs").delete().eq("id", jobId)
    if (error) console.warn(`[llm-billing] failed to delete refused job ${jobId}: ${error.message}`)
    sendLlmModelUnpriced(reply, err)
    return undefined
  }
  const items = Math.max(1, Math.trunc(args.items) || 1)
  // The fixed part is what the fixed id is CHARGED today (the lookup
  // `reserveCredits` itself prices a fixed id with); the calls' part is the
  // typical per-item cost × the item count, marked up at its own charge id.
  const fixedCharged = (await getModelCreditCostFromDB(args.fixedId)).creditCost
  const llmHoldCredits = applyServiceMarkup(perItemBase * items, await getAppSettings(), chargeId)
  const holdCredits = fixedCharged + llmHoldCredits
  const reservation = await reserveCreditsForJob(req, reply, jobId, args.fixedId, { holdCredits })
  if (!reservation || reply.sent) return undefined
  return { usageLogId: reservation.usageLogId, chargeId, fixedCharged, llmHoldCredits, holdCredits }
}

/**
 * Record the settle on the job, from the commit RECEIPT only (R13), run after
 * the job's completion write (and the tracker's `flush()`). Two writes, like
 * the single-call settle (`writeJobBilling`), so a failed ledger write never
 * takes the charge it records with it:
 *  1. `credits_actual` = what was charged, `provider_cost` = what the calls
 *     cost (when computable);
 *  2. the billing ledger, with the calls' `chargeId`, into the server-only
 *     ledger column (R32 — never `output_data`, which the job's owner reads).
 *     A billed call whose cost was uncomputable gets the `uncomputable`
 *     ledger, replacing any interim one with a partial cost.
 * Nothing billed → no ledger (the fixed part alone has none). Never throws.
 */
async function writeJobSettle(jobId: string, chargeId: string, charged: number, spend: LlmSpend, record: LlmBillingRecord | undefined): Promise<void> {
  try {
    const { error } = await supabase
      .from("jobs")
      .update({ credits_actual: charged, ...(record ? { provider_cost: record.costUsd } : {}) })
      .eq("id", jobId)
    if (error) console.warn(`[llm-billing] failed to record the settle on job ${jobId}: ${error.message}`)
  } catch (err) {
    console.warn(`[llm-billing] failed to record the settle on job ${jobId}: ${(err as Error).message}`)
  }
  if (!spend.billedAnything) return
  const ledger: LlmBillingLedgerWrite = record
    ? { ...record, chargeId }
    : { costUsd: null, source: "uncomputable", calls: spend.attempts.length, lanes: spend.attempts.map((a) => a.lane), chargeId }
  await writeLlmBillingLedger(jobId, ledger)
}

/**
 * An unconfirmed settle leaves the hold RESERVED on a job nothing sweeps
 * (the scrapes stamp no reconcile anchor): alert, and file a
 * `credit_anomalies` row ops can find it by. Never throws.
 */
async function reportUnsettled(jobId: string, hold: FixedPlusLlmHold, credits: number, why: string): Promise<void> {
  console.error(`[llm-billing] ALERT: settle of job ${jobId} (log ${hold.usageLogId}, ${hold.chargeId}, ${credits} credits) was not confirmed (${why}) — the hold of ${hold.holdCredits} stays reserved; settle it by hand`)
  try {
    const { data } = await supabase.from("jobs").select("user_id").eq("id", jobId).maybeSingle()
    // `metered_settle_unconfirmed` (migration 551's CHECK): a hold nothing settled, credits_actual 0.
    const { error } = await supabase.from("credit_anomalies" as "assets").insert({
      job_id: jobId,
      user_id: (data as { user_id?: string } | null)?.user_id ?? null,
      usage_log_id: hold.usageLogId,
      model_identifier: hold.chargeId,
      provider: null,
      credits_estimated: hold.holdCredits,
      credits_actual: 0,
      diff: -hold.holdCredits,
      provider_cost_usd: 0,
      anomaly_type: "metered_settle_unconfirmed",
      status: "pending",
      admin_notes: `Metered fixed + LLM settle (${credits} credits) not confirmed: ${why}. The hold stays reserved — settle it by hand.`,
    } as Record<string, unknown>)
    // A refused insert (a CHECK, RLS, a network error) answers an error; it does not throw.
    if (error) console.error(`[llm-billing] failed to file the unsettled anomaly for job ${jobId}: ${error.message}`)
  } catch (err) {
    console.error(`[llm-billing] failed to file the unsettled anomaly for job ${jobId}:`, err)
  }
}

export async function settleFixedPlusLlmCallsImpl(
  jobId: string,
  hold: FixedPlusLlmHold,
  spend: LlmSpend,
  fixedPart: "charge" | "refund",
): Promise<FixedPlusLlmSettle> {
  const jobLabel = `job ${jobId} (log ${hold.usageLogId}, ${hold.chargeId})`
  let total = 0
  try {
    const fixed = fixedPart === "charge" ? hold.fixedCharged : 0
    let llm = 0
    let record: LlmBillingRecord | undefined
    if (spend.billedAnything) {
      try {
        record = spend.record
        if (!Number.isFinite(record.costUsd) || record.costUsd < 0) throw new Error(`non-finite cost ${record.costUsd}`)
        // A billed call is charged at least the floor (1 base credit), at its own markup.
        llm = await computeActualCredits(Math.max(record.costUsd, CREDIT_BASE_USD), hold.chargeId)
      } catch (err) {
        // Billed, but not costable: charge the calls' hold whole, never refund it.
        console.error(`[llm-billing] ALERT: ${jobLabel}: the calls' cost could not be computed — charging their hold whole:`, err)
        llm = hold.llmHoldCredits
        record = undefined
      }
    }
    total = fixed + llm
    if (total === 0) {
      await CreditsService.refundCredits(hold.usageLogId)
      return { outcome: "refunded" }
    }
    // D1: the calls may cost more than their hold — commit_credits_metered
    // collects the overrun from the payer (capped at what they hold).
    const outcome = await CreditsService.commitCredits(hold.usageLogId, total, { collectOverHold: true })
    if (!outcome) {
      await reportUnsettled(jobId, hold, total, "no commit receipt")
      return { outcome: "unsettled" }
    }
    await writeJobSettle(jobId, hold.chargeId, outcome.charged, spend, record)
    return { outcome: "charged", charged: outcome.charged, shortfall: outcome.shortfall, ...(record ? { record } : {}) }
  } catch (err) {
    await reportUnsettled(jobId, hold, total, err instanceof Error ? err.message : String(err))
    return { outcome: "unsettled" }
  }
}
