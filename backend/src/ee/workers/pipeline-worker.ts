/**
 * Pipeline orchestration BullMQ worker (Phase 1A).
 *
 * Consumes the `pipeline-orchestration` queue (one job per pipeline run,
 * dedup'd via `jobId` from `queue.ts`) and drives the stage state machine
 * via `drivePipeline`. The engine is the only thing that mutates pipeline
 * status; this file is purely transport (subscribe → invoke → log).
 *
 * Concurrency: a flat `PIPELINE_WORKER_CONCURRENCY` (default 5). A pipeline
 * that was never driven takes a slot of its payer's run lane at pickup, and no
 * user holds more than a quarter of the pool (lib/concurrency-lanes/).
 *
 * Started as a separate process by `backend/src/pipeline-worker.ts` (the
 * Cloud edition entry point), or in the API process when
 * PIPELINE_WORKER_INPROCESS=true (server.ts).
 */

import { Worker, type Job } from "bullmq"
import IORedis from "ioredis"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { PIPELINE_HARD_TIMEOUT_MS } from "@nodaro/shared/pipeline"
import { drivePipeline } from "../pipelines/engine.js"
import { driveWithRedriveLatch } from "../pipelines/redrive-latch.js"
import { pipelineEvents } from "../pipelines/events.js"
import { pipelineContext } from "../pipelines/pipeline-context.js"
import { pipelineOrchestrationQueue, type PipelineOrchestrationJobData } from "../pipelines/queue.js"
import { resumeActiveOrchestrators } from "../pipelines/resume.js"
import { loadPrivatePlugins } from "../../lib/private-plugins/load.js"
import { getPipelineBillingContext } from "../pipelines/pipeline-payer.js"
import type { BillingContext } from "../../lib/billing-context.js"
import { readPipelineWorkerRow, runUnderRunAdmission, type RunBullJob } from "../../lib/concurrency-lanes/run-admit.js"
import { registerLaneParking } from "../../lib/concurrency-lanes/park.js"
import { serverShare } from "../../lib/concurrency-lanes/server-share.js"

// S9 P0 fix — this worker never called loadPrivatePlugins() before, so every
// pipeline stage (runShowrunner, runSceneDirector, the critic suite, all 8
// helpers) would call getPipelinePrompt() against an EMPTY registry and throw
// PipelinePromptUnavailableError on every run, in every correctly-configured
// cloud deployment. `startPipelineWorker()` is invoked exactly once, from
// `backend/src/pipeline-worker.ts`'s `main()`, via a dynamic
// `import("./ee/workers/pipeline-worker.js")` — that dynamic import fully
// evaluates this module's top level (including this awaited call) BEFORE the
// import promise resolves, so by the time the caller can even reach
// `startPipelineWorker()`, prompts are already registered. Mirrors
// `workers/video-worker.ts`'s top-level-await pattern exactly (no `app` — this
// process has no Fastify instance; only the side effect of registering
// prompts into ee/pipelines/llms/prompt-registry.ts matters here, so the
// return value is intentionally discarded).
await loadPrivatePlugins({})

const CONCURRENCY = Number(process.env.PIPELINE_WORKER_CONCURRENCY ?? "5")

/**
 * The BullMQ job as the pipeline's admission reads it: its payload with the
 * pipeline's own payer (pipelines.config.billingContext, the row's stamp), so
 * a workspace's pipeline waits in the workspace's line. A payer that cannot be
 * read is the creator's (degraded personal, getPipelineBillingContext's rule).
 */
async function pipelinePayerOf(job: Job<PipelineOrchestrationJobData>): Promise<BillingContext | undefined> {
  try {
    return await getPipelineBillingContext(supabase, job.data.pipelineId, job.data.userId)
  } catch {
    return undefined
  }
}

function withPipelinePayer(job: Job<PipelineOrchestrationJobData>, billingContext: BillingContext | undefined): RunBullJob {
  return {
    id: job.id,
    name: job.name,
    data: billingContext ? { ...job.data, billingContext } : job.data,
    opts: job.opts,
    attemptsMade: job.attemptsMade,
    moveToDelayed: (timestamp: number, token?: string) => job.moveToDelayed(timestamp, token),
    promote: () => job.promote(),
  }
}

