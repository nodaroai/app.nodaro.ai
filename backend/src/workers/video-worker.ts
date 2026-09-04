import { Worker, DelayedError, UnrecoverableError, type ConnectionOptions } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { initProviders, watchProviderCredentials } from "../providers/index.js"
import { KieError } from "../providers/kie/client.js"
import { runWithJobCancellation, JobCancelledError } from "../lib/job-cancellation.js"
// NOTE: imported from their CORE modules, not re-exported through ./shared.js —
// the test harness mocks shared.js wholesale and would undefine them.
import { isPostProcessingError } from "../lib/post-processing-error.js"
import { providerDetailOf } from "../lib/provider-error-detail.js"
import { markJobFailed } from "../lib/job-failure.js"
import { isReconcileRecoverable } from "../lib/reconcile/types.js"
import { DrainAbortError } from "../lib/worker-drain.js"
import {
  safetyBlockOf,
  errorHintFor,
  safetyBlockMessage,
  fallbackLabelOf,
} from "../lib/safety-block.js"
import { resolveIsPublicOutput, mcpClientForcesPrivate } from "./output-visibility.js"
import { isPromptBlocked } from "../config/content-filter.js"
import { refundJobCredits, createAssetFromJob, isFinalJobAttempt, type HandlerFn, type JobContext } from "./shared.js"
import { imageAIHandlers } from "./handlers/image-ai.js"
import { videoAIHandlers } from "./handlers/video-ai.js"
import { videoSfxHandlers } from "./handlers/video-sfx.js"
import { ffmpegHandlers } from "./handlers/ffmpeg.js"
import { audioAIHandlers } from "./handlers/audio-ai.js"
import { sunoHandlers } from "./handlers/suno.js"
import { entityHandlers } from "./handlers/entity.js"
import { createSurroundHandlers } from "./handlers/surround.js"
import { referenceSheetHandlers } from "./handlers/reference-sheet.js"
import { motionGraphicsLottieHandlers } from "./handlers/motion-graphics-lottie.js"
import { llmStructuredHandlers } from "./handlers/llm-structured.js"
import { buildStatsKey, upsertExecutionStats } from "../services/execution-stats.js"
import { tryInlineReconcile } from "./inline-reconcile.js"
import { loadPrivatePlugins } from "../lib/private-plugins/load.js"

/** How far back into the queue a drain-interrupted job is moved (ms) — a
 *  moment, not a park: Railway brings the replacement container up BEFORE
 *  draining this one, so a worker is already listening. See the DrainAbortError
 *  branch below. */
const DRAIN_REQUEUE_DELAY_MS = 2_000

const allHandlers: Record<string, HandlerFn> = {
  ...imageAIHandlers,
  ...videoAIHandlers,
  ...videoSfxHandlers,
  ...ffmpegHandlers,
  ...audioAIHandlers,
  ...sunoHandlers,
  ...entityHandlers,
  ...referenceSheetHandlers,
  ...motionGraphicsLottieHandlers,
  ...llmStructuredHandlers,
  // video-analysis handler moved to @nodaroai/cloud-plugins — it arrives via
  // `privatePluginHandlers` (loadPrivatePlugins below), keyed "video-analysis".
}

