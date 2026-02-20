import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { uploadFileWithKeyToR2, uploadFileToR2 } from "../lib/storage.js"
import { createWorkDir, cleanupWorkDir, downloadFile, runFfmpeg, needsTranscode, transcodeToBrowserSafe, BROWSER_SAFE_VIDEO_ARGS } from "../providers/video/ffmpeg-utils.js"
import { applyVideoWatermark } from "../utils/watermark.js"
import { commitJobCredits, refundJobCredits, shouldSaveJobResult, generateAndUploadThumbnail } from "./shared.js"
import { randomUUID } from "node:crypto"
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
  mediaAssets: Array<{ src: string; type: "image" | "video" | "audio"; durationSeconds?: number }>
  audioTrackUrl?: string
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
  // Validate plan structure against its planType schema
  const validatedPlan = validatePlanByType(data.planType, data.plan) as Record<string, unknown>

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

// ── FFmpeg Fast Path ────────────────────────────────────────────────────
// For simple scene graphs (1 video segment, no effects/text), skip Remotion
// entirely and use FFmpeg to merge media — orders of magnitude faster.

interface FastPathTrack {
  type: string
  src?: string
  volume?: number
  fadeInFrames?: number
  fadeOutFrames?: number
  startFrame?: number
  segments?: Array<{
    mediaType?: string
    startFrame?: number
    durationInFrames?: number
    effects?: unknown[]
    transitionIn?: unknown
    transitionOut?: unknown
    src?: string
  }>
}

/**
 * Check if a scene graph can be rendered via FFmpeg instead of Remotion.
 * Eligible when: exactly 1 media track with 1 video segment that spans
 * the full composition, no effects, no transitions, no text tracks.
 * Audio tracks are fine (handled via FFmpeg filter chain).
 */
function canUseFfmpegFastPath(sceneGraph: SceneGraphData): boolean {
  const tracks = sceneGraph.tracks as FastPathTrack[]

  const mediaTracks = tracks.filter((t) => t.type === "media")
  const textTracks = tracks.filter((t) => t.type === "text")

  if (textTracks.length > 0) return false
  if (mediaTracks.length !== 1) return false

  const mediaTrack = mediaTracks[0]
  const segments = mediaTrack.segments ?? []
  if (segments.length !== 1) return false

  const seg = segments[0]
  if (seg.mediaType !== "video") return false
  if (seg.startFrame !== 0) return false
  if (seg.durationInFrames !== sceneGraph.durationInFrames) return false
  if (seg.effects && seg.effects.length > 0) return false
  if (seg.transitionIn || seg.transitionOut) return false

  return true
}

/**
 * Render a simple scene graph via FFmpeg (video copy + audio filter chain).
 * Much faster than Remotion because no headless Chrome is involved.
 */
