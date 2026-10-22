/**
 * Metered LLM billing — the CORE shim every metered LLM route, worker and
 * plugin bills through (D1/D3).
 *
 * A metered call is charged what it really cost:
 *  1. reserve — `reserveLlmCall` holds ONE attempt of each call the feature
 *     makes for certain, on its primary lane (`llmHoldBaseCredits`), marked up
 *     at `llmChargeId(feature, calls[0].modelId)`;
 *  2. spend — the caller `add`s every call it made to an {@link LlmSpend},
 *     fallbacks and repairs included (A6), and each attempt is costed on the
 *     lane that served it ({@link llmAttemptCostUsd});
 *  3. settle — `settleLlmJob` charges `computeActualCredits(max(cost,
 *     CREDIT_BASE_USD), chargeId)` through `commit_credits_metered`, which
 *     collects any overrun above the hold from the payer (capped at what they
 *     hold); a call that billed nothing is refunded.
 *
 * The cost rules and the spend ledger are pure and live here. Reserving and
 * settling are Cloud-only and load `ee/billing/llm-billing-impl.ts` through a
 * dynamic `import()` (the `middleware/credit-guard.ts` pattern), so core never
 * statically imports `ee/`. Under the rollback (`!llmMeteredPricing()`) the
 * entry points that START metering are no-ops answering `{ metered: false }`
 * and the caller runs its tier billing exactly as before; a settle keys off
 * the reservation it is handed, so a call reserved metered before a rollback
 * flip still settles metered.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { hasCredits, llmMeteredPricing } from "./config.js"
import { supabase } from "./supabase.js"
import { insertSyncJob } from "./insert-job.js"
import { markJobFailed } from "./job-failure.js"
import { sendInternalError } from "./http-errors.js"
import { completeSettledSyncJob } from "./metered-sync-completion.js"
import { meterSyncLlm } from "./sync-llm-meter.js"
import { markProviderCallStart, markProviderCallStartIfLive } from "./reconcile/persistence.js"
import { METERED_SWEEP_MAX_ATTEMPTS, bumpMeteredSweepAttempts, meteredBilledConfirmed } from "./reconcile/metered-sweep-attempts.js"
import type { LlmRequest } from "./llm/types.js"
import type { CreditReservation } from "../middleware/credit-guard.js"

export type { LlmAttemptSpend } from "./llm/types.js"

/** A credit feature that bills metered (`ee/billing/llm-typical-usage.ts`). Type-only: erased at build. */
export type MeteredLlmFeature = import("../ee/billing/llm-typical-usage.js").MeteredLlmFeature

/** One call a metered feature makes for certain, as it will be sent — what its 1-attempt hold is sized from. */
export interface LlmPlannedCall {
  modelId: string
  request: LlmRequest
  /** Length of EACH video / audio block, when known (`llmHoldBaseCredits`). */
  mediaSeconds?: number
  cheapLanesOnly?: boolean
}

/**
 * What {@link reserveLlmCall} did:
 *  - `{ metered: true, … }` — the hold is in place under `chargeId`;
 *  - `{ metered: false }` — metering is off (rollback, or no credits): the
 *    caller reserves its tier id exactly as before;
 *  - `undefined` — a reply was already sent (a refusal, a dedup hit), as with
 *    `reserveCreditsForJob`: the caller returns at once (R2).
 */
export type LlmReserveResult =
  | { metered: true; reservation: CreditReservation; chargeId: string; holdCredits: number }
  | { metered: false }
  | undefined

/** The ledger's server-only column and its read/write helpers live in `./llm-billing-ledger.ts`. */
export {
  LLM_BILLING_LEDGER_COLUMN,
  isLlmBillingLedger,
  llmBillingLedgerBilled,
  readLlmBillingLedger,
  readLlmBillingLedgerAndCost,
  readLlmBillingLedgers,
  writeLlmBillingLedger,
  type LlmBillingLedger,
  type LlmBillingLedgerWrite,
} from "./llm-billing-ledger.js"

/** The spend ledger and its cost rules live in the leaf `./llm-spend.ts` (no billing entry point is loaded to read a row's spend). */
export { LlmSpend, llmAttemptCostUsd, type LlmBillingRecord } from "./llm-spend.js"
import { LlmSpend } from "./llm-spend.js"

// ── Cloud entry points (dynamic import of the ee impl) ──

