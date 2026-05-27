/**
 * Pipeline orchestration queue (Phase 1A).
 *
 * One BullMQ queue per pipeline lifecycle; the driver lives in
 * `backend/src/ee/workers/pipeline-worker.ts`. Per-pipeline dedup is
 * enforced via the deterministic `jobId` below so resume/approve/reject
 * cannot enqueue concurrent drives for the same pipeline.
 */

import { Queue } from "bullmq"
import IORedis from "ioredis"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
})

export interface PipelineOrchestrationJobData {
  pipelineId: string
  userId: string
  reason: "initial" | "resume" | "user_reject" | "stage_advance" | "branched" | "mode_switch"
}

export const pipelineOrchestrationQueue = new Queue<PipelineOrchestrationJobData>(
  "pipeline-orchestration",
  { connection },
)

export async function enqueuePipelineRun(data: PipelineOrchestrationJobData): Promise<void> {
  // Redrive latch (migration 158): stamp BEFORE the add() below so a worker
  // already mid-drive will loop and pick this request up even when the add() is
  // deduped away (jobId already `active`). That dropped add is the lost wake-up
  // that silently stalls a pipeline at status='running'; the latch closes it
  // (driveWithRedriveLatch in redrive-latch.ts clears + re-checks per drive).
  // Best-effort: a latch-write failure must not block the (more important)
  // enqueue itself, and the no-active-drive case still works via the add() alone.
  try {
    await supabase
      .from("pipelines")
      .update({ pending_redrive_at: new Date().toISOString() })
      .eq("id", data.pipelineId)
  } catch (err) {
    console.error(
      `[pipelines/queue] failed to stamp redrive latch for ${data.pipelineId}:`,
      err instanceof Error ? err.message : err,
    )
  }

  // Dedup: at most one in-flight job per pipeline. BullMQ treats `add()` with
  // an existing jobId as a no-op REGARDLESS of state (waiting / active /
  // completed / failed). Therefore `removeOnComplete: true` + `removeOnFail:
  // true` are REQUIRED — without them, the first dispatch's job stays in the
  // completed set indefinitely and every subsequent approve/reject/branch
  // re-enqueue is silently discarded, freezing the pipeline at
  // `awaiting_approval`. `:` is reserved as BullMQ's internal Redis key
  // separator, so the jobId uses '-'.
  await pipelineOrchestrationQueue.add("run", data, {
    jobId: `pipeline-${data.pipelineId}`,
    removeOnComplete: true,
    removeOnFail: true,
    attempts: 1, // engine handles resume semantics itself
  })
}
