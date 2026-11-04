// The video-queue handler: measure the clip's shots
// (providers/video/shot-cuts.ts), upload every saved frame, then complete with
// the result on `json` and, with frames on, the first and last frames in shot
// order on their own keys, so each lands on its own output.
import { SHOT_CUTS_UPLOAD_CONCURRENCY, measureShotCuts, type Shot, type ShotCutsResult } from "../../providers/video/shot-cuts.js"
import { cleanupWorkDir } from "../../providers/video/ffmpeg-utils.js"
import { uploadFileToR2 } from "../../lib/storage.js"
import { commitJobCredits, markJobCompleted, setJobProgress, shouldSaveJobResult } from "../../workers/shared.js"
import type { UnitWorker } from "../kit.js"
import { descriptor } from "./descriptor.generated.js"

/** Upload each frame once (a one-frame shot's first frame is its last), by frame number. */
async function uploadFrames(paths: ReadonlyMap<number, string>, jobId: string, userId: string | undefined): Promise<Map<number, string>> {
  const entries = [...paths]
  const urls = new Map<number, string>()
  for (let i = 0; i < entries.length; i += SHOT_CUTS_UPLOAD_CONCURRENCY) {
    const batch = entries.slice(i, i + SHOT_CUTS_UPLOAD_CONCURRENCY)
    const done = await Promise.all(batch.map(async ([n, path]) => [n, await uploadFileToR2(path, `${jobId}-frame-${n}`, "image", userId)] as const))
    for (const [n, url] of done) urls.set(n, url)
  }
  return urls
}

export const worker: UnitWorker = async function handleShotCuts(job, ctx) {
  const { videoUrl, frames } = job.data as { jobId: string; videoUrl: string; frames?: boolean }
  console.log(`[worker] ${descriptor.type} ${ctx.jobId} (frames: ${frames === true})`)
  const measured = await measureShotCuts({ videoUrl, frames: frames === true })
  await setJobProgress(job, ctx.jobId, 60)

  let shots: Shot[]
  try {
    const urls = measured.framePaths ? await uploadFrames(measured.framePaths, ctx.jobId, ctx.jobUserId) : undefined
    shots = measured.shots.map(({ firstFrame, lastFrame, ...shot }) => (urls
      ? { ...shot, firstFrameUrl: urls.get(firstFrame), lastFrameUrl: urls.get(lastFrame) }
      : shot))
  } finally {
    await cleanupWorkDir(measured.workDir)
  }

  const result: ShotCutsResult = { shotCount: shots.length, cutsSec: measured.cutsSec, durationSec: measured.durationSec, shots }
  await setJobProgress(job, ctx.jobId, 100)
  if (!await shouldSaveJobResult(ctx.jobId)) return
  const ok = await markJobCompleted(ctx.jobId, {
    output_data: {
      json: result,
      ...(measured.framePaths
        ? { firstFrames: shots.map((s) => s.firstFrameUrl), lastFrames: shots.map((s) => s.lastFrameUrl) }
        : {}),
    },
  })
  if (!ok) return
  await commitJobCredits(ctx.usageLogId, ctx.jobId)
  console.log(`[worker] Job ${ctx.jobId} completed: ${result.shotCount} shots`)
}
