/**
 * Settling a copilot turn whose process died.
 *
 * The generic sync sweep marks the job failed and REFUNDS — correct for a
 * provider call that never happened, wrong here: the turn's model spend is
 * real and already persisted per iteration on `copilot_turns.cost_usd`. So
 * this handler commits the metered actual when anything was spent, refunds
 * only when nothing was, and settles the turn row so the thread is not
 * wedged on a stale `running` turn.
 */
import { supabase } from "../../lib/supabase.js"
import { refundReservedCreditsForJob } from "../../lib/credits-job-lifecycle.js"
import { commitJobCredits } from "../../workers/shared.js"

export interface StaleCopilotJob {
  id: string
  reconcile_attempts: number
}

export async function reconcileCopilotTurn(job: StaleCopilotJob): Promise<void> {
  const { data: turnRow } = await supabase
    .from("copilot_turns")
    .select("id, thread_id, cost_usd, status")
    .eq("job_id", job.id)
    .maybeSingle()
  const turn = turnRow as { id: string; thread_id: string; cost_usd: number | null; status: string } | null
  const spentUsd = turn?.cost_usd ?? 0

  const { data: updated } = await supabase
    .from("jobs")
    .update({
      status: spentUsd > 0 ? "completed" : "failed",
      error_message: spentUsd > 0 ? null : "The copilot turn ended before it could answer. Nothing was charged.",
      completed_at: new Date().toISOString(),
      reconcile_attempts: job.reconcile_attempts + 1,
      reconcile_last_error: "copilot_turn_settled",
    })
    .eq("id", job.id)
    .in("status", ["pending", "processing"])
    .select("id, usage_log_id")

  const row = (updated ?? [])[0] as { id: string; usage_log_id: string | null } | undefined
  if (!row) return // a live handler already settled it

  if (spentUsd > 0) {
    // Metered: charge what the model actually cost, capped by the reservation.
    await commitJobCredits(row.usage_log_id, job.id, spentUsd, 0, true, true)
  } else {
    await refundReservedCreditsForJob(job.id)
  }

  if (turn && turn.status === "running") {
    await supabase
      .from("copilot_turns")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: "turn_abandoned",
      })
      .eq("id", turn.id)
      .eq("status", "running")
  }
}
