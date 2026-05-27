import { Worker, type ConnectionOptions } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { initProviders } from "../providers/index.js"
import { KieError } from "../providers/kie/client.js"
import { isPromptBlocked } from "../config/content-filter.js"
import { refundJobCredits, createAssetFromJob, type HandlerFn, type JobContext } from "./shared.js"
import { imageAIHandlers } from "./handlers/image-ai.js"
import { videoAIHandlers } from "./handlers/video-ai.js"
import { videoSfxHandlers } from "./handlers/video-sfx.js"
import { ffmpegHandlers } from "./handlers/ffmpeg.js"
import { audioAIHandlers } from "./handlers/audio-ai.js"
import { sunoHandlers } from "./handlers/suno.js"
import { entityHandlers } from "./handlers/entity.js"
import { buildStatsKey, upsertExecutionStats } from "../services/execution-stats.js"
import { tryInlineReconcile } from "./inline-reconcile.js"

const allHandlers: Record<string, HandlerFn> = {
  ...imageAIHandlers,
  ...videoAIHandlers,
  ...videoSfxHandlers,
  ...ffmpegHandlers,
  ...audioAIHandlers,
  ...sunoHandlers,
  ...entityHandlers,
}

export function createVideoWorker() {
  initProviders()

  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-generation",
    async (job) => {
      const { jobId } = job.data as { jobId: string }

      // Fetch job record (with should_watermark from reservation) + user profile for public_outputs.
      // `provider_task_id` + `provider_kind` + `reconcile_attempts` + `job_type`
      // are fetched to (a) detect a BullMQ stall-retry, and (b) immediately
      // recover the row via the same handler the reconcile cron uses.
      const { data: jobRecord } = await supabase
        .from("jobs")
        .select("usage_log_id, user_id, should_watermark, force_private, mcp_client, workflow_execution_id, provider_task_id, provider_kind, reconcile_attempts, job_type, profiles!user_id(public_outputs)")
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
        })
        return
      }

      const usageLogId = jobRecord?.usage_log_id
      const jobUserId = (jobRecord?.user_id as string) ?? undefined

      // Use watermark decision from reservation time (C4 fix: prevents bypass via tier upgrade)
      const shouldWatermark = hasCredits() ? (jobRecord?.should_watermark ?? false) : false

      let isPublicOutput = true
      if (jobUserId && jobRecord?.profiles) {
        const profile = jobRecord.profiles as unknown as { public_outputs?: boolean }
        isPublicOutput = profile?.public_outputs ?? true
      }

      // Auto-hide outputs whose prompt contains blocked words
      if (isPublicOutput) {
        const jobData = job.data as Record<string, unknown>
        const promptText = (jobData.prompt as string) ?? (jobData.text as string) ?? null
        if (isPromptBlocked(promptText)) {
          isPublicOutput = false
        }
      }

      // Force private when job uses uploaded/private input content
      if (isPublicOutput && jobRecord?.force_private === true) {
        isPublicOutput = false
      }

      // Force private for MCP-generated content. The user is generating
      // through an external client (Claude.ai, Cursor) — that's a private
      // surface, NOT the public web app where they consciously opted in
      // to gallery sharing. Free/Basic tiers can't disable public_outputs
      // in the profile, so without this clause every MCP generation would
      // leak to the public gallery.
      //
      // Two paths to detect MCP origin:
      //   (a) Direct generate_image / modify_image / animate_image / etc.
      //       — `mcp_client` populated on the job row itself by the route.
      //   (b) Workflow / app run — the parent workflow_execution carries
      //       `mcp_client`; per-node child jobs don't (the orchestrator
      //       calls the same internal routes which don't see the MCP
      //       header on each per-node call). Look up the parent.
      if (isPublicOutput && jobRecord?.mcp_client) {
        isPublicOutput = false
      }
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
        await supabase
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

        const handler = allHandlers[job.name]
        if (!handler) {
          throw new Error(`Unknown job type: ${job.name}`)
        }

        await handler(job, ctx)

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
        const message = err instanceof Error ? err.message : "Unknown error"

        // For KieError, log the internal details for debugging
        let internalDetails: string | undefined
        if (err instanceof KieError) {
          internalDetails = err.internalDetails
          console.error(`[worker] Job ${jobId} failed (KIE.ai):`)
          console.error(`  User message: ${message}`)
          console.error(`  Internal details: ${internalDetails}`)
          console.error(`  Context: ${err.context}`)
        } else {
          console.error(`[worker] Job ${jobId} failed:`, message)
        }

        // Save only the sanitized message to DB (internal details already logged above)
        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)

        await refundJobCredits(usageLogId, jobId, message)
        throw err
      }
    },
    { connection: connection as unknown as ConnectionOptions, concurrency: config.VIDEO_WORKER_CONCURRENCY, lockDuration: 900_000, stalledInterval: 300_000 },
  )
}
