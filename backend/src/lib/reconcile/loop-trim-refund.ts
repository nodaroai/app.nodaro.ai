import { estimateLoopTrimAddonCredits } from "@nodaro/shared"

/**
 * Compute the loop-trim add-on credits a reconcile recovery must take OFF the
 * commit. PURE — no DB access, no commit.
 *
 * Why: reconcile recovery uploads the provider's RAW image-to-video output and
 * never runs the smart-loop-cut post-process, so a SINGLE-NODE i2v job with
 * `loopTrim.enabled` would otherwise be charged for a trim that never ran.
 *
 * History (audit P0.3 / M3): the predecessor `refundLoopTrimAddonOnReconcile`
 * COMMITTED the usage_log at (reserved − addon) BEFORE finalize. That flipped
 * the log out of `reserved`, so when finalize then failed persistently and the
 * job exhausted, `forceFailExhausted`'s reserved-only refund silently no-oped
 * — user charged for a failed job, anomaly note claiming otherwise. The addon
 * is now applied INSIDE `finalizeJobWithMedia`, after `markJobCompleted` wins
 * (see `FinalizeInput.loopTrimAddonRefundCredits`), which also owns the
 * remaining gates that need the jobs row:
 *  - orchestrated jobs (workflow_execution_id set) reserve base-only — the
 *    addon was never charged, so deducting it would UNDER-charge;
 *  - no reserved usage_log → nothing to adjust.
 */
export function loopTrimAddonForReconcile(
  jobType: string | null,
  inputData: Record<string, unknown> | null,
): number {
  if (jobType !== "image-to-video" || !inputData) return 0
  const loopTrim = inputData.loopTrim as
    | { enabled?: boolean; framesToTest?: number }
    | undefined
  if (!loopTrim?.enabled) return 0
  const duration = typeof inputData.duration === "number" ? inputData.duration : 8
  return estimateLoopTrimAddonCredits(loopTrim, duration)
}
