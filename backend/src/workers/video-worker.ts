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
import { ffmpegHandlers } from "./handlers/ffmpeg.js"
import { audioAIHandlers } from "./handlers/audio-ai.js"
import { sunoHandlers } from "./handlers/suno.js"
import { entityHandlers } from "./handlers/entity.js"
import { buildStatsKey, upsertExecutionStats } from "../services/execution-stats.js"

const allHandlers: Record<string, HandlerFn> = {
  ...imageAIHandlers,
  ...videoAIHandlers,
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
      // `provider_task_id` is fetched to detect a BullMQ stall-retry: if the
      // upstream task was already created on a prior worker, we MUST NOT call
      // createTask again (that would duplicate-bill the provider). The
      // reconcile cron will poll the existing task and finalize.
      const { data: jobRecord } = await supabase
        .from("jobs")
        .select("usage_log_id, user_id, should_watermark, force_private, mcp_client, workflow_execution_id, provider_task_id, profiles!user_id(public_outputs)")
        .eq("id", jobId)
        .single()

      // Stall-retry guard. If provider_task_id is already set, the upstream
      // call was initiated by a prior worker — most likely BullMQ retried this
      // job because the original worker's lock expired (lockDuration 15min;
      // KIE poll budgets can exceed that for VEO / lip-sync). Calling
      // createTask again would create a duplicate upstream task and double-bill.
      // Skip the handler entirely; the reconcile cron (5min cadence) will poll
      // the existing taskId and finalize. The BullMQ job exits "completed"
      // because no exception fires; jobs.status stays as-is until reconcile
      // writes the terminal state.
      if (jobRecord?.provider_task_id) {
        console.log(
          `[worker] Stall-retry for job ${jobId} (provider_task_id=${jobRecord.provider_task_id}); ` +
          `skipping handler — reconcile cron will recover`,
        )
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
        await supabase
          .from("jobs")
          .update({
            status: "processing",
            started_at: new Date().toISOString(),
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
