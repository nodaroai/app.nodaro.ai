import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config, hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { CreditsService } from "../services/credits.js"
import { uploadFileToR2, uploadBufferToR2 } from "../lib/storage.js"
import { createWorkDir, cleanupWorkDir, downloadFile } from "../providers/video/ffmpeg-utils.js"
import { applyVideoWatermark } from "../utils/watermark.js"
import { generateThumbnailFromUrl } from "../utils/thumbnail.js"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Remotion types (inline to avoid cross-package import at compile time)
interface MediaAsset {
  readonly localPath: string
  readonly type: "image" | "video" | "audio"
  readonly durationSeconds?: number
}

interface TextOverlay {
  readonly text: string
  readonly position: "top" | "center" | "bottom"
  readonly fontSize: number
  readonly color: string
  readonly startFrame: number
  readonly endFrame: number
}

interface CaptionSettings {
  readonly enabled: boolean
  readonly style: "subtitle" | "word-highlight" | "karaoke"
  readonly position: "bottom" | "top" | "center"
  readonly fontSize: number
  readonly color: string
}

interface RenderVideoInputProps {
  readonly template: string
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly transitionStyle: string
  readonly transitionDurationFrames: number
  readonly mediaAssets: readonly MediaAsset[]
  readonly audioTrackLocalPath?: string
  readonly textOverlays: readonly TextOverlay[]
  readonly captions: CaptionSettings
  readonly backgroundColor: string
  readonly kenBurnsEnabled: boolean
}

// Cache the Remotion bundle after first build
let cachedBundlePath: string | null = null

async function getBundlePath(): Promise<string> {
  if (cachedBundlePath) return cachedBundlePath

  // Dynamic import to avoid compile-time dependency
  const { bundle } = await import("@remotion/bundler")

  console.log("[render-worker] Bundling Remotion compositions...")
  const entryPoint = join(__dirname, "../../packages/remotion/src/Root.tsx")
  const result = await bundle({
    entryPoint,
    onProgress: (progress: number) => {
      if (progress % 25 === 0) {
        console.log(`[render-worker] Bundle progress: ${progress}%`)
      }
    },
  })
  cachedBundlePath = result
  console.log("[render-worker] Bundle complete:", cachedBundlePath)
  return cachedBundlePath
}

async function commitJobCredits(usageLogId: string | null | undefined, jobId: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return
  try {
    await CreditsService.commitCredits(usageLogId)
    console.log(`[render-worker] Credits committed for job ${jobId}`)
  } catch (error) {
    console.error(`[render-worker] Failed to commit credits for job ${jobId}:`, error)
  }
}

async function refundJobCredits(usageLogId: string | null | undefined, jobId: string): Promise<void> {
  if (!hasCredits() || !usageLogId) return
  try {
    await CreditsService.refundCredits(usageLogId)
    console.log(`[render-worker] Credits refunded for job ${jobId}`)
  } catch (error) {
    console.error(`[render-worker] Failed to refund credits for job ${jobId}:`, error)
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
  textOverlays: TextOverlay[]
  captions: CaptionSettings
  backgroundColor: string
  kenBurnsEnabled: boolean
  usageLogId?: string
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

      // Check if user is on free tier (needs watermark)
      const profileData = (jobRecord as Record<string, unknown>)?.profiles as Record<string, unknown> | null
      const userTier = (profileData?.tier as string) ?? "free"
      const shouldWatermark = userTier === "free"
      const isPublic = profileData?.public_outputs !== false

      const workDir = await createWorkDir("render")

      try {
        // Update job status to processing
        await supabase.from("jobs").update({ status: "processing", started_at: new Date().toISOString() }).eq("id", jobId)

        // 1. Download all media assets to temp dir
        console.log(`[render-worker] Downloading ${data.mediaAssets.length} assets for job ${jobId}`)
        const localAssets: MediaAsset[] = []
        for (let i = 0; i < data.mediaAssets.length; i++) {
          const asset = data.mediaAssets[i]
          const ext = asset.type === "image" ? "png" : asset.type === "video" ? "mp4" : "mp3"
          const localPath = join(workDir, `asset_${i}.${ext}`)
          await downloadFile(asset.url, localPath)
          localAssets.push({
            localPath: `asset_${i}.${ext}`,
            type: asset.type,
            durationSeconds: asset.durationSeconds,
          })
        }

        // Download audio track if present
        let audioTrackLocalPath: string | undefined
        if (data.audioTrackUrl) {
          const audioPath = join(workDir, "audio_track.mp3")
          await downloadFile(data.audioTrackUrl, audioPath)
          audioTrackLocalPath = "audio_track.mp3"
        }

        await bullJob.updateProgress(30)

        // 2. Bundle Remotion compositions (cached after first call)
        const bundlePath = await getBundlePath()
        await bullJob.updateProgress(40)

        // 3. Build input props
        const inputProps: RenderVideoInputProps = {
          template: data.template as RenderVideoInputProps["template"],
          fps: data.fps,
          width: data.width,
          height: data.height,
          durationInFrames: data.durationInFrames,
          transitionStyle: data.transitionStyle as RenderVideoInputProps["transitionStyle"],
          transitionDurationFrames: data.transitionDurationFrames,
          mediaAssets: localAssets,
          audioTrackLocalPath,
          textOverlays: data.textOverlays,
          captions: data.captions,
          backgroundColor: data.backgroundColor,
          kenBurnsEnabled: data.kenBurnsEnabled,
        }

        // 4. Select composition and render (dynamic import to avoid compile-time dependency)
        const { selectComposition, renderMedia } = await import("@remotion/renderer")

        const compositionId = data.template
        const composition = await selectComposition({
          serveUrl: bundlePath,
          id: compositionId,
          inputProps,
        })

        const outputPath = join(workDir, "output.mp4")

        console.log(`[render-worker] Rendering ${compositionId} for job ${jobId}`)
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
        await commitJobCredits(effectiveUsageLogId, jobId)

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

        await refundJobCredits(effectiveUsageLogId, jobId)
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
