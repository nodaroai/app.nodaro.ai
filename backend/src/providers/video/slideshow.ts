/**
 * Slideshow — N still images over one (optional) audio track → MP4, local
 * FFmpeg only. Companion to still-to-video (exactly one image); this node
 * exists so N images don't force N still-to-video nodes into combine-videos.
 *
 * Pipeline (matches the node's progress disclosure):
 *   1. one SILENT segment per image at its planned slot length
 *      (still-segment.ts — the same geometry/zoompan/intensity builder
 *      still-to-video uses; segments are identical in
 *      resolution/fps/pix_fmt/SAR by construction, setsar=1 included),
 *   2. concat — `cut` → concat demuxer with stream copy; any real
 *      transition → chained xfade at the planner's exact offsets
 *      (transitions consume the OUTGOING slide; total stays exact),
 *   3. mux the audio once over the finished video (`-c:a aac -b:a 192k
 *      -shortest`) — or skip entirely when no audio is wired (silent file,
 *      no audio stream at all).
 *
 * All timing comes from computeSlideshowPlan (slideshow-timing.ts) — integer
 * frame math, no cumulative drift, scale disclosure in `scaleFactor`.
 */
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { COMBINE_TRANSITIONS } from "@nodaro/shared"
import {
  createWorkDir,
  cleanupWorkDir,
  downloadFile,
  runFfmpeg,
  runFfprobe,
  runFfmpegWithProgress,
  probeMediaDuration,
} from "./ffmpeg-utils.js"
import {
  buildSilentSegmentArgs,
  computeTargetDimensions,
  type StillResolution,
  type StillAspectRatio,
  type StillFit,
} from "./still-segment.js"
import {
  computeSlideshowPlan,
  resolveSlideMotion,
  type SlideshowMotion,
  type SlideshowPlan,
} from "./slideshow-timing.js"

export interface SlideshowOptions {
  readonly imageUrls: readonly string[]
  readonly audioUrl?: string
  /** Per-image pinned durations (seconds); null = auto. Length must match imageUrls when present. */
  readonly imageDurations?: ReadonlyArray<number | null>
  readonly perImageDuration: number
  readonly transition: string
  readonly transitionDuration: number
  readonly motion: SlideshowMotion
  readonly intensity: number
  readonly resolution: StillResolution
  readonly aspectRatio: StillAspectRatio
  readonly fps: number
  readonly fit: StillFit
  readonly padColor: string
  /** (phase, done, total) — phases mirror the worker's real stages. */
  readonly onProgress?: (phase: "segments" | "concat" | "mux", done: number, total: number) => void
}

export interface SlideshowResult {
  readonly outputPath: string
  readonly durationSeconds: number
  readonly slideCount: number
  /** Case C disclosure — proportional scale applied to pinned durations. */
  readonly scaleFactor: number | null
  /** The xfade transition actually applied ("cut" for concat). */
  readonly appliedTransition: string
  readonly transitionClamped: boolean
  readonly silent: boolean
}

const DOWNLOAD_CONCURRENCY = 4

async function probeImageDimensions(path: string): Promise<{ width: number; height: number }> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    path,
  ])
  const [w, h] = output.trim().split(",").map((p) => parseInt(p.trim(), 10))
  if (!w || !h || Number.isNaN(w) || Number.isNaN(h)) {
    throw new Error(`slideshow: could not read image dimensions ("${output.trim()}")`)
  }
  return { width: w, height: h }
}

/** Bounded-concurrency download pool — up to 100 images must not open 100 sockets. */
async function downloadAll(urls: readonly string[], workDir: string): Promise<string[]> {
  const paths = urls.map((_, i) => join(workDir, `image-${String(i).padStart(3, "0")}.png`))
  let next = 0
  const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, urls.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= urls.length) return
      await downloadFile(urls[i]!, paths[i]!)
    }
  })
  await Promise.all(workers)
  return paths
}

function xfadeNameFor(transitionId: string): string | null {
  return COMBINE_TRANSITIONS.find((t) => t.id === transitionId)?.xfade ?? null
}

