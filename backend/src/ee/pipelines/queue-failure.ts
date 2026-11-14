// backend/src/ee/pipelines/queue-failure.ts — a pipeline that waited for a run
// slot and never ran (concurrency lanes): its queue timeout, or its place in
// line lost with nothing to add it again from; or a new pipeline whose first
// drive the queue refused (`settleUnqueuedPipeline`). Fails it the way a
// pipeline fails (failPipelineWithCriticReason's shape) — the stages flipped,
// the pipeline flipped, the SSE events published, the reservation refunded
// last — except that the pipeline's flip is a CAS from `queued`, its waiting
// status: a worker that admitted it meanwhile drives it, and nothing here
// touches it.
import type { SupabaseClient } from "@supabase/supabase-js"
import type { PipelineStageName } from "@nodaro/shared/pipeline"
import { pipelineEvents } from "./events.js"
import { insertAppReport } from "../../lib/app-reports.js"

/** Stage statuses a pipeline that never ran can hold open. */
const OPEN_STAGE_STATUSES = ["pending", "running"]

/** The app report filed when a failed waiting pipeline's reservation could not be confirmed refunded (`app_reports.kind`). */
export const UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND = "unqueued-pipeline-refund-unconfirmed"

/** How many times the refund is sent before it is reported as unconfirmed. */
const CONFIRMED_REFUND_ATTEMPTS = 2

/**
 * Whether the pipeline's reservation is still held: true, false (the link is
 * cleared, or the usage log it names is no longer `reserved`), or null when a
 * read fails. Never throws.
 */
async function reservationStillHeld(supabase: SupabaseClient, pipelineId: string): Promise<boolean | null> {
  try {
    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .select("reservation_usage_log_id")
      .eq("id", pipelineId)
      .maybeSingle()
    if (error) return null
    const usageLogId = (pipeline as { reservation_usage_log_id?: string | null } | null)?.reservation_usage_log_id
    if (!usageLogId) return false
    const { data: log, error: logError } = await supabase.from("usage_logs").select("status").eq("id", usageLogId).maybeSingle()
    if (logError) return null
    return (log as { status?: string } | null)?.status === "reserved"
  } catch {
    return null
  }
}

/**
 * Refund the reservation of a pipeline that was just failed, and confirm it
 * with a read: `refundPipelineCredits` swallows an RPC error and returns on a
 * read error, so its silence proves nothing. The refund is sent again once
 * (it is idempotent). A failed pipeline is revisited by no sweep (the cron
 * reads only `running` / `stopping`, the queued sweep only `queued`;
 * scripts/cleanup-stuck-pipelines.ts is a one-shot operator script for
 * `running` ones), so a reservation still unconfirmed after the retries is
 * logged and filed as an app report for an operator. Never throws.
 */
async function refundWaitingPipelineConfirmed(args: {
  supabase: SupabaseClient
  userId: string
  pipelineId: string
  reason: string
}): Promise<void> {
  const { supabase, userId, pipelineId, reason } = args
  try {
    const { refundPipelineCredits } = await import("./credits.js")
    for (let attempt = 0; attempt < CONFIRMED_REFUND_ATTEMPTS; attempt++) {
      try {
        await refundPipelineCredits({ supabase, userId, pipelineId, reason })
      } catch (err) {
        console.error(`[pipelines] could not refund waiting pipeline ${pipelineId} after its ${reason}:`, err)
      }
      if ((await reservationStillHeld(supabase, pipelineId)) === false) return
    }
    console.error(
      `[pipelines] the reservation of pipeline ${pipelineId} could not be confirmed refunded after its ${reason}: it may still be held`,
    )
    await insertAppReport({
      node: "queue-failure",
      kind: UNQUEUED_PIPELINE_REFUND_UNCONFIRMED_KIND,
      severity: "error",
      title: `Pipeline ${pipelineId}'s reservation could not be confirmed refunded`,
      payload: {
        pipelineId,
        reason,
        message:
          "The pipeline was failed without running, but a read after the refund still found its reservation held or " +
          "could not be made. No sweep revisits a failed pipeline: check the reservation and refund it if it is held.",
      },
      userId,
    })
  } catch (err) {
    console.error(`[pipelines] could not settle the refund of waiting pipeline ${pipelineId} after its ${reason}:`, err)
  }
}

/**
 * Fail a waiting pipeline with `reason` (`queue_timeout` / `queue_lost` /
 * `queue_refused`). True when this call failed it; false when it no longer
 * waited (nothing was written). Throws when the pipeline's own write fails;
 * once that write won, what follows never throws. Its reservation is
 * refunded and confirmed ({@link refundWaitingPipelineConfirmed}); one that
 * cannot be confirmed is filed as an app report.
 */
export async function failWaitingPipeline(args: {
  supabase: SupabaseClient
  pipelineId: string
  /** The pipeline's owner, for the refund; none: no refund. */
  userId: string | null
  reason: "queue_timeout" | "queue_lost" | "queue_refused"
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
  if (userId) await refundWaitingPipelineConfirmed({ supabase, userId, pipelineId, reason })
  return true
}

/** The app report filed when a pipeline whose first drive the queue refused could not be confirmed failed (`app_reports.kind`). */
export const UNQUEUED_PIPELINE_UNSETTLED_KIND = "unqueued-pipeline-unsettled"

/** What became of a new pipeline whose first drive the queue refused. */
export type UnqueuedPipelineOutcome = "failed" | "moved-on" | "unsettled"

/**
 * A new pipeline whose first drive the queue refused (createPipeline, after
 * its reservation): nothing else would ever end it — the reconcile cron reads
 * only `running` / `stopping` pipelines and the queued sweep only those a run
 * lane parked — so it would sit `queued` holding its reservation. Failed here
 * at once from `queued` with failure reason `queue_refused`, its reservation
 * refunded last ({@link failWaitingPipeline}): "failed". No longer `queued`:
 * the add was delivered after all (a closed connection lost only its answer)
 * and a drive claimed it, so it runs: "moved-on" (a drive that finds it
 * failed claims nothing). The failure write failed: "unsettled", logged and
 * filed as an app report, since the pipeline may still be `queued` with its
 * reservation held. Never throws.
 */
export async function settleUnqueuedPipeline(args: {
  supabase: SupabaseClient
  pipelineId: string
  userId: string
  /** The queue's error, for the log. */
  err: unknown
}): Promise<UnqueuedPipelineOutcome> {
  const { supabase, pipelineId, userId, err } = args
  try {
    const failed = await failWaitingPipeline({ supabase, pipelineId, userId, reason: "queue_refused" })
    if (failed) {
      console.error(`[pipelines] the queue refused pipeline ${pipelineId}'s first drive: failed and refunded`, err)
      return "failed"
    }
    console.warn(`[pipelines] the queue refused pipeline ${pipelineId}'s first drive, which has since moved on — answered as started`, err)
    return "moved-on"
  } catch (failErr) {
    console.error(
      `[pipelines] pipeline ${pipelineId}'s first drive was refused and its failure could not be written: it may be queued with its reservation held`,
      failErr,
    )
    await insertAppReport({
      node: "create-pipeline",
      kind: UNQUEUED_PIPELINE_UNSETTLED_KIND,
      severity: "error",
      title: `Pipeline ${pipelineId} the queue refused could not be confirmed failed`,
      payload: {
        pipelineId,
        message:
          "The queue refused the pipeline's first drive and its failure write failed. If it is still queued, " +
          "no sweep ends it: fail it and refund its reservation.",
      },
      userId,
    })
    return "unsettled"
  }
}
