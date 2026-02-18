import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../services/credits.js"
import { uploadFileToR2, uploadBufferToR2 } from "../lib/storage.js"
import { createWorkDir, cleanupWorkDir } from "../providers/video/ffmpeg-utils.js"
import { applyVideoWatermark } from "../utils/watermark.js"
import { generateThumbnailFromUrl } from "../utils/thumbnail.js"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// Remotion types (inline to avoid cross-package import at compile time)
// Index signature required for Remotion's selectComposition/renderMedia APIs
interface RenderInputProps extends Record<string, unknown> {
  template: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  transitionStyle: string
  transitionDurationFrames: number
  mediaAssets: Array<{ localPath: string; type: "image" | "video" | "audio"; durationSeconds?: number }>
  audioTrackLocalPath?: string
  textOverlays: Array<{ text: string; position: "top" | "center" | "bottom"; fontSize: number; color: string; startFrame: number; endFrame: number }>
  captions: { enabled: boolean; style: string; position: string; fontSize: number; color: string }
  backgroundColor: string
  kenBurnsEnabled: boolean
}

interface RenderJobData {
  jobId: string
  template: string
  fps: number
  width: number
  height: number
  durationInFrames: number
  transitionStyle: string
  transitionDurationFrames: number
  mediaAssets: Array<{ url: string; type: "image" | "video" | "audio"; durationSeconds?: number }>
  audioTrackUrl?: string
  textOverlays: RenderInputProps["textOverlays"]
  captions: RenderInputProps["captions"]
  backgroundColor: string
  kenBurnsEnabled: boolean
  usageLogId?: string
}

// Cache the Remotion bundle after first build
let cachedBundlePath: string | null = null

async function getBundlePath(): Promise<string> {
  if (cachedBundlePath) return cachedBundlePath

  const { bundle } = await import("@remotion/bundler")
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const entryPoint = join(currentDir, "../../../packages/remotion/src/Root.tsx")

  console.log("[render-worker] Bundling Remotion compositions...")
  cachedBundlePath = await bundle({
    entryPoint,
    onProgress: (progress: number) => {
      if (progress % 25 === 0) {
        console.log(`[render-worker] Bundle progress: ${progress}%`)
      }
    },
  })
  console.log("[render-worker] Bundle complete:", cachedBundlePath)
  return cachedBundlePath
}

async function handleCredits(
  action: "commit" | "refund",
  usageLogId: string | null | undefined,
  jobId: string,
): Promise<void> {
  if (!hasCredits() || !usageLogId) return
  try {
    if (action === "commit") {
      await CreditsService.commitCredits(usageLogId)
    } else {
      await CreditsService.refundCredits(usageLogId)
    }
    console.log(`[render-worker] Credits ${action}ed for job ${jobId}`)
  } catch (error) {
    console.error(`[render-worker] Failed to ${action} credits for job ${jobId}:`, error)
  }
}

async function generateAndUploadThumbnail(
  videoUrl: string,
  jobId: string,
  jobUserId: string | undefined,
): Promise<string | null> {
  try {
    const thumbBuffer = await generateThumbnailFromUrl(videoUrl)
    return await uploadBufferToR2(thumbBuffer, `thumbnails/${jobId}.png`, "image/png", jobUserId)
  } catch (err) {
    console.error(`[render-worker] Thumbnail generation failed for job ${jobId}:`, err)
    return null
  }
}