let implPromise: Promise<typeof import("../ee/billing/llm-billing-impl.js")> | null = null
function loadImpl(): Promise<typeof import("../ee/billing/llm-billing-impl.js")> {
  return (implPromise ??= import("../ee/billing/llm-billing-impl.js"))
}

/**
 * Reserve a metered LLM job's hold: Σ one attempt of each planned call
 * (`llmHoldBaseCredits`), marked up at `llmChargeId(feature, calls[0].modelId)`,
 * through `reserveCreditsForJob(…, { holdCredits })`. A model with no price on
 * its lane is refused `400 validation_error / llm_model_unpriced` and the job
 * row it was given is deleted; a balance below the hold is refused `402
 * insufficient_credits` ("Needs up to N credits"). Under the rollback, or
 * without credits: `{ metered: false }`, nothing reserved.
 */
export async function reserveLlmCall(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  args: { feature: MeteredLlmFeature; calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]] },
): Promise<LlmReserveResult> {
  if (!llmMeteredPricing()) return { metered: false }
  return (await loadImpl()).reserveLlmCallImpl(req, reply, jobId, args)
}

/**
 * The guard pre-check for a metered route (`creditGuard(…, { computeCredits })`):
 * the 1-attempt hold, in BASE credits, of the body's model with `bodyChars` of
 * text — a UX pre-check only; `reserveLlmCall`'s hold is what is reserved.
 * Throws `LlmUnpricedModelError` for a model with no price on its lane (the
 * guard answers it `400 llm_model_unpriced`). `undefined` under the rollback,
 * so the route's tier row prices the check exactly as before.
 *
 * ASYNC (not the brief's sync `number`): the hold math is Cloud code in
 * `ee/billing/`, which core reaches only through a dynamic `import()`.
 */
export async function llmPrecheckBaseCredits(
  feature: MeteredLlmFeature,
  body: { llmModel?: string; reasoningEffort?: string; advancedMode?: boolean; maxTokens?: number },
  bodyChars: number,
): Promise<number | undefined> {
  if (!llmMeteredPricing()) return undefined
  return (await loadImpl()).llmPrecheckBaseCreditsImpl(feature, body, bodyChars)
}

/**
 * What a settle did:
 *  - `charged` — a CONFIRMED commit: `charged` is the receipt's figure
 *    (`commit_credits_metered`), the job's `credits_actual` (R13). A call whose
 *    cost could not be computed is charged its hold this way too;
 *  - `refunded` — nothing was billed;
 *  - `not-metered` — a tier reservation (or no credits): not settled here;
 *  - `unsettled` — no confirmed commit (an RPC failure, no receipt, an
 *    unreadable hold): nothing is claimed, the hold stays reserved, and the
 *    caller leaves the job non-terminal for the reconcile sweep, which charges
 *    a billed metered hold whole (R20) and refunds an unbilled one.
 * There is no "charged without a receipt": a commit that cannot be confirmed
 * is `unsettled`, never success — with ONE exception, which is confirmation
 * of another kind: a usage log ALREADY committed by an earlier settle (a
 * worker re-run after a confirmed settle, whose own commit the RPC refuses)
 * is `charged` at the log's recorded `credits_charged`, which stands in for
 * the receipt; anything this settle would have added beyond it is logged as
 * an `uncollected_overrun` anomaly (`ee/billing/llm-billing-impl.ts`).
 */
export type LlmSettleOutcome =
  | { outcome: "charged"; charged: number; shortfall: number }
  | { outcome: "refunded" }
  | { outcome: "not-metered" }
  | { outcome: "unsettled" }

/**
 * Settle a metered job from its reservation (C2): refund when nothing was
 * billed; otherwise charge `computeActualCredits(max(costUsd,
 * CREDIT_BASE_USD), chargeId)` through `commitCredits(…, { collectOverHold:
 * true })`, set `jobs.credits_actual` to what was charged (R13: the receipt's
 * `charged`), and record `jobs.provider_cost` + the server-only ledger
 * column `jobs.llm_billing` (never `output_data`, which users can read).
 * An overrun is normal (D1) and logs no anomaly; the RPC logs a true
 * shortfall. A billed call whose cost cannot be computed (no rate on the lane
 * that served it, a non-finite figure) commits its hold WHOLE and alerts —
 * never a refund.
 *
 * `unsettled` = the commit failed or was not confirmed: nothing is claimed as
 * charged and the hold stays reserved for the reconcile sweep (C3). The sweep
 * only finds a job that is still `pending`/`processing` WITH
 * `provider_call_started_at` set, so a caller that settles a SYNCHRONOUS job
 * itself must, in this order:
 *  1. stamp `markProviderCallStart(jobId, "anthropic-sync")` once the hold is
 *     reserved (a worker-run job already carries its worker's stamp);
 *  2. settle BEFORE writing the job's terminal status;
 *  3. on `unsettled`, leave the row non-terminal — the sweep fails it and
 *     settles the hold (40 min, `lib/reconcile/types.ts`).
 * `meterSyncLlmMetered` does exactly this.
 */
