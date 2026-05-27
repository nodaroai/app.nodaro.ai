import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Max redrive-latch iterations per worker job. Each iteration is a full drive,
 * so this only bites if re-drive requests arrive faster than drives complete —
 * a runaway guard, not a normal-path limit. On exhaustion we leave the latch set
 * so the next enqueue (or the reconcile-cron backstop) picks it up.
 */
export const MAX_REDRIVE_LOOPS = 25

/**
 * Wraps a pipeline drive in the redrive latch (migration 158:
 * `pipelines.pending_redrive_at`).
 *
 * The lost wake-up: `enqueuePipelineRun` dedupes on a deterministic BullMQ jobId,
 * so a re-drive requested while a drive is already `active` is silently dropped by
 * `add()`; once the active drive finishes, nothing re-triggers the pipeline and it
 * stalls at `status='running'` with no error. `enqueuePipelineRun` now also stamps
 * `pending_redrive_at` before `add()`; here we clear that latch BEFORE each drive
 * (the drive we're about to run covers every request stamped so far) and loop if a
 * newer stamp lands mid-drive — coalescing the dropped `add()` into exactly one
 * more drive instead of losing it.
 *
 * Residual: a request landing between the final latch read and BullMQ removing the
 * completed job can't be made atomic with job removal — the guarded reconcile cron
 * is the backstop for that rare window.
 *
 * `drive` is injected (rather than importing `drivePipeline` directly) so this
 * module stays free of the engine's heavy import graph and the loop is unit-testable.
 */
export async function driveWithRedriveLatch(
  supabase: SupabaseClient,
  pipelineId: string,
  drive: () => Promise<void>,
): Promise<void> {
  for (let i = 0; i < MAX_REDRIVE_LOOPS; i++) {
    // Claim everything stamped so far: clear the latch, then drive.
    await supabase.from("pipelines").update({ pending_redrive_at: null }).eq("id", pipelineId)

    await drive()

    // A request stamped AFTER the clear re-sets the latch → run one more drive.
    const { data } = await supabase
      .from("pipelines")
      .select("pending_redrive_at")
      .eq("id", pipelineId)
      .maybeSingle()
    if (!data || !(data as { pending_redrive_at?: string | null }).pending_redrive_at) return
  }

  console.warn(
    `[pipelines/redrive-latch] hit MAX_REDRIVE_LOOPS (${MAX_REDRIVE_LOOPS}) for ${pipelineId}; leaving latch set for cron/next enqueue`,
  )
}
