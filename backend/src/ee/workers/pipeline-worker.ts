/**
 * Pipeline orchestration BullMQ worker (Phase 1A).
 *
 * Consumes the `pipeline-orchestration` queue (one job per pipeline run,
 * dedup'd via `jobId` from `queue.ts`) and drives the stage state machine
 * via `drivePipeline`. The engine is the only thing that mutates pipeline
 * status; this file is purely transport (subscribe → invoke → log).
 *
 * Concurrency: a flat `PIPELINE_WORKER_CONCURRENCY` (default 5). Phase 1A
 * uses a single ceiling for the whole worker; per-user tier-based limits
 * (spec §5.4) layer on top in a later phase.
 *
 * Started as a separate process by `backend/src/pipeline-worker.ts` (the
 * Cloud edition entry point); not invoked from `server.ts`.
 */

import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { PIPELINE_HARD_TIMEOUT_MS } from "@nodaro/shared"
import { drivePipeline } from "../pipelines/engine.js"
import { pipelineOrchestrationQueue, type PipelineOrchestrationJobData } from "../pipelines/queue.js"
import { resumeActiveOrchestrators } from "../pipelines/resume.js"

const CONCURRENCY = Number(process.env.PIPELINE_WORKER_CONCURRENCY ?? "5")

export function startPipelineWorker(): Worker<PipelineOrchestrationJobData> {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  const worker = new Worker<PipelineOrchestrationJobData>(
    "pipeline-orchestration",
    async (job) => {
      const { pipelineId } = job.data
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), PIPELINE_HARD_TIMEOUT_MS)
      try {
        await drivePipeline({ supabase, pipelineId })
      } finally {
        clearTimeout(timer)
      }
    },
    { connection, concurrency: CONCURRENCY, lockDuration: 3_600_000, stalledInterval: 900_000 },
  )

  worker.on("failed", (job, err) => {
    // Log; pipelines.failure_reason already records detail.
    console.error(`[pipeline-worker] job ${job?.id} failed:`, err.message)
  })

  worker.on("completed", (job) => {
    console.log(`[pipeline-worker] job ${job.id} completed (pipeline ${job.data.pipelineId})`)
  })

  // Phase 1B.4 — on boot, scan for active orchestrator jobs whose driver
  // died mid-run (deploy / Railway rolling restart / crash) and re-attach
  // them. Fire-and-forget — failures are logged but must not block the
  // worker from accepting new jobs.
  void (async () => {
    try {
      const result = await resumeActiveOrchestrators(supabase, pipelineOrchestrationQueue)
      console.log(
        `[pipeline-worker] boot resume: ${result.resumed} resumed, ${result.failed} failed (resume_limit_exceeded)`,
      )
    } catch (err) {
      console.error(
        "[pipeline-worker] boot resume scan failed:",
        err instanceof Error ? err.message : err,
      )
    }
  })()

  return worker
}
