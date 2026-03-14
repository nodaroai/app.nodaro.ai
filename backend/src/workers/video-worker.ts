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

      // Fetch job record (with should_watermark from reservation) + user profile for public_outputs
      const { data: jobRecord } = await supabase
        .from("jobs")
        .select("usage_log_id, user_id, should_watermark, force_private, profiles!user_id(public_outputs)")
        .eq("id", jobId)
        .single()
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
