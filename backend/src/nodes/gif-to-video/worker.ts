// @reads-none reads only the GIF it downloads into a work dir
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import { gifToVideo } from "../../providers/video/gif-to-video.js"
import { uploadFileWithKeyToR2, getR2ObjectSize, r2Url } from "../../lib/storage.js"
import { cleanupWorkDir, createWorkDir, downloadFile } from "../../providers/video/ffmpeg-utils.js"
import { commitJobCredits, generateAndUploadThumbnail, markJobCompleted, setJobProgress, shouldSaveJobResult } from "../../workers/shared.js"
import type { UnitWorker } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

// The video-queue handler: download the GIF, convert it to an H.264 MP4
// (providers/video/gif-to-video.ts) — or reuse the content-addressed cached
// MP4 of the same GIF and settings — then thumbnail, complete, commit.
export const worker: UnitWorker = async function handleGifToVideo(job, ctx) {
  const { gifUrl, loopToMinimum, targetDuration, interpolate, alphaBackground } = job.data as {
    jobId: string
    gifUrl: string
    loopToMinimum?: boolean
    targetDuration?: number
    interpolate?: boolean
    alphaBackground?: "white" | "black"
  }
  console.log(`[worker] ${descriptor.type} ${ctx.jobId}: loop=${loopToMinimum} target=${targetDuration}s interp=${interpolate} bg=${alphaBackground}`)
  await setJobProgress(job, ctx.jobId, 3)

  const workDir = await createWorkDir(descriptor.type)
  try {
    const gifPath = join(workDir, "input.gif")
    await downloadFile(gifUrl, gifPath)
    await setJobProgress(job, ctx.jobId, 20)

    // Content-addressed cache: the same reference GIF is reused across many
    // generations, and minterpolate is expensive enough that recomputing it
    // per run is noticeable. Key by the GIF bytes + the conversion params so a
    // settings change misses the cache. On a hit we reuse the already-encoded
    // MP4 and skip conversion entirely.
    const gifBytes = await fs.readFile(gifPath)
    // `v` salts the cache: bump it whenever the conversion pipeline changes so
    // pre-change cached MP4s aren't served (content-addressed caching pins the
    // exact output bytes, bugs included). v2: real GIF-cadence minterpolate.
    const paramsSig = JSON.stringify({ v: 2, loopToMinimum, targetDuration, interpolate, alphaBackground })
    const hash = createHash("sha256").update(gifBytes).update(paramsSig).digest("hex")
    const cacheKey = `videos/gif2mp4/${hash}.mp4`

    let videoUrl: string
    let cached = false
    let meta: Record<string, unknown> = {}
    if (await getR2ObjectSize(cacheKey) > 0) {
      videoUrl = r2Url(cacheKey)
      cached = true
      console.log(`[worker] ${descriptor.type} ${ctx.jobId}: cache hit ${cacheKey}`)
    } else {
      const result = await gifToVideo({
        gifPath, workDir, loopToMinimum, targetDuration, interpolate, alphaBackground,
      })
      await setJobProgress(job, ctx.jobId, 80)
      videoUrl = await uploadFileWithKeyToR2(result.outputPath, cacheKey, "video/mp4", ctx.jobUserId)
      meta = {
        gifSourceFrames: result.sourceFrames,
        gifSourceDuration: result.sourceDurationSeconds,
        outputDuration: result.outputDurationSeconds,
        loopStrategy: result.loopStrategy,
        loops: result.loops,
        seamless: result.seamless,
        interpolated: result.interpolated,
        ...(result.warning ? { warning: result.warning } : {}),
      }
    }

    await cleanupWorkDir(workDir)
    await setJobProgress(job, ctx.jobId, 90)
    const thumbUrl = await generateAndUploadThumbnail(videoUrl, ctx.jobId, ctx.jobUserId)
    await setJobProgress(job, ctx.jobId, 100)

    if (!await shouldSaveJobResult(ctx.jobId)) return
    const ok = await markJobCompleted(ctx.jobId, {
      output_data: { videoUrl, thumbnailUrl: thumbUrl, cached, ...meta },
    })
    if (!ok) return
    await commitJobCredits(ctx.usageLogId, ctx.jobId)
    console.log(`[worker] Job ${ctx.jobId} completed: ${videoUrl}${cached ? " (cached)" : ""}`)
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
