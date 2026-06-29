/**
 * Video-director BullMQ worker (Task 5 — Unit D′).
 *
 * Consumes the "video-director" queue; drives the full director chain
 * (author → speech → forced-alignment → bake → render) by dynamically
 * loading runVideoDirector + defaultDirectorDeps from ee/.
 *
 * Core → ee boundary: ALL ee imports are dynamic (inside the job handler)
 * so this file stays in core and passes tools/check-ee-imports.mjs.
 * Mirrors the shim pattern in workers/shared.ts.
 */

import { Worker, type ConnectionOptions } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../lib/credits-job-lifecycle.js"
import type { FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Job payload
// ---------------------------------------------------------------------------

/**
 * Payload enqueued by the MCP one-shot verbs (create_explainer, etc.)
 *
 * `genre` is kept as `string` here (not VideoGenre) to avoid a static
 * import from ee/. The runtime value is always a valid VideoGenre —
 * "explainer" | "product-launch" — validated by the enqueueing route.
 */
export interface VideoDirectorJobPayload {
  jobId: string
  genre: string
  brief: string
  userId: string
  tier: string
}

// ---------------------------------------------------------------------------
// Progress mapping
// ---------------------------------------------------------------------------

const STEP_PROGRESS: Record<string, number> = {
  authoring: 10,
  speech: 30,
  alignment: 50,
  resolve: 70,
  render: 80,
}

// ---------------------------------------------------------------------------
// Job-processing function (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Process one video-director job.
 *
 * Exported separately from createVideoDirectorWorker so tests can exercise
 * the logic without spinning up a real BullMQ Worker connection.
 *
 * @param payload  Job data from the BullMQ queue.
 * @param app      Fastify app instance — passed to defaultDirectorDeps so
 *                 internal route calls (TTS, alignment, render) can use
 *                 fastify.inject() with the internal-orchestrator-secret header.
 */
export async function processVideoDirectorJob(
  payload: VideoDirectorJobPayload,
  app: FastifyInstance,
): Promise<void> {
  const { jobId, genre, brief, userId, tier } = payload

  try {
    // Mark the job as processing so the MCP progress widget shows activity.
    // Inside the try so a throw here (e.g., supabase error) routes to the catch
    // (refund path) instead of leaving the row uncovered.
    await supabase
      .from("jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", jobId)

    // Dynamic import respects the core → ee boundary.
    // The tool check (tools/check-ee-imports.mjs) only flags *static*
    // import/export declarations — dynamic import() calls are exempt.
    const { runVideoDirector, defaultDirectorDeps } = await import(
      "../ee/video-director/orchestrate.js"
    )

    const deps = defaultDirectorDeps(app)

    // Progress callback: write each pipeline step's progress to the jobs row
    // so the MCP progress widget and the frontend can track the chain in real time.
    const onProgress = async (step: string) => {
      const progress = STEP_PROGRESS[step] ?? 50
      console.log(`[video-director] Job ${jobId} step: ${step} (${progress}%)`)
      await supabase
        .from("jobs")
        .update({ progress, status: "processing" })
        .eq("id", jobId)
    }

    // genre is "explainer" | "product-launch" at runtime — typed as string
    // in the payload to avoid a static ee/ import (VideoGenre lives in ee/).
    // The cast via Parameters<typeof runVideoDirector> is safe: the value is
    // always a valid genre at the enqueue site.
    const result = await runVideoDirector(
      {
        genre: genre as Parameters<typeof runVideoDirector>[0]["genre"],
        brief,
        userId,
        tier,
      },
      { ...deps, onProgress },
    )

    await supabase
      .from("jobs")
      .update({
        status: "completed",
        progress: 100,
        output_data: { videoUrl: result.videoUrl },
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)

    // Commit the reserved authoring credit now that the chain delivered a
    // video. jobId-keyed CAS-on-reserved (idempotent); dynamic-loads ee/ so
    // this worker stays core-clean (check-ee-imports). Sub-jobs (TTS,
    // alignment, render) reserve/commit/refund their OWN credits via their
    // own routes — this commit only settles the director authoring reservation.
    await commitReservedCreditsForJob(jobId)

    console.log(`[video-director] Job ${jobId} completed: ${result.videoUrl}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[video-director] Job ${jobId} failed:`, errMsg)

    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: errMsg,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)

    // Refund the reserved authoring credit — the chain did not deliver. No-ops
    // if nothing is left in `reserved` (already committed/refunded). Mirrors
    // the catch path in ee/pipelines/services/pipeline-final-merge.ts.
    await refundReservedCreditsForJob(jobId)
  }
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Create and return a BullMQ Worker that consumes the "video-director" queue.
 *
 * @param app  Fastify app instance forwarded to processVideoDirectorJob
 *             (and onward to defaultDirectorDeps for fastify.inject calls).
 */
export function createVideoDirectorWorker(app: FastifyInstance): Worker {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-director",
    async (bullJob) => {
      await processVideoDirectorJob(bullJob.data as VideoDirectorJobPayload, app)
    },
    {
      connection: connection as unknown as ConnectionOptions,
      // Low concurrency: each run ties up TTS + alignment + render resources
      // for ~3 minutes; running more than 2 in parallel would saturate the
      // KIE / ElevenLabs / Remotion budgets on a single worker process.
      concurrency: 2,
      // Lock duration covers worst-case author + speech + alignment + render
      // pipeline time: 3 min × generous safety margin = 20 min.
      lockDuration: 1_200_000,
    },
  )
}