export async function settleLlmJob(jobId: string, reserve: LlmReserveResult, spend: LlmSpend): Promise<LlmSettleOutcome> {
  if (!reserve || !reserve.metered || !hasCredits()) return { outcome: "not-metered" }
  return (await loadImpl()).settleLlmUsageLogImpl(reserve.reservation.usageLogId, jobId, reserve.chargeId, spend, reserve.holdCredits)
}

/** {@link settleLlmJob} for a worker that holds only the usage-log id and the charge id. */
export async function settleLlmUsageLog(usageLogId: string, jobId: string, chargeId: string, spend: LlmSpend): Promise<LlmSettleOutcome> {
  if (!hasCredits()) return { outcome: "not-metered" }
  return (await loadImpl()).settleLlmUsageLogImpl(usageLogId, jobId, chargeId, spend)
}

/**
 * R38: stamp a SYNCHRONOUS LLM route's call start, immediately before the call.
 *
 * Metered: a CAS on the live statuses (`markProviderCallStartIfLive`). A job
 * cancelled between the route's reserve and this stamp is never sent the call —
 * the cancel found no stamp and refunded (or will refund) the hold, so a call
 * made now would run free. On a miss nothing is sent: the hold is released
 * through the normal settle (an empty spend → refunded), the route is answered
 * (409 when cancelled; 503 when the stamp could not be written, the row then
 * failed) and `false` is returned — the caller returns at once.
 *
 * A tier hold (the rollback, or no credits): today's unconditional stamp,
 * byte-identical, always `true`.
 */
export async function stampSyncLlmCallStart(jobId: string, reserve: LlmReserveResult, reply: FastifyReply): Promise<boolean> {
  if (!reserve || !reserve.metered) {
    await markProviderCallStart(jobId, "anthropic-sync")
    return true
  }
  const started = await markProviderCallStartIfLive(jobId, "anthropic-sync")
  if (started === "started") return true
  console.warn(`[llm-billing] job ${jobId}: ${started === "not-live" ? "cancelled before its call started" : "its call's start could not be recorded"} — the call is not sent; its hold is released`)
  try {
    await settleLlmJob(jobId, reserve, new LlmSpend())
  } catch (err) {
    console.error(`[llm-billing] job ${jobId}: releasing the hold of a call never sent failed — left to the reconcile sweep:`, err)
  }
  if (started === "error") await markJobFailed(jobId, { error_message: "The request could not be started — nothing was charged. Please retry." })
  if (!reply.sent) {
    reply.status(started === "not-live" ? 409 : 503).send({
      error: started === "not-live"
        ? { code: "job_cancelled", message: "The job was cancelled before its call started — nothing was charged." }
        : { code: "job_start_failed", message: "The request could not be started — nothing was charged. Please retry." },
    })
  }
  return false
}

/**
 * For the reconcile sweep (R59 / R60 / D10), run BEFORE the job's terminal flip:
 *  - `not-metered` — no metered hold, or a metered job that confirmedly
 *    billed nothing and whose call never started (and always without
 *    credits): refund exactly as before;
 *  - `settled` — every billed metered hold is committed and confirmed — at
 *    its ACTUAL from the row's ledger (R59), the hold whole only at the D10
 *    cap or when the row's spend cannot be priced: fail the job, refund any
 *    other hold;
 *  - `retry` — not settled (an error, no receipt, or a call that started with
 *    no billed figure recorded, R60): the job's attempts were bumped and it
 *    stays sweepable; do NOT fail or refund it this tick.
 * Keyed off the reservation, not the rollback switch: a job reserved metered
 * settles metered. An error is a `retry`, never a refund.
 */
