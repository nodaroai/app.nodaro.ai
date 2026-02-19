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
import { readdir, stat, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { validatePlanByType } from "../lib/plan-schemas.js"

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

interface SceneGraphData extends Record<string, unknown> {
  fps: number
  width: number
  height: number
  durationInFrames: number
  backgroundColor: string
  tracks: unknown[]
}

interface SceneGraphInputProps extends Record<string, unknown> {
  sceneGraph: SceneGraphData
}

interface LegacyRenderJobData {
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

interface SceneGraphRenderJobData {
  jobId: string
  sceneGraph: SceneGraphData
  usageLogId?: string
}

interface PlanRenderJobData {
  jobId: string
  planType: string
  plan: Record<string, unknown>
  usageLogId?: string
}

type RenderJobData = LegacyRenderJobData | SceneGraphRenderJobData | PlanRenderJobData

function isPlanJob(data: RenderJobData): data is PlanRenderJobData {
  return "planType" in data && data.planType != null
}

function isSceneGraphJob(data: RenderJobData): data is SceneGraphRenderJobData {
  return "sceneGraph" in data && data.sceneGraph != null
}

// Cache Remotion bundles after first build.
// Two separate bundles: main (all non-3D compositions) and 3D (r3f-based).
// @react-three/fiber creates its own React reconciler at module init time,
// which conflicts with Remotion's reconciler and crashes ALL compositions
// if bundled together.
let cachedMainBundlePath: string | null = null
let cached3DBundlePath: string | null = null

const REMOTION_PKG_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/remotion",
)

async function bundleEntry(
  entryFile: string,
  label: string,
  useR3FAliases: boolean,
): Promise<string> {
  const { bundle } = await import("@remotion/bundler")
  const entryPoint = join(REMOTION_PKG_DIR, "src", entryFile)

  console.log(`[render-worker] Bundling ${label}...`)
  const bundlePath = await bundle({
    entryPoint,
    // Only the 3D bundle needs webpack aliases to de-duplicate React packages.
    // @react-three/fiber bundles its own scheduler@0.21 which conflicts with
    // React 18.3's scheduler@0.23. The main bundle must NOT have aliases —
    // they break Remotion's own module resolution.
    ...(useR3FAliases
      ? {
          webpackOverride: (config) => {
            const nodeModules = join(REMOTION_PKG_DIR, "node_modules")
            return {
              ...config,
              resolve: {
                ...config.resolve,
                alias: {
                  ...(config.resolve?.alias ?? {}),
                  react: join(nodeModules, "react"),
                  "react-dom": join(nodeModules, "react-dom"),
                  scheduler: join(nodeModules, "scheduler"),
                },
              },
            }
          },
        }
      : {}),
    onProgress: (progress: number) => {
      if (progress % 25 === 0) {
        console.log(`[render-worker] ${label} bundle progress: ${progress}%`)
      }
    },
  })
  console.log(`[render-worker] ${label} bundle complete:`, bundlePath)
  return bundlePath
}

async function getBundlePath(compositionId: string): Promise<string> {
  if (compositionId === "3d-title") {
    if (!cached3DBundlePath) {
      cached3DBundlePath = await bundleEntry("Root3D.tsx", "3D compositions", true)
    }
    return cached3DBundlePath
  }
  if (!cachedMainBundlePath) {
    cachedMainBundlePath = await bundleEntry("Root.tsx", "main compositions", false)
  }
  return cachedMainBundlePath
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

/**
 * Build composition ID and input props for generic plan mode.
 * Routes to the composition matching the planType (e.g. "after-effects").
 */
function buildPlanRender(data: PlanRenderJobData): {
  compositionId: string
  inputProps: Record<string, unknown>
  width: number
  height: number
  fps: number
  durationInFrames: number
} {
  // Validate plan structure (scene-graph uses its own validator)
  let validatedPlan: Record<string, unknown>
  if (data.planType !== "scene-graph") {
    validatedPlan = validatePlanByType(data.planType, data.plan) as Record<string, unknown>
  } else {
    validatedPlan = data.plan as Record<string, unknown>
  }

  return {
    compositionId: data.planType,
    inputProps: { plan: validatedPlan },
    width: (validatedPlan.width as number) ?? 1920,
    height: (validatedPlan.height as number) ?? 1080,
    fps: (validatedPlan.fps as number) ?? 30,
    durationInFrames: (validatedPlan.durationInFrames as number) ?? 300,
  }
}

/**
 * Build composition ID and input props for scene graph mode.
 * Uses the "scene-graph" composition registered in Root.tsx.
 */
function buildSceneGraphRender(data: SceneGraphRenderJobData): {
  compositionId: string
  inputProps: SceneGraphInputProps
  width: number
  height: number
  fps: number
  durationInFrames: number
} {
  const { sceneGraph } = data
  return {
    compositionId: "scene-graph",
    inputProps: { sceneGraph },
    width: sceneGraph.width,
    height: sceneGraph.height,
    fps: sceneGraph.fps,
    durationInFrames: sceneGraph.durationInFrames,
  }
}

/**
 * Build composition ID and input props for legacy template mode.
 * Legacy templates still use their original composition IDs (slideshow, explainer, etc.)
 * and are rendered by the original composition components registered in Root.tsx.
 */
function buildLegacyRender(data: LegacyRenderJobData): {
  compositionId: string
  inputProps: RenderInputProps
  width: number
  height: number
  fps: number
  durationInFrames: number
} {
  const localAssets = data.mediaAssets.map((asset) => ({
    localPath: asset.url,
    type: asset.type,
    durationSeconds: asset.durationSeconds,
  }))

  const inputProps: RenderInputProps = {
    template: data.template,
    fps: data.fps,
    width: data.width,
    height: data.height,
    durationInFrames: data.durationInFrames,
    transitionStyle: data.transitionStyle,
    transitionDurationFrames: data.transitionDurationFrames,
    mediaAssets: localAssets,
    audioTrackLocalPath: data.audioTrackUrl,
    textOverlays: data.textOverlays,
    captions: data.captions,
    backgroundColor: data.backgroundColor,
    kenBurnsEnabled: data.kenBurnsEnabled,
  }

  return {
    compositionId: data.template,
    inputProps,
    width: data.width,
    height: data.height,
    fps: data.fps,
    durationInFrames: data.durationInFrames,
  }
}

/**
 * Check if a job was cancelled before saving results.
 * Prevents wasted work when user cancels during a long render.
 */
async function shouldSaveJobResult(jobId: string): Promise<boolean> {
  const { data: currentJob } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", jobId)
    .single()

  if (currentJob?.status === "cancelled") {
    console.log(`[render-worker] Job ${jobId} was cancelled, skipping save`)
    return false
  }
  return true
}

/**
 * Clean up orphaned render work directories from /tmp on startup.
 * Removes any render-* directories older than 24 hours.
 */
async function cleanupStaleWorkDirs(): Promise<void> {
  const tmp = tmpdir()
  const maxAge = 24 * 60 * 60 * 1000 // 24 hours
  const now = Date.now()

  try {
    const entries = await readdir(tmp)
    let cleaned = 0
    let totalBytes = 0

    for (const entry of entries) {
      if (!entry.startsWith("render-")) continue
      const fullPath = join(tmp, entry)
      try {
        const s = await stat(fullPath)
        if (!s.isDirectory()) continue
        if (now - s.mtimeMs > maxAge) {
          totalBytes += s.size
          await rm(fullPath, { recursive: true, force: true })
          cleaned++
        }
      } catch {
        // Skip entries we can't stat
      }
    }

    if (cleaned > 0) {
      console.log(`[render-worker] Startup cleanup: removed ${cleaned} stale work dir(s)`)
    }
  } catch (err) {
    console.error("[render-worker] Startup cleanup failed:", err)
  }
}

export function createRenderWorker() {
  // Clean up orphaned work directories from previous crashes
  cleanupStaleWorkDirs().catch(() => {})

  // Pre-warm bundles in background (non-blocking)
  getBundlePath("scene-graph").catch((err) =>
    console.error("[render-worker] Main bundle pre-warm failed:", err)
  )
  getBundlePath("3d-title").catch((err) =>
    console.error("[render-worker] 3D bundle pre-warm failed:", err)
  )

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

        await bullJob.updateProgress(30)

        // Build render config — plan mode, scene graph mode, or legacy template mode
        let renderConfig
        let modeLabel: string
        if (isPlanJob(data)) {
          renderConfig = buildPlanRender(data)
          modeLabel = `plan:${data.planType}`
        } else if (isSceneGraphJob(data)) {
          renderConfig = buildSceneGraphRender(data)
          modeLabel = "scene-graph"
        } else {
          renderConfig = buildLegacyRender(data)
          modeLabel = "legacy"
        }

        const { compositionId, inputProps, width, height, fps, durationInFrames } = renderConfig

        console.log(`[render-worker] Rendering ${compositionId} (${modeLabel}) for job ${jobId}`)

        // Bundle Remotion compositions (cached after first call per entry point)
        const bundlePath = await getBundlePath(compositionId)
        await bullJob.updateProgress(40)

        // Select composition and render
        const { selectComposition, renderMedia } = await import("@remotion/renderer")

        const composition = await selectComposition({
          serveUrl: bundlePath,
          id: compositionId,
          inputProps,
        })

        const outputPath = join(workDir, "output.mp4")

        const RENDER_TIMEOUT_MS = 25 * 60 * 1000
        await Promise.race([
          renderMedia({
            composition: {
              ...composition,
              width,
              height,
              fps,
              durationInFrames,
            },
            serveUrl: bundlePath,
            codec: "h264",
            outputLocation: outputPath,
            inputProps,
            onProgress: ({ progress }: { progress: number }) => {
              const overall = 40 + Math.round(progress * 50)
              bullJob.updateProgress(overall).catch(() => {})
            },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Render timed out after 25 minutes")), RENDER_TIMEOUT_MS)
          ),
        ])

        await bullJob.updateProgress(90)

        // Check if job was cancelled during render
        if (!await shouldSaveJobResult(jobId)) {
          await handleCredits("refund", effectiveUsageLogId, jobId)
          return
        }

        // Apply watermark if free tier
        let uploadPath = outputPath
        if (shouldWatermark) {
          const wmPath = join(workDir, "output-wm.mp4")
          await applyVideoWatermark(outputPath, wmPath)
          uploadPath = wmPath
        }

        // Upload to R2
        const videoUrl = await uploadFileToR2(uploadPath, jobId, "video", jobUserId)
        await bullJob.updateProgress(95)

        // Generate thumbnail
        const thumbnailUrl = await generateAndUploadThumbnail(videoUrl, jobId, jobUserId)

        // Mark job completed
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

        // Commit credits
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

        // Terminal errors won't resolve on retry — skip BullMQ retries
        const isTerminal = /composition.*not found|plan validation|zod|invalid plan|timed out/i.test(errMsg)
        if (isTerminal) {
          console.error(`[render-worker] Terminal error for job ${jobId}, skipping retry: ${errMsg}`)
          return
        }
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