async function renderSceneGraphViaFfmpeg(
  data: SceneGraphRenderJobData,
  workDir: string,
  bullJob: { updateProgress(p: number): Promise<void> },
): Promise<string> {
  const { sceneGraph } = data
  const tracks = sceneGraph.tracks as FastPathTrack[]
  const fps = sceneGraph.fps
  const durationSec = sceneGraph.durationInFrames / fps

  const mediaTracks = tracks.filter((t) => t.type === "media")
  const audioTracks = tracks.filter((t) => t.type === "audio")

  const videoSrc = mediaTracks[0].segments![0].src!
  const videoPath = join(workDir, "input-video.mp4")
  const outputPath = join(workDir, "output.mp4")

  // Download video
  console.log(`[render-worker] FFmpeg fast path: downloading video`)
  await downloadFile(videoSrc, videoPath)
  await bullJob.updateProgress(50)

  if (audioTracks.length === 0) {
    // No audio — trim the video, transcoding to browser-safe H.264 if needed
    const transcode = await needsTranscode(videoPath)
    console.log(`[render-worker] FFmpeg fast path: trimming video only (no audio, transcode=${transcode})`)
    if (transcode) {
      await runFfmpeg([
        "-i", videoPath,
        "-t", String(durationSec),
        ...BROWSER_SAFE_VIDEO_ARGS,
        "-an",
        "-y", outputPath,
      ])
    } else {
      await runFfmpeg([
        "-i", videoPath,
        "-t", String(durationSec),
        "-c", "copy",
        "-y", outputPath,
      ])
    }
  } else {
    // Download audio files
    const audioPaths: string[] = []
    for (let i = 0; i < audioTracks.length; i++) {
      const aTrack = audioTracks[i]
      const aPath = join(workDir, `audio-${i}.mp3`)
      await downloadFile(aTrack.src!, aPath)
      audioPaths.push(aPath)
    }
    await bullJob.updateProgress(60)

    // Build FFmpeg command with filter_complex for audio mixing
    const inputs = ["-i", videoPath]
    for (const aPath of audioPaths) {
      inputs.push("-i", aPath)
    }

    // Build per-audio filters: delay + volume + fade
    const filterParts: string[] = []
    const mixInputs: string[] = []

    for (let i = 0; i < audioTracks.length; i++) {
      const aTrack = audioTracks[i]
      const inputIdx = i + 1 // 0 is the video
      const startFrame = aTrack.startFrame ?? 0
      const delayMs = Math.round((startFrame / fps) * 1000)
      const vol = aTrack.volume ?? 1
      const fadeInSec = (aTrack.fadeInFrames ?? 0) / fps
      const fadeOutSec = (aTrack.fadeOutFrames ?? 0) / fps

      let chain = `[${inputIdx}:a]`
      const filters: string[] = []

      if (delayMs > 0) {
        filters.push(`adelay=${delayMs}|${delayMs}`)
      }
      if (vol !== 1) {
        filters.push(`volume=${vol}`)
      }
      if (fadeInSec > 0) {
        filters.push(`afade=t=in:st=0:d=${fadeInSec}`)
      }
      if (fadeOutSec > 0) {
        // Fade out ends at composition duration
        const fadeOutStart = durationSec - fadeOutSec
        if (fadeOutStart > 0) {
          filters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOutSec}`)
        }
      }

      const label = `a${i}`
      if (filters.length > 0) {
        chain += `${filters.join(",")}[${label}]`
      } else {
        chain += `anull[${label}]`
      }
      filterParts.push(chain)
      mixInputs.push(`[${label}]`)
    }

    // Mix all audio tracks together
    let filterComplex: string
    if (audioTracks.length === 1) {
      filterComplex = filterParts[0]
      // Use the single processed audio label directly
    } else {
      filterComplex =
        filterParts.join(";") +
        ";" +
        mixInputs.join("") +
        `amix=inputs=${audioTracks.length}:duration=longest[aout]`
    }

    const audioLabel = audioTracks.length === 1 ? "a0" : "aout"

    const transcode = await needsTranscode(videoPath)
    console.log(`[render-worker] FFmpeg fast path: merging video + ${audioTracks.length} audio track(s) (transcode=${transcode})`)
    const videoCodecArgs: readonly string[] = transcode
      ? BROWSER_SAFE_VIDEO_ARGS
      : ["-c:v", "copy"]
    await runFfmpeg([
      ...inputs,
      "-filter_complex", filterComplex,
      "-map", "0:v",
      "-map", `[${audioLabel}]`,
      ...videoCodecArgs,
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(durationSec),
      "-y", outputPath,
    ])
  }

  await bullJob.updateProgress(85)
  console.log(`[render-worker] FFmpeg fast path: done`)
  return outputPath
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
  const mappedAssets = data.mediaAssets.map((asset) => ({
    src: asset.url,
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
    mediaAssets: mappedAssets,
    audioTrackUrl: data.audioTrackUrl,
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

// ── Input video normalization ────────────────────────────────────────────
// Remotion's OffthreadVideo compositor may not support all codecs (e.g. H.265).
// Pre-transcode incompatible videos to H.264/yuv420p before rendering.

const VIDEO_URL_RE = /^https?:\/\/.+\.(mp4|mov|webm)(\?.*)?$/i

/** Collect all video URLs from Remotion inputProps. */
function collectVideoUrls(props: Record<string, unknown>): string[] {
  const urls: string[] = []

  // Scene graph: props.sceneGraph.tracks[].segments[].src
  const sg = props.sceneGraph as Record<string, unknown> | undefined
  if (sg) {
    for (const track of (sg.tracks as Array<Record<string, unknown>>)) {
      const segments = track.segments as Array<Record<string, unknown>> | undefined
      if (segments) {
        for (const seg of segments) {
          if (seg.mediaType === "video" && typeof seg.src === "string") urls.push(seg.src)
        }
      }
    }
    return [...new Set(urls)]
  }

  // Plan: props.plan.sourceVideo / backgroundMedia / layers[].sourceVideo
  const plan = props.plan as Record<string, unknown> | undefined
  if (plan) {
    if (typeof plan.sourceVideo === "string" && VIDEO_URL_RE.test(plan.sourceVideo)) urls.push(plan.sourceVideo)
    if (typeof plan.backgroundMedia === "string" && VIDEO_URL_RE.test(plan.backgroundMedia)) urls.push(plan.backgroundMedia)
    const layers = plan.layers as Array<Record<string, unknown>> | undefined
    if (layers) {
      for (const layer of layers) {
        if (typeof layer.sourceVideo === "string") urls.push(layer.sourceVideo)
      }
    }
    return [...new Set(urls)]
  }

  // Legacy: props.mediaAssets[].src where type === "video"
  const assets = props.mediaAssets as Array<{ src: string; type: string }> | undefined
  if (assets) {
    for (const asset of assets) {
      if (asset.type === "video") urls.push(asset.src)
    }
  }
  return [...new Set(urls)]
}

/** Replace video URLs in Remotion inputProps using a URL map. */
function replaceVideoUrls(props: Record<string, unknown>, urlMap: Map<string, string>): void {
  const sg = props.sceneGraph as Record<string, unknown> | undefined
  if (sg) {
    for (const track of (sg.tracks as Array<Record<string, unknown>>)) {
      const segments = track.segments as Array<Record<string, unknown>> | undefined
      if (segments) {
        for (const seg of segments) {
          if (typeof seg.src === "string" && urlMap.has(seg.src)) seg.src = urlMap.get(seg.src)!
        }
      }
    }
    return
  }

  const plan = props.plan as Record<string, unknown> | undefined
  if (plan) {
    if (typeof plan.sourceVideo === "string" && urlMap.has(plan.sourceVideo)) plan.sourceVideo = urlMap.get(plan.sourceVideo)!
    if (typeof plan.backgroundMedia === "string" && urlMap.has(plan.backgroundMedia)) plan.backgroundMedia = urlMap.get(plan.backgroundMedia)!
    const layers = plan.layers as Array<Record<string, unknown>> | undefined
    if (layers) {
      for (const layer of layers) {
        if (typeof layer.sourceVideo === "string" && urlMap.has(layer.sourceVideo)) layer.sourceVideo = urlMap.get(layer.sourceVideo)!
      }
    }
    return
  }

  const assets = props.mediaAssets as Array<{ src: string }> | undefined
  if (assets) {
    for (const asset of assets) {
      if (urlMap.has(asset.src)) asset.src = urlMap.get(asset.src)!
    }
  }
}

/**
 * Wait until a URL is reachable (HEAD 200). Retries up to `maxAttempts`
 * with exponential backoff. Throws if the URL never becomes available.
 */
async function waitForUrl(url: string, maxAttempts = 8): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) })
      if (res.ok) return
    } catch { /* retry */ }
    const delay = Math.min(1000 * 2 ** i, 10_000)
    await new Promise((r) => setTimeout(r, delay))
  }
  throw new Error(`URL not reachable after ${maxAttempts} attempts: ${url}`)
}

/**
 * Transcode any incompatible input videos to H.264/yuv420p, re-upload to R2,
 * and replace URLs in inputProps. Must be called AFTER plan validation to
 * avoid safeUrlSchema rejecting the replacement URLs (which are still CDN URLs).
 */
async function normalizeInputVideos(
  inputProps: Record<string, unknown>,
  workDir: string,
): Promise<void> {
  const urls = collectVideoUrls(inputProps)
  if (urls.length === 0) return

  const urlMap = new Map<string, string>()

  for (const url of urls) {
    if (urlMap.has(url)) continue
    const localPath = join(workDir, `probe-${randomUUID()}.mp4`)
    await downloadFile(url, localPath)
    const outPath = join(workDir, `norm-${randomUUID()}.mp4`)
    const result = await transcodeToBrowserSafe(localPath, outPath)
    if (result !== localPath) {
      // Upload transcoded file to R2 with a unique key
      const r2Key = `render-input/${randomUUID()}.mp4`
      const newUrl = await uploadFileWithKeyToR2(result, r2Key, "video/mp4")
      await waitForUrl(newUrl)
      urlMap.set(url, newUrl)
      console.log(`[render-worker] Transcoded input video: ${url} -> ${newUrl}`)
    }
  }

  if (urlMap.size > 0) {
    replaceVideoUrls(inputProps, urlMap)
  }
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

        await bullJob.updateProgress(20)

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

        // Transcode input videos to H.264 if Remotion's compositor can't decode them
        await normalizeInputVideos(inputProps, workDir)

        await bullJob.updateProgress(30)

        // FFmpeg fast path: skip Remotion for simple scene graphs (1 video, no effects/text)
        let outputPath: string
        if (isSceneGraphJob(data) && canUseFfmpegFastPath(data.sceneGraph)) {
          console.log(`[render-worker] FFmpeg fast path for job ${jobId}`)
          outputPath = await renderSceneGraphViaFfmpeg(data, workDir, bullJob)
        } else {
          console.log(`[render-worker] Rendering ${compositionId} (${modeLabel}) for job ${jobId}`)

          // Bundle Remotion compositions (cached after first call per entry point)
          const bundlePath = await getBundlePath(compositionId)
          await bullJob.updateProgress(40)

          // Select composition and render
          const { selectComposition, renderMedia } = await import("@remotion/renderer")

          // Allow overriding Remotion's bundled chrome-headless-shell (e.g. custom Docker images)
          const browserExecutable = process.env.CHROME_PATH || undefined

          const composition = await selectComposition({
            serveUrl: bundlePath,
            id: compositionId,
            inputProps,
            browserExecutable,
          })

          outputPath = join(workDir, "output.mp4")

          const remotionConcurrency = config.REMOTION_CONCURRENCY ?? undefined

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
              browserExecutable,
              concurrency: remotionConcurrency,
              onProgress: ({ progress }: { progress: number }) => {
                const overall = 40 + Math.round(progress * 50)
                bullJob.updateProgress(overall).catch(() => {})
              },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Render timed out after 25 minutes")), RENDER_TIMEOUT_MS)
            ),
          ])
        }

        await bullJob.updateProgress(90)

        // Check if job was cancelled during render
        if (!await shouldSaveJobResult(jobId)) {
          await refundJobCredits(effectiveUsageLogId, jobId, "cancelled")
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

        await refundJobCredits(effectiveUsageLogId, jobId, errMsg)

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
