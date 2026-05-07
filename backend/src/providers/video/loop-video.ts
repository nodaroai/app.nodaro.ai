import { join } from "node:path"
import { promises as fs } from "node:fs"
import { downloadFile, runFfmpeg, runFfprobe, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"
import { smartLoopCut, type SmartLoopCutResult } from "./smart-loop-cut.js"

interface LoopVideoOptions {
  readonly videoUrl: string
  readonly mode: "repeat" | "duration"
  readonly repeatCount?: number
  readonly targetDuration?: number
  /** Smart loop cut preprocess: trim the input to its cleanest loop
   *  boundary BEFORE concatenating. Eliminates seam discontinuity at
   *  every internal repeat boundary, not just the final wrap. */
  readonly smartLoopCutBeforeRepeat?: boolean
  readonly smartLoopCutLookback?: number
}

export interface LoopVideoResult {
  readonly outputPath: string
  /** Populated when `smartLoopCutBeforeRepeat: true`. Useful for
   *  surfacing the chosen frame / PSNR back to the caller / UI. */
  readonly smartLoopCutMeta?: Pick<SmartLoopCutResult, "chosenFrameIndex" | "psnr" | "sourceFrameCount" | "fps">
}

export async function loopVideo(options: LoopVideoOptions): Promise<LoopVideoResult> {
  const { videoUrl, mode, repeatCount = 2, targetDuration = 10, smartLoopCutBeforeRepeat = false, smartLoopCutLookback } = options
  const workDir = await createWorkDir("loop-video")

  try {
    let inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")
    let smartLoopCutMeta: LoopVideoResult["smartLoopCutMeta"]

    console.log(`[loopVideo] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    if (smartLoopCutBeforeRepeat) {
      console.log(`[loopVideo] Applying smart loop cut before repeat (lookback=${smartLoopCutLookback ?? 16})`)
      const slc = await smartLoopCut({ videoUrl, lookbackFrames: smartLoopCutLookback })
      // Replace the input with the smart-cut output for the concat step.
      inputPath = slc.videoPath
      smartLoopCutMeta = {
        chosenFrameIndex: slc.chosenFrameIndex,
        psnr: slc.psnr,
        sourceFrameCount: slc.sourceFrameCount,
        fps: slc.fps,
      }
    }

    if (mode === "repeat") {
      // Use concat with filelist repeated N times
      const escapedPath = inputPath.replace(/'/g, "'\\''")
      const lines = Array.from({ length: repeatCount }, () => `file '${escapedPath}'`)
      const listPath = join(workDir, "filelist.txt")
      await fs.writeFile(listPath, lines.join("\n"))

      console.log(`[loopVideo] Repeating ${repeatCount} times via concat`)
      await runFfmpeg([
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c", "copy", outputPath,
      ])
    } else {
      // Loop to target duration: get clip duration first
      const durationStr = await runFfprobe([
        "-v", "error", "-show_entries", "format=duration",
        "-of", "csv=p=0", inputPath,
      ])
      const clipDuration = parseFloat(durationStr.trim())
      if (Number.isNaN(clipDuration) || clipDuration <= 0) {
        throw new Error("Could not determine clip duration")
      }

      const timesNeeded = Math.ceil(targetDuration / clipDuration)
      const escapedPath = inputPath.replace(/'/g, "'\\''")
      const lines = Array.from({ length: timesNeeded }, () => `file '${escapedPath}'`)
      const listPath = join(workDir, "filelist.txt")
      await fs.writeFile(listPath, lines.join("\n"))

      console.log(`[loopVideo] Looping ${timesNeeded} times to reach ${targetDuration}s (clip=${clipDuration}s)`)
      // Concat then trim to exact targetDuration
      await runFfmpeg([
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-t", String(targetDuration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        outputPath,
      ])
    }

    console.log(`[loopVideo] Output: ${outputPath}`)
    return { outputPath, smartLoopCutMeta }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