/** One drive of a pipeline (the worker's processor, under its admission). */
async function drive(job: Job<PipelineOrchestrationJobData>): Promise<void> {
  const { pipelineId } = job.data
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PIPELINE_HARD_TIMEOUT_MS)

  // Hard-interrupt on user cancel. The API's POST /v1/pipelines/:id/cancel
  // route publishes `pipeline:status cancelled` to pipelineEvents, which
  // the cross-process Redis bridge (PR #2770) forwards into this
  // process's local emitter. Subscribing here aborts the in-flight
  // LLM call so we don't burn 1-3 min of Showrunner / image-critic
  // compute after the user already gave up.
  //
  // Per-job subscription (not module-level) so concurrent jobs each
  // have their own AbortController and one cancel doesn't ripple
  // across unrelated pipelines.
  const unsubscribeCancel = pipelineEvents.subscribe(pipelineId, (event) => {
    if (event.type === "pipeline:status" && event.status === "cancelled") {
      console.log(
        `[pipeline-worker] cancel signal received for ${pipelineId} — aborting in-flight LLM calls`,
      )
      ctrl.abort()
    }
  })

  try {
    // Run inside the pipeline context so downstream LLM callers
    // (callLLM, future fetch wrappers, etc.) can pluck the signal
    // via getPipelineSignal() without explicit threading.
    await pipelineContext.run({ signal: ctrl.signal, pipelineId }, async () => {
      // Drive inside the redrive latch so a re-enqueue dropped by the BullMQ
      // jobId dedup (one that arrived while this drive was active) is
      // coalesced into one more drive instead of being lost — the pipeline
      // lost wake-up. See redrive-latch.ts + migration 158.
      await driveWithRedriveLatch(supabase, pipelineId, () =>
        drivePipeline({ supabase, pipelineId }),
      )
    })
  } catch (err) {
    // Distinguish user-cancel aborts from real failures. AbortError
    // bubbles up from Anthropic SDK / fetch when ctrl.abort() fires.
    // The cancel route already flipped the DB rows + emitted the
    // user-facing event, so we exit cleanly and let BullMQ mark the
    // job COMPLETED (not failed → no retry).
    if (ctrl.signal.aborted) {
      console.log(
        `[pipeline-worker] job ${job.id} exited cleanly after cancel (pipeline ${pipelineId})`,
      )
      return
    }
    throw err
  } finally {
    clearTimeout(timer)
    unsubscribeCancel()
  }
}

export function startPipelineWorker(): Worker<PipelineOrchestrationJobData> {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  // A pipeline its run lane refuses at pickup is parked (still `queued`) and
  // woken by its reserved slot (lib/concurrency-lanes/park.ts). With enforcement off nothing is refused.
  registerLaneParking()
  // No user holds more than a quarter of this pool (server-share.ts): 1 of the default 5.
  serverShare("pipeline", CONCURRENCY)

  const worker = new Worker<PipelineOrchestrationJobData>(
    "pipeline-orchestration",
    async (job, token) => {
      // CONCURRENCY LANES (lib/concurrency-lanes/run-admit.ts): a pipeline
      // never driven (`queued`) takes a slot of its payer's run lane, after its
      // share of this server's pool; a later drive (the next stage, a resume)
      // is re-admitted at once. A refused pipeline stays `queued` and is parked
      // (DelayedError, no attempt spent). The drive runs under the run's hold.
      // With enforcement off nothing is refused: every drive starts at once.
      // The pipeline's payer, read once: its line in the payload, and its
      // workspace pair on the admission row that bears the payload out.
      const payer = await pipelinePayerOf(job)
      await runUnderRunAdmission(
        {
          job: withPipelinePayer(job, payer),
          token,
          queue: "pipeline-orchestration",
          row: await readPipelineWorkerRow(job.data.pipelineId, job.data.userId, payer),
        },
        () => drive(job),
      )
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