export function createRenderWorker() {
  const connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  return new Worker(
    "video-render",
    async (bullJob) => {
      const data = bullJob.data as RenderJobData
      const { jobId, usageLogId } = data

      // Fetch job + user profile
      const { data: jobRecord } = await supabase
        .from("jobs")
        .select("usage_log_id, user_id, profiles!user_id(tier, public_outputs)")
        .eq("id", jobId)
        .single()

      const jobUserId = (jobRecord?.user_id as string) ?? undefined
      const effectiveUsageLogId = usageLogId ?? jobRecord?.usage_log_id as string | undefined

      const profileData = (jobRecord as Record<string, unknown>)?.profiles as Record<string, unknown> | null
      const userTier = (profileData?.tier as string) ?? "free"
      const shouldWatermark = userTier === "free"
      const isPublic = profileData?.public_outputs !== false

      const workDir = await createWorkDir("render")

      try {
        await supabase.from("jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", jobId)

        // 1. Pass original HTTP URLs to Remotion (Chrome fetches them directly)
        console.log(`[render-worker] Preparing ${data.mediaAssets.length} assets for job ${jobId}`)
        const localAssets: RenderInputProps["mediaAssets"] = data.mediaAssets.map((asset) => ({
          localPath: asset.url,
          type: asset.type,
          durationSeconds: asset.durationSeconds,
        }))

        const audioTrackLocalPath = data.audioTrackUrl

        await bullJob.updateProgress(30)

        // 2. Bundle Remotion compositions (cached after first call)
        const bundlePath = await getBundlePath()
        await bullJob.updateProgress(40)

        // 3. Build input props
        const inputProps: RenderInputProps = {
          template: data.template,
          fps: data.fps,
          width: data.width,
          height: data.height,
          durationInFrames: data.durationInFrames,
          transitionStyle: data.transitionStyle,
          transitionDurationFrames: data.transitionDurationFrames,
          mediaAssets: localAssets,
          audioTrackLocalPath,
          textOverlays: data.textOverlays,
          captions: data.captions,
          backgroundColor: data.backgroundColor,
          kenBurnsEnabled: data.kenBurnsEnabled,
        }

        // 4. Select composition and render
        const { selectComposition, renderMedia } = await import("@remotion/renderer")

        const composition = await selectComposition({
          serveUrl: bundlePath,
          id: data.template,
          inputProps,
        })

        const outputPath = join(workDir, "output.mp4")

        console.log(`[render-worker] Rendering ${data.template} for job ${jobId}`)
        await renderMedia({
          composition: {
            ...composition,
            width: data.width,
            height: data.height,
            fps: data.fps,
            durationInFrames: data.durationInFrames,
          },
          serveUrl: bundlePath,
          codec: "h264",
          outputLocation: outputPath,
          inputProps,
          onProgress: ({ progress }: { progress: number }) => {
            const overall = 40 + Math.round(progress * 50)
            bullJob.updateProgress(overall).catch(() => {})
          },
        })

        await bullJob.updateProgress(90)

        // 5. Apply watermark if free tier
        let uploadPath = outputPath
        if (shouldWatermark) {
          const wmPath = join(workDir, "output-wm.mp4")
          await applyVideoWatermark(outputPath, wmPath)
          uploadPath = wmPath
        }

        // 6. Upload to R2
        const videoUrl = await uploadFileToR2(uploadPath, jobId, "video", jobUserId)
        await bullJob.updateProgress(95)

        // 7. Generate thumbnail
        const thumbnailUrl = await generateAndUploadThumbnail(videoUrl, jobId, jobUserId)

        // 8. Mark job completed
        await supabase
          .from("jobs")
          .update({
            status: "completed",
            progress: 100,
            output_data: { videoUrl, thumbnailUrl },
            completed_at: new Date().toISOString(),
            is_public: isPublic,
          })
          .eq("id", jobId)

        // 9. Commit credits
        await handleCredits("commit", effectiveUsageLogId, jobId)

        console.log(`[render-worker] Job ${jobId} completed successfully`)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        console.error(`[render-worker] Job ${jobId} failed:`, errMsg)

        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: errMsg,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)

        await handleCredits("refund", effectiveUsageLogId, jobId)
        throw error
      } finally {
        await cleanupWorkDir(workDir)
      }
    },
    {
      connection,
      concurrency: 1,
      lockDuration: 1_800_000, // 30 minutes
    },
  )
}