export async function settleSweptMeteredLlmJob(
  job: {
    id: string
    reconcile_attempts: number
    /** The row's `reconcile_last_error`: an earlier tick's billed marker (`METERED_BILLED_MARKER`). */
    reconcile_last_error?: string | null
  },
  /** The statuses its row writes may touch (default the live sweep's); the cancelled-hold sweep passes `cancelled` (R38). */
  opts: { statuses?: readonly string[] } = {},
): Promise<"not-metered" | "settled" | "retry"> {
  if (!hasCredits()) return "not-metered"
  try {
    return await (await loadImpl()).settleSweptMeteredLlmJobImpl(job, opts)
  } catch (err) {
    // The verdict could not be reached (the implementation did not load, a
    // read threw): retry, and BUMP the counter so the cap still arrives. At the
    // cap nothing was confirmed metered + billed, so today's fail + refund.
    // A job an earlier tick confirmed metered + billed is NEVER refunded here.
    const attempt = job.reconcile_attempts + 1
    const billed = meteredBilledConfirmed(job.reconcile_last_error)
    if (attempt >= METERED_SWEEP_MAX_ATTEMPTS && !billed) {
      console.error(`[llm-billing] ALERT: sweep settle of job ${job.id} threw at attempt ${attempt} — falling back to fail + refund:`, err)
      return "not-metered"
    }
    console.error(`[llm-billing] sweep settle of job ${job.id} threw — retrying next tick (attempt ${attempt}, billed ${billed}):`, err)
    await bumpMeteredSweepAttempts(job.id, attempt, `settle threw: ${err instanceof Error ? err.message : String(err)}`, billed, opts.statuses)
    return "retry"
  }
}

/**
 * Meter a SYNCHRONOUS LLM helper route (D3): creates the audit `jobs` row,
 * reserves the metered hold, and hands back the {@link LlmSpend} to `add`
 * every call to, and `settle` — call it exactly once, on success or failure
 * (a billed failure is charged, an unbilled one refunded).
 *
 * Returns null when a reply has already been sent (job insert failed, a
 * refusal) — the caller returns at once. Under the rollback it is today's
 * `meterSyncLlm` at `prompt-helper`, byte-identical (`settle("completed")` =
 * `commit()`, `settle("failed")` = `refund()`; the spend is not read).
 *
 * P14: a route that calls this reserves in-request — the default payer-aware
 * creditGuard, never `checkOnly` (RESERVE_MARKERS in
 * `ee/lib/__tests__/check-only-credit-guard.test.ts`).
 */
export async function meterSyncLlmMetered(
  req: FastifyRequest,
  reply: FastifyReply,
  jobType: string,
  args: { feature: MeteredLlmFeature; calls: readonly [LlmPlannedCall, ...LlmPlannedCall[]] },
): Promise<{ spend: LlmSpend; settle: (status: "completed" | "failed", errorMessage?: string) => Promise<void> } | null> {
  const spend = new LlmSpend()
  if (!llmMeteredPricing()) {
    const meter = await meterSyncLlm(req, reply, jobType, "prompt-helper")
    if (!meter) return null
    return { spend, settle: (status) => (status === "completed" ? meter.commit() : meter.refund()) }
  }

  if (!req.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  const { data: job, error: jobError } = await insertSyncJob(req, {
    user_id: req.userId,
    status: "pending",
    input_data: { type: jobType },
    job_type: jobType,
  })
  if (jobError || !job) {
    sendInternalError(reply, req, jobError, "Failed to create job")
    return null
  }
  const reserve = await reserveLlmCall(req, reply, job.id, args)
  if (reply.sent || !reserve) return null
  // The reconcile sweep's anchor (C3): a job left non-terminal with a reserved
  // hold is found, failed and settled by it after the sync threshold. A CAS
  // (R38): a job cancelled since its reserve is never sent the call.
  if (!(await stampSyncLlmCallStart(job.id, reserve, reply))) return null

  return {
    spend,
    settle: async (status, errorMessage) => {
      // Settle FIRST: an unsettled hold leaves the row non-terminal for the sweep.
      const settled = await settleLlmJob(job.id, reserve, spend)
      if (settled.outcome === "unsettled") return
      if (status === "completed") {
        await completeSettledSyncJob(job.id)
      } else {
        await markJobFailed(job.id, { error_message: errorMessage ?? "The request could not be completed." })
      }
    },
  }
}
