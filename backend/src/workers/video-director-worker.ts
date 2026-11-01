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

import { Worker, type ConnectionOptions, type Job } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { markJobCompleted } from "./shared.js"
import { markJobFailed } from "../lib/job-failure.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../lib/credits-job-lifecycle.js"
import type { BrandTokens } from "@nodaro/prompts/presets"
import type { FastifyInstance } from "fastify"
import { runUnderRunAdmission } from "../lib/concurrency-lanes/run-admit.js"
import { LANE_READD_PREFIX, pickupStatusesFor, WORKER_ROW_COLUMNS, workerRowOf } from "../lib/concurrency-lanes/worker-admit.js"
import { registerLaneParking } from "../lib/concurrency-lanes/park.js"
import { serverShare } from "../lib/concurrency-lanes/server-share.js"
import { dropRequeuePayload } from "../lib/concurrency-lanes/columns.js"

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
  /** Optional brand — a preset name (string) OR inline brand tokens. Passed
   *  through to the orchestrator, which resolves it once via resolveBrandInput.
   *  (BrandTokens lives in @nodaro/shared, not ee/, so typing it precisely here
   *  does not couple this core worker to enterprise code.) */
  brand?: string | BrandTokens
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
  pickup?: { bullJobId: string | null | undefined; rowStatus: string | null },
): Promise<void> {
  const { jobId, genre, brief, userId, tier, brand } = payload

  // THE PICKUP CLAIM (a worker pickup passes `pickup`): `pending`, `queued`
  // or a re-picked `processing` row → `processing`, a compare-and-set — a row
  // cancelled or ended while it waited (or before its entry was picked up)
  // never runs; an entry the lanes' sweep added again after Redis lost it
  // (`lane-readd-<jobId>`) claims only from `queued`, so a live entry that
  // already started the job is never run twice. Outside the try: a row that
  // is not ours to run is not ours to fail or refund. A claim the database
  // could not answer falls back to the plain write below, as before — except
  // for a re-added entry, which is discarded.
  let claimed = false
  if (pickup) {
    const { data, error } = (await supabase
      .from("jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", jobId)
      .in("status", pickupStatusesFor(pickup.bullJobId))
      .select("id")) ?? {}
    if (!error) {
      if (!Array.isArray(data) || data.length === 0) {
        console.warn(`[video-director] Job ${jobId} not in a runnable state at pickup (cancelled/ended while queued) — discarding`)
        return
      }
      claimed = true
    } else if (typeof pickup.bullJobId === "string" && pickup.bullJobId.startsWith(LANE_READD_PREFIX)) {
      // A re-added entry never runs unchecked: a live entry may have started the job already.
      console.warn(`[video-director] Job ${jobId}: the claim of a re-added entry failed (${error.message ?? error.code}) — discarding`)
      return
    }
  }
  // A job that waited (parked as `queued`) runs now: the payload it was parked with is not needed any more. Best effort.
  if (pickup?.rowStatus === "queued") void dropRequeuePayload(jobId)

  try {
    // Mark the job as processing so the MCP progress widget shows activity.
    // Inside the try so a throw here (e.g., supabase error) routes to the catch
    // (refund path) instead of leaving the row uncovered.
    if (!claimed) {
      await supabase
        .from("jobs")
        .update({ status: "processing", started_at: new Date().toISOString() })
        .eq("id", jobId)
    }

    // Dynamic import respects the core → ee boundary.
    // The tool check (tools/check-ee-imports.mjs) only flags *static*
    // import/export declarations — dynamic import() calls are exempt.
    const { runVideoDirector, defaultDirectorDeps } = await import(
      "../ee/video-director/orchestrate.js"
    )

    // Its children are marked as the director's: they enter their lanes ahead of jobs not yet started.
    const deps = defaultDirectorDeps(app, { directorJobId: jobId })

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
        // Passed through as-is; runVideoDirector resolves it via resolveBrandInput.
        brand,
      },
      { ...deps, onProgress },
    )

    // Through the ONE completion funnel (spec §5.3). This was a bare
    // `update({status:"completed"})` with no status predicate: it could trample
    // a row the user had just cancelled, and it published a video the result
    // gate never saw. `markJobCompleted` supplies status/progress/completed_at
    // and CASes on live statuses.
    //
    // Deliberately NO `createAssetFromJob`: the URL is the child RENDER job's
    // object and that job already created its library row — a second one would
    // duplicate the entry.
    const completed = await markJobCompleted(jobId, {
      output_data: { videoUrl: result.videoUrl },
    })
    if (!completed) {
      // The user cancelled, a terminal writer won, or a registered policy
      // blocked/held the output. In each case the credits belong to whoever
      // wrote that outcome — commit nothing here.
      console.log(`[video-director] Job ${jobId} not completed by us (cancelled, or a policy outcome) — no commit`)
      return
    }

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

    // Settle credits BEFORE the terminal status write. The ONLY backstop for a
    // stranded video-director credit is the reconcile sweep
    // (sweepStuckOrchestratorJobs in lib/reconcile/cron.ts), which re-scans
    // 'processing' rows only. If we marked the row 'failed' first and the refund
    // then threw, the reserved authoring credit would strand with no backstop.
    // Refunding first means a refund failure leaves the row 'processing' for the
    // sweep to retry; refund is idempotent (CAS-on-reserved) so the sweep's own
    // refund is a safe no-op if this one already succeeded. (Unlike
    // pipeline-final-merge.ts, which is covered by the main
    // provider_call_started_at scan, this queue calls no provider directly.)
    // NOTE: refundReservedCreditsForJob swallows its own business-logic failures
    // (bad RPC result / lost CAS race / no reserved log) and returns 0 — so the
    // inner catch below only fires on a raw transport exception (a network blip
    // on the usage_logs read or the refund RPC call). `markJobFailed` never
    // throws by contract, so the status write can no longer be the thing that
    // lands here; the try still wraps it because the ORDER is what matters.
    try {
      await refundReservedCreditsForJob(jobId)
      // Gains a CAS it never had (spec §9): the bare update could trample a
      // `cancelled` row, and — with the widened vocabulary — a `pending_review`
      // one. The returned boolean is not read: this worker refunds FIRST, on
      // purpose, so there is no post-write decision left to gate.
      await markJobFailed(jobId, { error_message: errMsg })
    } catch (settleErr) {
      // Do NOT rethrow — leave the row 'processing' for the reconcile sweep.
      // Rethrowing would surface as the bullJob result and (if attempts were
      // ever raised above 1) re-run the whole author→…→render chain and
      // double-charge the sub-jobs.
      console.error(
        `[video-director] Job ${jobId} failure-settle errored; left 'processing' for reconcile sweep:`,
        settleErr instanceof Error ? settleErr.message : String(settleErr),
      )
    }
  }
}