// Merge in cloud-only proprietary handlers (e.g. voice-changer-pro) from the
// private @nodaroai/cloud-plugins package BEFORE the worker below starts
// consuming jobs. No `app` is passed — this process has no Fastify instance,
// only queue handlers. No-op on community/business; on cloud, a load failure
// is fatal (process.exit(1) inside the loader) unless PRIVATE_MODULES=optional.
//
// `engines.surround` (S8) is constructed into the surround-continuation
// handler here too — it's not a "plugin handler" (the plugin never registers
// a queue-job entry for it), it's an additive engine capability the CORE
// `createSurroundHandlers` factory calls into. Must come from THIS await
// (module-load-time construction is no longer possible — see
// `handlers/surround.ts`'s header comment), so it's built here rather than
// alongside the other static `...xHandlers` spreads above.
// 4b: the exclusive-node RELAY handlers, self-hosted editions only. Merged
// BEFORE privatePluginHandlers so that on cloud (where the loader returns
// real handlers) the plugin implementations win the keys unconditionally —
// on community the plugin map is empty and the relay serves the five types.
if (!hasCredits()) {
  const { nodaroExclusiveRelayHandlers } = await import("./handlers/nodaro-exclusive-relay.js")
  Object.assign(allHandlers, nodaroExclusiveRelayHandlers)
}
const { handlers: privatePluginHandlers, engines } = await loadPrivatePlugins({})
Object.assign(allHandlers, createSurroundHandlers(engines.surround))
Object.assign(allHandlers, privatePluginHandlers)
// `engines.smartCut` (2026-07-24): the combine-videos boundary matcher —
// the cut-point algorithms moved private, so `combineVideos` (and the
// gvp/evp stitches that reach it through the plugin toolkit, which run in
// THIS process) resolve the matcher via the smart-cut registry. Absent
// (community/business, or plugin-version lag): the registry stays null and
// combine degrades to fixed trims.
if (engines.smartCut) {
  const { registerSmartCutMatcher } = await import("../providers/video/smart-cut.js")
  registerSmartCutMatcher((prevPath, nextPath, framesFromPrev, framesFromNext, mode) =>
    engines.smartCut!.findBoundary(prevPath, nextPath, framesFromPrev, framesFromNext, mode))
}

