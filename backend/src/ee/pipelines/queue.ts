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

const connection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
})

export interface PipelineOrchestrationJobData {
  pipelineId: string
  userId: string
  reason: "initial" | "resume" | "user_reject" | "stage_advance" | "branched"
}

export const pipelineOrchestrationQueue = new Queue<PipelineOrchestrationJobData>(
  "pipeline-orchestration",
  { connection },
)

export async function enqueuePipelineRun(data: PipelineOrchestrationJobData): Promise<void> {
  await pipelineOrchestrationQueue.add("run", data, {
    jobId: `pipeline:${data.pipelineId}`, // dedup: at most one job per pipeline at a time
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 1, // engine handles resume semantics itself
  })
}
