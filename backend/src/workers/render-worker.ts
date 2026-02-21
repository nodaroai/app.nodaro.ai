import { Worker } from "bullmq"
import IORedis from "ioredis"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { uploadFileToR2 } from "../lib/storage.js"
import { createWorkDir, cleanupWorkDir, downloadFile, runFfmpeg, needsTranscode, transcodeToBrowserSafe, BROWSER_SAFE_VIDEO_ARGS, REMOTION_INPUT_VIDEO_ARGS } from "../providers/video/ffmpeg-utils.js"
import { applyVideoWatermark } from "../utils/watermark.js"
import { commitJobCredits, refundJobCredits, shouldSaveJobResult, generateAndUploadThumbnail, createAssetFromJob } from "./shared.js"
import { createServer } from "node:http"
import { createReadStream, statSync } from "node:fs"
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

export interface SceneGraphData extends Record<string, unknown> {
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

export function isPlanJob(data: RenderJobData): data is PlanRenderJobData {
  return "planType" in data && data.planType != null
}

export function isSceneGraphJob(data: RenderJobData): data is SceneGraphRenderJobData {
  return "sceneGraph" in data && data.sceneGraph != null
}

// Cache Remotion bundles after first build.
// Two separate bundles: main (all non-3D compositions) and 3D (r3f-based).
// @react-three/fiber creates its own React reconciler at module init time,
// which conflicts with Remotion's reconciler and crashes ALL compositions
// if bundled together.
// Cache the PROMISE (not the result) so concurrent callers (pre-warm + job)
// share the same in-flight build instead of starting duplicate webpack builds.
let mainBundlePromise: Promise<string> | null = null
let threeDBundlePromise: Promise<string> | null = null

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

function getBundlePath(compositionId: string): Promise<string> {
  if (compositionId === "3d-title") {
    if (!threeDBundlePromise) {
      threeDBundlePromise = bundleEntry("Root3D.tsx", "3D compositions", true).catch((err) => {
        threeDBundlePromise = null
        throw err
      })
    }
    return threeDBundlePromise
  }
  if (!mainBundlePromise) {
    mainBundlePromise = bundleEntry("Root.tsx", "main compositions", false).catch((err) => {
      mainBundlePromise = null
      throw err
    })
  }
  return mainBundlePromise
}


/**
 * Build composition ID and input props for generic plan mode.
 * Routes to the composition matching the planType (e.g. "after-effects").
 */
export function buildPlanRender(data: PlanRenderJobData): {
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
export function buildSceneGraphRender(data: SceneGraphRenderJobData): {
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
export function canUseFfmpegFastPath(sceneGraph: SceneGraphData): boolean {
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
export function buildLegacyRender(data: LegacyRenderJobData): {
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
// Remotion's OffthreadVideo compositor must download videos in full before
// extracting frames.  The Cloudflare R2 CDN sometimes closes connections
// mid-download ("Request closed"), crashing the compositor.
// To work around this we download input videos to disk, transcode to H.264
// if needed, and serve them from a local HTTP server so the compositor
// fetches from localhost instead of the CDN.

const VIDEO_URL_RE = /^https?:\/\/.+\.(mp4|mov|webm)(\?.*)?$/i

/** Collect all video URLs from Remotion inputProps. */
export function collectVideoUrls(props: Record<string, unknown>): string[] {
  const urls: string[] = []

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

  const assets = props.mediaAssets as Array<{ src: string; type: string }> | undefined
  if (assets) {
    for (const asset of assets) {
      if (asset.type === "video") urls.push(asset.src)
    }
  }
  return [...new Set(urls)]
}

/** Replace video URLs in Remotion inputProps using a URL map. */
export function replaceVideoUrls(props: Record<string, unknown>, urlMap: Map<string, string>): void {
  const sg = props.sceneGraph as Record<string, unknown> | undefined
  if (sg) {
    for (const track of (sg.tracks as Array<Record<string, unknown>>)) {
      const segments = track.segments as Array<Record<string, unknown>> | undefined
      if (segments) {
        for (const seg of segments) {
          if (seg.mediaType === "video" && typeof seg.src === "string" && urlMap.has(seg.src)) seg.src = urlMap.get(seg.src)!
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
 * Start a lightweight HTTP server that serves video files from a directory.
 * Supports HTTP Range requests (required by some Remotion internals).
 */
function startLocalFileServer(serveDir: string): Promise<{ baseUrl: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const fileName = decodeURIComponent(req.url?.slice(1) ?? "")

      // Only serve flat filenames — prevent path traversal
      if (!fileName || fileName.includes("..") || fileName.includes("/")) {
        res.writeHead(403)
        res.end("Forbidden")
        return
      }

      const filePath = join(serveDir, fileName)
      try {
        const fileStat = statSync(filePath)
        const fileSize = fileStat.size
        const rangeHeader = req.headers.range

        const headers: Record<string, string | number> = {
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        }

        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
          if (match) {
            const start = parseInt(match[1], 10)
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
            if (start >= fileSize || end >= fileSize || start > end) {
              res.writeHead(416, { "Content-Range": `bytes */${fileSize}` })
              res.end()
              return
            }
            headers["Content-Range"] = `bytes ${start}-${end}/${fileSize}`
            headers["Content-Length"] = end - start + 1
            res.writeHead(206, headers)
            createReadStream(filePath, { start, end }).pipe(res)
            return
          }
        }

        headers["Content-Length"] = fileSize
        res.writeHead(200, headers)
        createReadStream(filePath).pipe(res)
      } catch {
        res.writeHead(404)
        res.end("Not found")
      }
    })

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      })
    })
    server.on("error", reject)
  })
}

/**
 * Download input videos, transcode to H.264 if needed, and serve them from
 * a local HTTP server so the Remotion compositor fetches from localhost
 * instead of the CDN. Must be called AFTER plan validation (buildPlanRender
 * etc.) to avoid safeUrlSchema rejecting the localhost replacement URLs.
 * Returns a cleanup function to stop the server (or undefined if no videos found).
 */
async function normalizeInputVideos(
  inputProps: Record<string, unknown>,
  workDir: string,
): Promise<(() => void) | undefined> {
  const urls = collectVideoUrls(inputProps)
  if (urls.length === 0) return undefined

  const fileMap = new Map<string, string>() // original URL → local filename

  for (const url of urls) {
    if (fileMap.has(url)) continue
    const inputName = `input-${randomUUID()}.mp4`
    const localPath = join(workDir, inputName)
    await downloadFile(url, localPath)

    // Always transcode with all-intra keyframes (-g 1) so Remotion's
    // compositor can seek to any frame instantly instead of decoding from
    // a distant keyframe (which caused ~33s per frame extraction).
    const outName = `norm-${randomUUID()}.mp4`
    const outPath = join(workDir, outName)
    await runFfmpeg([
      "-y", "-i", localPath,
      ...REMOTION_INPUT_VIDEO_ARGS,
      "-an",
      outPath,
    ], 300_000) // 5 minute timeout — all-intra encode is slow but shouldn't exceed this
    fileMap.set(url, outName)
    console.log(`[render-worker] Prepared input video: ${url} -> ${outName} (remotion-optimized)`)
  }

  const { baseUrl, close } = await startLocalFileServer(workDir)

  // Verify the server is working before proceeding
  const testFile = [...fileMap.values()][0]
  const testUrl = `${baseUrl}/${testFile}`
  try {
    const res = await fetch(testUrl, { method: "HEAD", signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`HEAD returned ${res.status}`)
    const expectedSize = statSync(join(workDir, testFile)).size
    const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10)
    if (contentLength !== expectedSize) throw new Error(`Size mismatch: ${contentLength} vs ${expectedSize}`)
    console.log(`[render-worker] Local file server verified: ${baseUrl} (${fileMap.size} video(s))`)
  } catch (err) {
    close()
    throw new Error(`Local file server verification failed for ${testUrl}: ${err}`)
  }

  // Replace CDN URLs with localhost URLs
  const urlMap = new Map<string, string>()
  for (const [originalUrl, fileName] of fileMap) {
    urlMap.set(originalUrl, `${baseUrl}/${fileName}`)
  }
  replaceVideoUrls(inputProps, urlMap)

  return close
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

    for (const entry of entries) {
      if (!entry.startsWith("render-")) continue
      const fullPath = join(tmp, entry)
      try {
        const s = await stat(fullPath)
        if (!s.isDirectory()) continue
        if (now - s.mtimeMs > maxAge) {
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

      console.log(`[render-worker] Job ${jobId} picked up (tier=${userTier})`)

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

        console.log(`[render-worker] Job ${jobId}: mode=${modeLabel}, composition=${compositionId}, ${width}x${height} ${fps}fps ${durationInFrames}fr`)
        await bullJob.updateProgress(30)

        // FFmpeg fast path: skip Remotion for simple scene graphs (1 video, no effects/text)
        let outputPath: string
        if (isSceneGraphJob(data) && canUseFfmpegFastPath(data.sceneGraph)) {
          console.log(`[render-worker] FFmpeg fast path for job ${jobId}`)
          outputPath = await renderSceneGraphViaFfmpeg(data, workDir, bullJob)
        } else {
          // Remotion path — pre-download input videos and serve from localhost
          // so the compositor doesn't rely on CDN downloads (which often fail
          // with "Request closed" errors on Cloudflare R2).
          console.log(`[render-worker] Job ${jobId}: normalizing input videos...`)
          const t0 = Date.now()
          const stopFileServer = await normalizeInputVideos(inputProps, workDir)
          console.log(`[render-worker] Job ${jobId}: input videos ready (${((Date.now() - t0) / 1000).toFixed(1)}s)`)

          try {
            console.log(`[render-worker] Rendering ${compositionId} (${modeLabel}) for job ${jobId}`)

            // Bundle Remotion compositions (cached after first call per entry point)
            const bundlePath = await getBundlePath(compositionId)
            console.log(`[render-worker] Bundle ready for ${compositionId}: ${bundlePath}`)
            await bullJob.updateProgress(40)

            // Select composition and render
            const { selectComposition, renderMedia } = await import("@remotion/renderer")

            // Allow overriding Remotion's bundled chrome-headless-shell (e.g. custom Docker images)
            const browserExecutable = process.env.CHROME_PATH || undefined

            console.log(`[render-worker] selectComposition(${compositionId}) starting...`)
            const composition = await selectComposition({
              serveUrl: bundlePath,
              id: compositionId,
              inputProps,
              browserExecutable,
              timeoutInMilliseconds: 120_000,
            })
            console.log(`[render-worker] selectComposition(${compositionId}) done: ${composition.width}x${composition.height} ${composition.fps}fps ${composition.durationInFrames}fr`)

            outputPath = join(workDir, "output.mp4")

            const remotionConcurrency = config.REMOTION_CONCURRENCY ?? undefined

            // Warn about expensive motion effects that multiply render time
            const planEffects = (inputProps.plan as Record<string, unknown> | undefined)?.effects as Array<{ type: string; samples?: number; layers?: number }> | undefined
            if (planEffects) {
              const mb = planEffects.find((e) => e.type === "motion-blur")
              const tr = planEffects.find((e) => e.type === "trail")
              const multiplier = (mb?.samples ?? 1) * ((tr?.layers ?? 0) + 1)
              if (multiplier > 1) {
                console.log(`[render-worker] Job ${jobId}: motion effects multiplier ${multiplier}x (${durationInFrames} frames → ~${durationInFrames * multiplier} renders)`)
              }
            }

            console.log(`[render-worker] renderMedia(${compositionId}) starting... output: ${outputPath}`)
            const RENDER_TIMEOUT_MS = 25 * 60 * 1000
            let timer: ReturnType<typeof setTimeout> | undefined
            let lastLoggedPct = -10
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
                timeoutInMilliseconds: 120_000,
                logLevel: "warn",
                onProgress: ({ progress, renderedFrames, encodedFrames }: { progress: number; renderedFrames: number; encodedFrames: number }) => {
                  const overall = 40 + Math.round(progress * 50)
                  bullJob.updateProgress(overall).catch(() => {})
                  const pct = Math.floor(progress * 100)
                  if (pct >= lastLoggedPct + 10 || (progress >= 1 && lastLoggedPct < 100)) {
                    lastLoggedPct = pct
                    console.log(`[render-worker] Job ${jobId}: render ${pct}% (${renderedFrames} rendered, ${encodedFrames} encoded)`)
                  }
                },
              }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Render timed out after 25 minutes")), RENDER_TIMEOUT_MS)
              }),
            ]).finally(() => clearTimeout(timer))
          } finally {
            stopFileServer?.()
          }
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

        // Create asset records so rendered media appears in /library
        await createAssetFromJob(jobId, jobUserId)

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