export function createVideoWorker() {
  initProviders()
  // Operator-supplied keys (pasted on /setup, stored encrypted): load them
  // now — registering whatever they unlock — and re-read on the TTL so a key
  // saved by the API process reaches this worker without a restart.
  watchProviderCredentials()

  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-generation",
    async (job, token) => {
      const { jobId } = job.data as { jobId: string }

      // Fetch job record (with should_watermark from reservation) + user profile for public_outputs.
      // `provider_task_id` + `provider_kind` + `reconcile_attempts` + `job_type`
      // are fetched to (a) detect a BullMQ stall-retry, and (b) immediately
      // recover the row via the same handler the reconcile cron uses.
      const { data: jobRecord } = await supabase
        .from("jobs")
        .select("usage_log_id, user_id, should_watermark, force_private, mcp_client, workflow_execution_id, provider_task_id, provider_kind, reconcile_attempts, job_type, input_data, profiles!user_id(public_outputs)")
        .eq("id", jobId)
        .single()

      // Stall-retry guard + inline recovery. If `provider_task_id` is set, the
      // upstream call already ran on a prior worker that died (Railway redeploy,
      // OOM, etc.) and BullMQ retried this job. We MUST NOT call createTask
      // again (that would duplicate-bill the provider).
      //
      // The old behavior here was `return` ("wait for the reconcile cron"),
      // which meant the row sat in `processing` for up to <threshold> + <cron
      // cadence> minutes — 30 min for kie-suno, longer for VEO/lip-sync. For
      // operations that complete in 1-5 min upstream that's a terrible UX.
      //
      // The new behavior: dispatch the exact same per-provider reconcile
      // handler the cron uses, inline, right now. Recovery happens within
      // ~5 min of worker death (BullMQ's stall-detect cadence) instead of
      // 30+ min. All reconcile handlers are idempotent (finalize is CAS-guarded;
      // bumpAttempts is safe to repeat), so the cron remains the safety net if
      // this inline pass throws or KIE is still processing.
      if (jobRecord?.provider_task_id) {
        await tryInlineReconcile({
          id: jobId,
          provider_kind: (jobRecord.provider_kind as string | null) ?? null,
          provider_task_id: jobRecord.provider_task_id as string,
          reconcile_attempts: (jobRecord.reconcile_attempts as number | null) ?? 0,
          job_type: (jobRecord.job_type as string | null) ?? null,
          input_data: (jobRecord.input_data as Record<string, unknown> | null) ?? null,
        })
        return
      }

      const usageLogId = jobRecord?.usage_log_id
      const jobUserId = (jobRecord?.user_id as string) ?? undefined

      // Use watermark decision from reservation time (C4 fix: prevents bypass via tier upgrade)
      const shouldWatermark = hasCredits() ? (jobRecord?.should_watermark ?? false) : false

      // Output visibility (is_public) — the shared decision lives in
      // output-visibility.ts so this worker and render-worker can't drift, with
      // the deployment surface switch (B1) as the OUTERMOST gate. Worker-local
      // signals (blocked prompt) fold into forcePrivate; the parent
      // workflow_execution's mcp flag needs an async lookup, so it stays inline
      // and is ANDed after (and short-circuits when the output is already private).
      let publicPref = true
      if (jobUserId && jobRecord?.profiles) {
        const profile = jobRecord.profiles as unknown as { public_outputs?: boolean }
        publicPref = profile?.public_outputs ?? true
      }
      const jobData = job.data as Record<string, unknown>
      const promptText = (jobData.prompt as string) ?? (jobData.text as string) ?? null
      let isPublicOutput = resolveIsPublicOutput({
        publicOutputs: publicPref,
        // uploaded/private input content, or a blocked prompt
        forcePrivate: jobRecord?.force_private === true || isPromptBlocked(promptText),
        // direct MCP generation (Claude.ai / Cursor) — a private surface.
        // jobs.mcp_client is a TEXT client name, never a boolean — `=== true`
        // was always false and leaked direct-MCP output to the public gallery.
        mcpClient: mcpClientForcesPrivate(jobRecord?.mcp_client),
        workflowExecutionId: null,
      })
      // Workflow / app run: the parent workflow_execution carries `mcp_client`;
      // per-node child jobs don't (the orchestrator's internal per-node calls
      // never see the MCP header). Look up the parent only if still public.
      if (isPublicOutput && jobRecord?.workflow_execution_id) {
        const { data: parent } = await supabase
          .from("workflow_executions")
          .select("mcp_client")
          .eq("id", jobRecord.workflow_execution_id as string)
          .maybeSingle()
        if (parent?.mcp_client) {
          isPublicOutput = false
        }
      }

      const ctx: JobContext = { jobId, jobUserId, usageLogId, shouldWatermark }
      // The model this job runs under (the i2i variant id for referenced image
      // requests). Read once: both the inline safety retry and the final failure
      // path key their policy off it.
      const modelId =
        (job.data as { provider?: string; model?: string }).model ??
        (job.data as { provider?: string }).provider ??
        null
      let safetyRetried = false

      try {
        // `provider_kind="pre-task"` + `provider_call_started_at=now` make
        // this row visible to the reconcile cron BEFORE the handler fires
        // its first `onTaskCreated`. If the handler crashes between this
        // UPDATE and createKieTask (R2 download OOM, unhandled rejection in
        // preprocessing, segfault, etc.), the sync-sweep marks failed +
        // refunds reserved credits at the 30-min threshold. The real handler
        // overwrites both fields via `makeOnTaskCreated` once it has a
        // taskId, so the pre-task sentinel survives only on crash.
        const nowIso = new Date().toISOString()
        // A1 (audit 2026-06-10): CAS on live statuses + abort on 0 rows.
        // Queue removal on cancel is best-effort (BullMQ ids are auto-
        // generated, see lib/queue.ts), so a job cancelled while queued is
        // still dequeued here. The old unguarded overwrite resurrected the
        // cancelled+refunded row to 'processing' and ran the full provider
        // generation — the user kept the refund AND got the output.
        const { data: pickedRows } = await supabase
          .from("jobs")
          .update({
            status: "processing",
            started_at: nowIso,
            provider_call_started_at: nowIso,
            provider_kind: "pre-task",
            is_public: isPublicOutput,
            job_type: job.name,
          })
          .eq("id", jobId)
          .in("status", ["pending", "processing"])
          .select("id")
        if (!pickedRows || pickedRows.length === 0) {
          console.log(
            `[worker] Job ${jobId} not in a runnable state at pickup (cancelled/terminal while queued) — discarding`,
          )
          return
        }

        const handler = allHandlers[job.name]
        if (!handler) {
          throw new Error(`Unknown job type: ${job.name}`)
        }

        // Bind a cancellation context so provider poll loops abort the moment
        // the user cancels — instead of polling the upstream job to completion.
        try {
          await runWithJobCancellation(jobId, jobUserId, () => handler(job, ctx))
        } catch (firstErr) {
          const firstBlock = safetyBlockOf(firstErr, modelId)
          if (!firstBlock || firstBlock.maxAttempts < 2) throw firstErr
          // ONE inline re-run of the same request: the provider's safety filter
          // is stochastic on this model (catalog `safetyFilter`). Inline, never
          // via a BullMQ retry — a re-pick of a job that already carries a
          // provider_task_id is routed to the stall-recovery reconcile above,
          // which re-reads the SAME failed task and never calls the provider
          // again (that is how the first live replay produced no retry).
          safetyRetried = true
          console.warn(
            `[worker] Job ${jobId} safety-blocked on ${modelId ?? "unknown model"} — retrying the same request once inline`,
          )
          await runWithJobCancellation(jobId, jobUserId, () => handler(job, ctx))
        }

        // Record execution duration for progress bar estimation
        // (started_at was set on the job record at the start of processing above)
        try {
          const statsKey = buildStatsKey(job.name, job.data as Record<string, unknown>)
          if (statsKey) {
            const { data: completedJob } = await supabase
              .from("jobs")
              .select("started_at")
              .eq("id", jobId)
              .single()
            if (completedJob?.started_at) {
              const durationMs = Date.now() - new Date(completedJob.started_at).getTime()
              upsertExecutionStats(statsKey, durationMs).catch(() => {})
            }
          }
        } catch { /* non-critical — don't block job completion */ }

        // Create asset records so generated media appears in /library
        await createAssetFromJob(jobId, jobUserId)
      } catch (err) {
        // User cancelled mid-flight (queue-pickup race or poll abort). The row
        // is already at status='cancelled' (+ refunded) by the cancel route, so
        // discard quietly — do NOT mark "failed" or re-refund, and don't rethrow
        // (a throw would make BullMQ retry the cancelled job).
        if (err instanceof JobCancelledError) {
          console.log(`[worker] Job ${jobId} cancelled by user — discarding result, leaving status='cancelled'`)
          return
        }

        // Drain abort (deploy SIGTERM — lib/worker-drain.ts): the WORKER is
        // dying, not the job. Leave the row exactly as-is (reservation intact,
        // status untouched — the provider task may still be running or already
        // delivered upstream) and hand the job BACK TO THE QUEUE AT ZERO COST:
        // `moveToDelayed` + `DelayedError` (BullMQ's in-processor requeue,
        // the primitive social-publish-worker already uses) requeues it with
        // its lock released and its attempt count UNTOUCHED, so the
        // replacement process re-picks it seconds after boot and the stall
        // guard's inline reconcile resumes/recovers it. Marking failed+
        // refunding would charge nothing for a result we can still collect
        // (incident 2026-07-15: 15–20 min stalls when locks died with the
        // process).
        //
        // WHY NOT A PLAIN RETHROW (2026-08-18, recast run f4f503b6): a rethrow
        // SPENDS an attempt. Two rollouts inside two minutes (staging deploys
        // on every dev merge) exhausted `attempts: 3` on one paid cycle — the
        // job went failed-permanent in BullMQ while its row sat `processing`
        // for 30 minutes until the reconcile sweep failed it. A short delay,
        // not a park: Railway brings the new container up BEFORE draining the
        // old one, so a worker is already listening.
        if (err instanceof DrainAbortError) {
          try {
            await job.moveToDelayed(Date.now() + DRAIN_REQUEUE_DELAY_MS, token)
          } catch (moveErr) {
            // The lock is gone or the connection is closing under us — the
            // plain rethrow (BullMQ's own requeue rules) is the fallback.
            console.warn(
              `[worker] Job ${jobId} interrupted by worker drain — moveToDelayed failed (${moveErr instanceof Error ? moveErr.message : String(moveErr)}); rethrowing for BullMQ requeue (row left for stall-retry recovery)`,
            )
            throw err
          }
          console.warn(
            `[worker] Job ${jobId} interrupted by worker drain — moved back to the queue (attempt not spent; row left for stall-retry recovery)`,
          )
          throw new DelayedError()
        }

        const message = err instanceof Error ? err.message : "Unknown error"

        // For KieError, log the internal details for debugging. Everything on
        // ONE line: Railway log filters match single lines, so an id-filtered
        // search must surface the actual error, not a bare "failed:" prefix
        // with the details stranded on unmatched follow-up lines.
        let internalDetails: string | undefined
        if (err instanceof KieError) {
          internalDetails = err.internalDetails
          console.error(
            `[worker] Job ${jobId} failed (KIE.ai): ${internalDetails ?? message} | context: ${err.context} | user message: ${message}`,
          )
        } else {
          console.error(`[worker] Job ${jobId} failed:`, message)
        }

        // A provider content-policy block gets its OWN bounded retry policy
        // (backend/src/lib/safety-block.ts), decoupled from the queue's global
        // `attempts: 3` — a stochastic `safety` block on a flagged model
        // retries once (maxAttempts 2), everything else (copyright/likeness,
        // or an unflagged model's safety block) gets exactly one attempt. The
        // model id rides in `job.data` as `provider` (route enqueue shape);
        // `model` wins when set (the LoRA path only).
        // A content-policy block reaching this catch is always final: the one
        // permitted retry (if the policy allows one) already ran inline above.
        const block = safetyBlockOf(err, modelId)
        const finalAttempt = block ? true : isFinalJobAttempt(job)

        // Post-provider self-heal (audit spec, worker branch). On the FINAL
        // attempt, a PostProcessingError means the provider already delivered
        // and billed us — only a post-delivery step (R2 upload, watermark,
        // transcode) failed. If the row is reconcile-recoverable (persisted
        // provider_task_id + a kind the reconcile system owns), marking it
        // failed+charged throws away a result the cron can re-fetch — leave
        // it `processing` instead: the cron completes it (or, for heygen /
        // exhaustion, fail+refunds with an anomaly row). Plain Errors (e.g.
        // the inpaint composite, REFUND-CRITICAL in handlers/image-ai.ts)
        // deliberately do NOT qualify — they must keep refunding.
        if (finalAttempt && isPostProcessingError(err)) {
          const { data: row } = await supabase
            .from("jobs")
            .select("provider_kind, provider_task_id, status")
            .eq("id", jobId)
            .single()
          const recoverableRow = row as {
            provider_kind: string | null
            provider_task_id: string | null
            status: string
          } | null
          if (
            recoverableRow &&
            recoverableRow.status === "processing" &&
            isReconcileRecoverable(recoverableRow)
          ) {
            console.warn(
              `[worker] Job ${jobId} post-provider failure left for reconcile ` +
              `(kind=${recoverableRow.provider_kind}, task=${recoverableRow.provider_task_id}): ${message}`,
            )
            // No rethrow: the BullMQ job ends here; the jobs row stays
            // `processing` and the reconcile cron owns the terminal outcome.
            return
          }
        }

        // Only finalize (mark failed) + refund on the FINAL attempt (and only
        // when the self-heal branch above did not take the row). On a
        // non-final attempt BullMQ will retry, and marking the row failed +
        // refunding the reservation now would let a successful retry deliver
        // the media for free (commit_credits no-ops against an already-refunded
        // usage_log). On non-final attempts we just rethrow so BullMQ retries
        // with the reservation intact.
        if (finalAttempt) {
          // Save the sanitized message (user-facing) plus the redacted provider detail (operator-facing).
          // A `safety`-class block gets its own honest final message (names the
          // fallback model when the catalog offers one) — copyright/likeness
          // blocks are deterministic on the same input and keep KIE's existing
          // CONTENT_POLICY_MESSAGES text unchanged.
          const errorMessage =
            block && block.class === "safety"
              ? safetyBlockMessage(block.fallback ? fallbackLabelOf(block.fallback) : undefined, safetyRetried)
              : message
          // THE failure writer (lib/job-failure.ts). Its CAS is what keeps a job
          // a concurrent writer already moved to a terminal state (inflight-
          // reconcile cron completing it, or a stall re-pick) from being trampled
          // "completed"/"cancelled" → "failed" — which would orphan its committed
          // credits + delivered asset and fail the workflow despite delivery — and
          // what keeps this worker off a `pending_review` row (spec D11).
          const flipped = await markJobFailed(jobId, {
            error_message: errorMessage,
            // W0: the provider's own error, redacted — the sanitized message
            // above is what the user sees; this is what the operator needs.
            error_detail: providerDetailOf(err),
            // Migration 376: a user-safe, machine-readable hint the editor/MCP
            // can act on (offer the fallback model) without parsing prose.
            // NULL for anything that isn't a classified content-policy block.
            ...(block ? { error_hint: errorHintFor(block, safetyRetried) } : {}),
          })

          // Only refund if WE flipped the row. If a concurrent writer already
          // completed it, skip (the asset was delivered + credits committed); if
          // it was cancelled, the cancel route already refunded. refundJobCredits
          // is idempotent regardless, but this avoids a needless roundtrip.
          if (flipped) {
            // Pass the ERROR OBJECT (not just the string) so refundJobCredits
            // can read the PostProcessingError type signal. A post-provider
            // failure (R2 upload, watermark, transcode, merge) skips the refund
            // because the provider already billed us; everything else refunds.
            await refundJobCredits(usageLogId, jobId, err)
          }

          // A content-policy block has already exhausted ITS OWN bounded
          // policy (not the queue's global `attempts: 3`) — BullMQ must not
          // spend another attempt re-running a request that will fail
          // identically. UnrecoverableError short-circuits its retry
          // machinery (precedent: social-publish-worker.ts's `definitive`
          // branch).
          if (block) {
            throw new UnrecoverableError(errorMessage)
          }
        }
        throw err
      }
    },
    {
      connection: connection as unknown as ConnectionOptions,
      concurrency: config.VIDEO_WORKER_CONCURRENCY,
      // Lock/stall geometry (incident 2026-07-15): a job whose process dies
      // WITHOUT the drain path (OOM, SIGKILL, crash) is invisible to stall
      // recovery until its lock expires + the next stalled check runs — that
      // window is user-visible "stuck at processing". 300s lock (auto-renewed
      // every 150s while the handler runs, so long renders are safe) + 60s
      // stalled checks cap the blackout at ~6 min, down from the old
      // 900s+300s ≈ 15–20 min. Safe to re-pick early: the stall guard never
      // re-runs a handler once provider_task_id is persisted (inline
      // reconcile instead), and finalize is CAS-claimed.
      lockDuration: 300_000,
      stalledInterval: 60_000,
      // Deploy storms can stall the same job more than once before a healthy
      // process gets to it (2026-07-15 batch B stalled under two consecutive
      // deploys). Default maxStalledCount=1 would move it to failed-permanent
      // on the second stall; each extra re-pick is a cheap idempotent inline
      // reconcile, so allow a few.
      maxStalledCount: 3,
    },
  )
}
