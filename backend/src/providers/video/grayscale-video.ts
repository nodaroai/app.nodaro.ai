import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

/**
 * Re-encode a video as grayscale (luma only, rounded down to even dimensions —
 * libx264 cannot write 4:2:0 at an odd size — then back to yuv420p so every
 * player accepts it). Used by the `video-depth` worker to turn the Replicate
 * depth model's native inferno-colorized output into the grayscale depth map
 * the node defaults to (`videoDepthNeedsGrayscalePass`). Audio is dropped —
 * a depth map has none.
 *
 * Returns the output path AND its work dir: the caller uploads the file and
 * then owns `cleanupWorkDir(workDir)`. On failure the work dir is cleaned here.
 */
export async function grayscaleVideo(videoUrl: string): Promise<{ outputPath: string; workDir: string }> {
  const workDir = await createWorkDir("grayscale-video")
  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")
    await downloadFile(videoUrl, inputPath)
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-vf", "format=gray,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-an", "-movflags", "+faststart",
      outputPath,
    ])
    return { outputPath, workDir }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
