import type { FastifyReply, FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { reserveCreditsForJob } from "../middleware/credit-guard.js"

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
 */
export async function meterSyncLlm(
  req: FastifyRequest,
  reply: FastifyReply,
  jobType: string,
  creditIdentifier: string,
): Promise<SyncLlmMeter | null> {
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({ user_id: req.userId, status: "pending", input_data: { type: jobType } })
    .select("id")
    .single()
  if (jobError || !job) {
    reply.status(500).send({ error: { code: "internal_error", message: jobError?.message ?? "Failed to create job" } })
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
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", job.id)
      if (credits && usageLogId) await credits.commitCredits(usageLogId)
    },
    refund: async () => {
      await supabase.from("jobs").update({ status: "failed" }).eq("id", job.id)
      if (credits && usageLogId) await credits.refundCredits(usageLogId)
    },
  }
}