export async function slideshow(options: SlideshowOptions): Promise<SlideshowResult> {
  const workDir = await createWorkDir("slideshow")

  try {
    const n = options.imageUrls.length
    console.log(`[slideshow] ${n} images, transition=${options.transition}, motion=${options.motion}`)

    // 1. Inputs: images (bounded pool) + optional audio, then probes.
    const imagePaths = await downloadAll(options.imageUrls, workDir)
    let audioPath: string | undefined
    let audioDuration: number | undefined
    if (options.audioUrl) {
      audioPath = join(workDir, "input-audio.mp3")
      await downloadFile(options.audioUrl, audioPath)
      audioDuration = await probeMediaDuration(audioPath)
    }

    // 2. The plan — every number downstream derives from these integers.
    const plan: SlideshowPlan = computeSlideshowPlan({
      imageCount: n,
      fps: options.fps,
      audioDurationSeconds: audioDuration,
      perImageDurationSeconds: options.perImageDuration,
      overrides: options.imageDurations,
      transitionSeconds: options.transitionDuration,
      transitionId: options.transition,
    })
    const { width, height } = computeTargetDimensions(options.resolution, options.aspectRatio)
    const appliedTransition = plan.transitionFrames > 0 ? options.transition : "cut"
    console.log(
      `[slideshow] plan: total=${plan.totalFrames}f @${options.fps} ${width}x${height} ` +
        `transition=${appliedTransition}(${plan.transitionFrames}f)` +
        `${plan.scaleFactor ? ` scale=x${plan.scaleFactor.toFixed(3)}` : ""}`,
    )

    // 3. One silent segment per image (identical format by construction).
    const segmentPaths: string[] = []
    for (let i = 0; i < n; i++) {
      const source = await probeImageDimensions(imagePaths[i]!)
      const segPath = join(workDir, `segment-${String(i).padStart(3, "0")}.mp4`)
      const args = buildSilentSegmentArgs({
        imagePath: imagePaths[i]!,
        outputPath: segPath,
        motion: resolveSlideMotion(options.motion, i),
        intensity: options.intensity,
        width,
        height,
        fps: options.fps,
        frames: plan.segmentFrames[i]!,
        fit: options.fit,
        padColor: options.padColor,
        sourceWidth: source.width,
        sourceHeight: source.height,
      })
      await runFfmpeg(args)
      segmentPaths.push(segPath)
      options.onProgress?.("segments", i + 1, n)
    }

    // 4. Concat.
    const silentVideoPath = join(workDir, "silent.mp4")
    if (plan.transitionFrames === 0) {
      // cut → concat demuxer, stream copy (segments are format-identical).
      const listPath = join(workDir, "concat.txt")
      await fs.writeFile(
        listPath,
        segmentPaths.map((p) => `file '${p}'`).join("\n") + "\n",
      )
      await runFfmpeg([
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listPath,
        "-c", "copy",
        silentVideoPath,
      ])
    } else {
      // xfade chain at the planner's exact offsets.
      const xfadeName = xfadeNameFor(appliedTransition) ?? "fade"
      const td = plan.transitionFrames / options.fps
      const inputs = segmentPaths.flatMap((p) => ["-i", p])
      const stages: string[] = []
      for (let k = 0; k < n - 1; k++) {
        const a = k === 0 ? "[0:v]" : `[x${k - 1}]`
        const b = `[${k + 1}:v]`
        const out = k === n - 2 ? "[vout]" : `[x${k}]`
        stages.push(
          `${a}${b}xfade=transition=${xfadeName}:duration=${td.toFixed(6)}:offset=${plan.xfadeOffsetsSeconds[k]!.toFixed(6)}${out}`,
        )
      }
      await runFfmpegWithProgress(
        ["-y", ...inputs, "-filter_complex", stages.join(";"), "-map", "[vout]",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
          "-r", String(options.fps), "-an", silentVideoPath],
        (frame) => options.onProgress?.("concat", Math.min(frame, plan.totalFrames), plan.totalFrames),
      )
    }

    // 5. Mux the audio once — or ship the silent file as-is (NO audio stream).
    let outputPath: string
    if (audioPath) {
      outputPath = join(workDir, "output.mp4")
      options.onProgress?.("mux", 0, 1)
      await runFfmpeg([
        "-y",
        "-i", silentVideoPath,
        "-i", audioPath,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        outputPath,
      ])
      options.onProgress?.("mux", 1, 1)
    } else {
      outputPath = join(workDir, "output.mp4")
      // Re-mux for +faststart so the silent result still streams in a browser.
      await runFfmpeg(["-y", "-i", silentVideoPath, "-c", "copy", "-movflags", "+faststart", outputPath])
    }

    return {
      outputPath,
      durationSeconds: audioDuration ?? plan.totalFrames / options.fps,
      slideCount: n,
      scaleFactor: plan.scaleFactor,
      appliedTransition,
      transitionClamped: plan.transitionClamped,
      silent: plan.silent,
    }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