/** The director's worker pool: each run ties up TTS + alignment + render for minutes. */
export const VIDEO_DIRECTOR_CONCURRENCY = 2

/**
 * The director queue's pickup (exported for tests): read the row, take the
 * run's slot (lib/concurrency-lanes/run-admit.ts — a top-level director takes
 * one of its user's run lane, after its share of this server's director
 * pool; a re-picked `processing` row is re-admitted at once), then run the
 * director under that hold. A refused director is parked as `queued`
 * (DelayedError, no attempt spent). With enforcement off nothing is refused.
 */
export async function runVideoDirectorPickup(
  bullJob: Pick<Job, "id" | "name" | "data" | "opts" | "attemptsMade" | "moveToDelayed" | "promote">,
  token: string | undefined,
  app: FastifyInstance,
): Promise<void> {
  const payload = bullJob.data as VideoDirectorJobPayload
  let rowData: Record<string, unknown> | null = null
  // A row that is not there (deleted with its account) is gone: no admission,
  // and the claim below finds nothing to run. Only a read that FAILED admits
  // the director on its payload's line, as a fresh job.
  let gone = false
  try {
    const { data, error } = (await supabase.from("jobs").select(WORKER_ROW_COLUMNS).eq("id", payload.jobId).maybeSingle()) ?? {}
    rowData = (data ?? null) as Record<string, unknown> | null
    gone = !error && rowData === null
  } catch {
    // Admitted on the payload's line, as a fresh job.
  }
  const row = gone ? null : workerRowOf(payload.jobId, rowData, payload.userId)
  await runUnderRunAdmission({ job: bullJob, token, queue: "video-director", row }, () =>
    processVideoDirectorJob(payload, app, { bullJobId: bullJob.id, rowStatus: typeof rowData?.status === "string" ? rowData.status : null }),
  )
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

  // A director its run lane refuses at pickup is parked (its row `queued`) and
  // woken by its reserved slot (lib/concurrency-lanes/park.ts). With enforcement off nothing is refused.
  registerLaneParking()
  // No user holds more than a quarter of this pool (server-share.ts): 1 of its 2 workers.
  serverShare("director", VIDEO_DIRECTOR_CONCURRENCY)

  return new Worker(
    "video-director",
    async (bullJob, token) => {
      await runVideoDirectorPickup(bullJob, token, app)
    },
    {
      connection: connection as unknown as ConnectionOptions,
      // Low concurrency: each run ties up TTS + alignment + render resources
      // for ~3 minutes; running more than 2 in parallel would saturate the
      // KIE / ElevenLabs / Remotion budgets on a single worker process.
      concurrency: VIDEO_DIRECTOR_CONCURRENCY,
      // Lock duration covers worst-case author + speech + alignment + render
      // pipeline time: 3 min × generous safety margin = 20 min.
      lockDuration: 1_200_000,
    },
  )
}
