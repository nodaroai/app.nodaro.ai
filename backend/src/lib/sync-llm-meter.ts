// @registry-enumerates commits or refunds the one usage log its route reserved through CreditsService — a credit id, not a node type, so not a @registry-lookup (moved verbatim from meter-sync-llm.ts)
/**
 * The tier-priced meter of a SYNCHRONOUS LLM-helper route ({@link meterSyncLlm}):
 * re-exported by `./meter-sync-llm.ts`. A leaf of its own so `./llm-billing.ts`
 * (whose `meterSyncLlmMetered` IS this under the rollback) reads it without
 * loading the metered sync helpers, which load the billing shim.
 */
import type { FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { insertSyncJob } from "./insert-job.js"
import { markJobFailed } from "./job-failure.js"
import { sendInternalError } from "./http-errors.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"
import { completedJobColumns } from "./job-status.js"

export interface SyncLlmMeter {
  /** Mark the job completed + commit the reserved credits. */
  commit: () => Promise<void>
  /** Mark the job failed + refund the reserved credits. */
  refund: () => Promise<void>
}

/**
 * Meter a SYNCHRONOUS LLM-helper route — one inline `llmComplete` round-trip, NOT
 * a BullMQ-dispatched job. Creates an audit `jobs` row, reserves credits, and
 * returns `commit()` / `refund()` to finalize. The caller MUST call exactly one
 * (commit on success, refund on every failure) — for a sync route there is no
 * worker failure-net or reconcile sweep, so an un-refunded reservation leaks.
 *
 * Mirrors the inline pattern in `llm-suggest-description.ts` so the recaption /
 * caption helpers bill at the shared `prompt-helper` rate instead of being an
 * uncapped free Claude proxy. Credits are no-ops in non-cloud editions
 * (`reserveCreditsForJob` returns no `usageLogId`), so this stays correct in
 * Community/Business. Loads the ee CreditsService lazily (core stays ee-clean).
 *
 * Returns `null` when the reservation could not proceed (job-insert error or
 * insufficient credits) — a reply has already been sent, so the caller must
 * `return` immediately.
 *
 * METERED PRICING (D3): the helper routes bill through `meterSyncLlmMetered`
 * (`lib/llm-billing.ts`), which IS this function under the rollback — so this
 * stays the rollback path, byte-identical. New callers use the metered twin.
 *
 * P14 NOTE: a route that calls this DOES reserve in-request — it must take
 * the default (payer-aware) creditGuard, never `checkOnly: true`. The
 * check-only scanner (`ee/lib/__tests__/check-only-credit-guard.test.ts`)
 * recognizes this wrapper by name — and its metered twins, `reserveLlmCall(`
 * and `meterSyncLlmMetered(` (`lib/llm-billing.ts`); if you write another
 * reserve-on-behalf wrapper, add it to that test's RESERVE_MARKERS.
 */
export async function meterSyncLlm(
  req: FastifyRequest,
  reply: FastifyReply,
  jobType: string,
  creditIdentifier: string,
): Promise<SyncLlmMeter | null> {
  const { data: job, error: jobError } = await insertSyncJob(req, {
    user_id: req.userId,
    status: "pending",
    input_data: { type: jobType },
    job_type: jobType,
  })
  if (jobError || !job) {
    // sendInternalError leads with `jobBlockOf`, so a request-gate BLOCK
    // answers the documented 422 `job_blocked` with the policy's own message
    // rather than a 500 every SDK consumer retries with backoff (F10). It also
    // stops the raw DB message reaching the client on a genuine failure. The
    // `return null` stays load-bearing: every caller bails on null.
    sendInternalError(reply, req, jobError, "Failed to create job")
    return null
  }

  const reservation = await reserveCreditsForJob(req, reply, job.id, creditIdentifier)
  if (reply.sent) return null
  const usageLogId = reservation?.usageLogId
  const credits = usageLogId ? (await import("../ee/services/credits.js")).CreditsService : null

  return {
    commit: async () => {
      await supabase
        .from("jobs")
        .update({ status: "completed", ...completedJobColumns() })
        .eq("id", job.id)
      if (credits && usageLogId) await credits.commitCredits(usageLogId)
    },
    refund: async () => {
      // Was `update({status:"failed"})` and nothing else: no CAS, and no
      // `error_message` at all — which is precisely the row the app-report
      // sweep files as "no error message recorded". The message is generic
      // because this wrapper never sees the caller's error.
      await markJobFailed(job.id, { error_message: "The request could not be completed." })
      if (credits && usageLogId) await credits.refundCredits(usageLogId)
    },
  }
}
