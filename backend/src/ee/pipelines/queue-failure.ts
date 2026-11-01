// backend/src/ee/pipelines/queue-failure.ts — a pipeline that waited for a run
// slot and never ran (concurrency lanes): its queue timeout, or its place in
// line lost with nothing to add it again from. Fails it the way a pipeline
// fails (failPipelineWithCriticReason's shape) — the stages flipped, the
// pipeline flipped, the SSE events published, the reservation refunded last —
// except that the pipeline's flip is a CAS from `queued`, its waiting status: a
// worker that admitted it meanwhile drives it, and nothing here touches it.
import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStageName } from "@nodaro/shared/pipeline"
import { pipelineEvents } from "./events.js"

/** Stage statuses a pipeline that never ran can hold open. */
const OPEN_STAGE_STATUSES = ["pending", "running"]

/**
 * Fail a waiting pipeline with `reason` (`queue_timeout` / `queue_lost`).
 * True when this call failed it; false when it no longer waited (nothing was
 * written). Throws when the pipeline's own write fails; once that write won,
 * what follows never throws (a refund that fails is the cleanup cron's).
 */
export async function failWaitingPipeline(args: {
  supabase: SupabaseClient
  pipelineId: string
  /** The pipeline's owner, for the refund; none: no refund. */
  userId: string | null
  reason: "queue_timeout" | "queue_lost"
}): Promise<boolean> {
  const { supabase, pipelineId, userId, reason } = args
  const { data, error } = await supabase
    .from("pipelines")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", pipelineId)
    .eq("status", "queued")
    .select("id")
  if (error) throw new Error(`could not fail waiting pipeline ${pipelineId}: ${error.message}`)
  if (!Array.isArray(data) || data.length === 0) return false

  try {
    // A pipeline that never ran has no open stage, unless one was seeded before its first drive.
    const { data: stages } = await supabase
      .from("pipeline_stages")
      .update({ status: "failed", output: { failure_reason: reason }, completed_at: new Date().toISOString() })
      .eq("pipeline_id", pipelineId)
      .in("status", OPEN_STAGE_STATUSES)
      .select("stage_name")
    pipelineEvents.publish({ type: "pipeline:status", pipelineId, status: "failed" })
    for (const stage of (stages ?? []) as Array<{ stage_name?: unknown }>) {
      if (typeof stage.stage_name === "string") {
        pipelineEvents.publish({ type: "stage:status", pipelineId, stageName: stage.stage_name as PipelineStageName, status: "failed" })
      }
    }
  } catch (err) {
    console.warn(`[pipelines] could not settle the stages of waiting pipeline ${pipelineId}: ${(err as Error)?.message ?? String(err)}`)
  }

  // Refund last, as every pipeline failure does: the terminal state is already written.
  if (userId) {
    try {
      const { refundPipelineCredits } = await import("./credits.js")
      await refundPipelineCredits({ supabase, userId, pipelineId, reason })
    } catch (err) {
      console.error(`[pipelines] could not refund waiting pipeline ${pipelineId} after its ${reason}:`, err)
    }
  }
  return true
}
