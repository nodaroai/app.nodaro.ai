import {
  runFfmpeg,
  downloadFile,
  createWorkDir,
  cleanupWorkDir,
  probeVideoSource,
  BROWSER_SAFE_VIDEO_ARGS,
} from "../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../lib/storage.js"
import sharp from "sharp"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Slot } from "./types.js"

const even = (n: number) => Math.max(2, Math.floor(n) - (Math.floor(n) % 2))

/**
 * PURE: build the ffmpeg args to overlay N clips onto a looped background image,
 * each scaled (cover) into its slot, all bounded to `durationSec`. Net-new filter
 * (no `overlay`/`-loop 1` precedent in the repo) — structured like combineVideos:
 * one process, one filter graph, browser-safe H.264 out.
 *
 * Each clip is scaled to fill its slot (cover) then center-cropped to the exact
 * even slot size (yuv420p needs even dims), de-timed to start at 0, and trimmed
 * to the duration; then chained overlay=x:y places each onto the previous layer.
 * With zero clips the background is emitted as a static video (no filter graph).
 */
export function buildMotionFfmpegArgs(
  bgPath: string,
  clips: { path: string; slot: Slot }[],
  durationSec: number,
  outPath: string,
): string[] {
  const d = String(durationSec)
  const args: string[] = ["-y", "-loop", "1", "-t", d, "-i", bgPath]
  for (const c of clips) args.push("-i", c.path)

  if (clips.length === 0) {
    args.push("-map", "0:v", "-t", d, "-an", ...BROWSER_SAFE_VIDEO_ARGS, outPath)
    return args
  }

  const filters: string[] = []
  clips.forEach((c, i) => {
    const w = even(c.slot.w)
    const h = even(c.slot.h)
    // Input i+1 (input 0 is the bg). Scale to cover the slot, crop to its exact
    // even size, normalize SAR, then bound to the sheet duration starting at 0.
    filters.push(
      `[${i + 1}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,trim=duration=${d},setpts=PTS-STARTPTS[v${i}]`,
    )
  })
  let last = "0:v"
  clips.forEach((c, i) => {
    const out = i === clips.length - 1 ? "outv" : `b${i}`
    filters.push(`[${last}][v${i}]overlay=${Math.round(c.slot.x)}:${Math.round(c.slot.y)}[${out}]`)
    last = out
  })
  args.push("-filter_complex", filters.join(";"), "-map", "[outv]", "-t", d, "-an", ...BROWSER_SAFE_VIDEO_ARGS, outPath)
  return args
}

/**
 * Render the motion sheet: write the bg PNG, download clips, run the overlay
 * filter, upload the MP4. Returns the R2 URL. Compose-only — `clipUrls` are the
 * already-present motion clips (one per slot, in order). NOT unit-tested (needs
 * ffmpeg + fixtures); the PURE `buildMotionFfmpegArgs` above is the tested core.
 */
export async function composeMotionSheet(opts: {
  jobId: string
  /** Storage-tracking user id; optional (best-effort) to mirror the still path's
   *  upload, where `ctx.jobUserId` may be undefined. */
  userId: string | undefined
  backgroundPng: Buffer
  slots: Slot[]
  clipUrls: string[]
}): Promise<string> {
  const work = await createWorkDir("ref-sheet-motion")
  try {
    const bgPath = join(work, "bg.png")
    await writeFile(bgPath, await sharp(opts.backgroundPng).png().toBuffer())

    // Pair each clip with its slot (Nth clip → Nth slot); ignore extras of either.
    // Download + probe all N clips in PARALLEL (large video payloads — serializing
    // them was the bottleneck). Each writes its own c${i}.mp4 so there's no
    // contention; results stay index-ordered so clip i → slots[i] is preserved.
    const n = Math.min(opts.clipUrls.length, opts.slots.length)
    const probed = await Promise.all(
      Array.from({ length: n }, async (_unused, i) => {
        const p = join(work, `c${i}.mp4`)
        await downloadFile(opts.clipUrls[i], p)
        let durationSeconds = 0
        try {
          const probe = await probeVideoSource(p)
          durationSeconds = probe.durationSeconds
        } catch {
          /* keep default duration when a probe fails */
        }
        return { path: p, slot: opts.slots[i], durationSeconds }
      }),
    )
    const clips: { path: string; slot: Slot }[] = probed.map(({ path, slot }) => ({ path, slot }))
    let minDur = 6
    for (const { durationSeconds } of probed) {
      if (durationSeconds > 0) minDur = Math.min(minDur, durationSeconds)
    }
    const duration = Math.max(2, Math.round(minDur))
    const outPath = join(work, "sheet.mp4")
    await runFfmpeg(buildMotionFfmpegArgs(bgPath, clips, duration, outPath))
    return await uploadFileWithKeyToR2(outPath, `reference-sheets/${opts.jobId}.mp4`, "video/mp4", opts.userId)
  } finally {
    await cleanupWorkDir(work)
  }
}
