import { estimateLoopTrimAddonCredits } from "@nodaro/shared"
import { supabase } from "../supabase.js"

/**
 * Reconcile recovery uploads the provider's RAW image-to-video output and
 * commits the reserved tier — but it NEVER runs the smart-loop-cut post-process
 * the worker would have. So a SINGLE-NODE i2v job with `loopTrim.enabled`,
 * recovered via the reconcile cron, would charge the loop-trim add-on for a trim
 * that never ran.
 *
 * Mirror the worker's trim-FAILURE path (workers/handlers/video-ai.ts): refund
 * the add-on by re-committing at (reserved - addon). MUST be called BEFORE
 * finalizeJobWithMedia — commitCredits is CAS-once on status='reserved', so THIS
 * commit wins and finalize's later commit is a no-op, exactly as in the worker.
 *
 * IMPORTANT — only the SINGLE-NODE path reserves the add-on (via creditGuard's
 * `computeCredits` hook). The ORCHESTRATED path reserves base-only (payload-builder
 * adds no loop-trim addon), so there is nothing to refund for orchestrated jobs —
 * refunding there would UNDER-charge by the addon. We detect the run mode via
 * `jobs.workflow_execution_id` (set ⇔ orchestrated) and skip those.
 *
 * The reservation's usage_log id is the canonical `jobs.usage_log_id` column
 * (NOT input_data — nothing ever writes it there; that was the original dead-code
 * bug). Idempotent (refundLoopTrimAddon stamps usage_logs.metadata.loop_trim_refunded)
 * and a no-op when not i2v / loopTrim disabled / orchestrated / no reserved log.
 */
export async function refundLoopTrimAddonOnReconcile(
  jobType: string | null,
  jobId: string,
  inputData: Record<string, unknown> | null,
): Promise<void> {
  if (jobType !== "image-to-video" || !inputData) return
  const loopTrim = inputData.loopTrim as
    | { enabled?: boolean; framesToTest?: number }
    | undefined
  if (!loopTrim?.enabled) return
  const duration = typeof inputData.duration === "number" ? inputData.duration : 8
  const addon = estimateLoopTrimAddonCredits(loopTrim, duration)
  if (addon <= 0) return

  // Resolve the reservation link + detect the run mode in one read.
  const { data: job } = await supabase
    .from("jobs")
    .select("workflow_execution_id, usage_log_id")
    .eq("id", jobId)
    .maybeSingle()
  if (!job) return
  // Orchestrated jobs reserve base-only → no addon was charged → nothing to refund
  // (refunding would under-charge). Only the single-node path reserved the addon.
  if (job.workflow_execution_id) return
  const usageLogId =
    typeof job.usage_log_id === "string" ? job.usage_log_id : undefined
  if (!usageLogId) return

  // Lazy import keeps the heavy workers/shared dependency graph out of the
  // reconcile module load; only pulled in the rare crash ∩ loop-trim recovery.
  const { refundLoopTrimAddon } = await import("../../workers/shared.js")
  await refundLoopTrimAddon(jobId, usageLogId, addon)
}
