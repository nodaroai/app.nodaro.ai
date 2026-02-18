import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface SpeedRampOptions {
  readonly videoUrl: string
  readonly speed: number
  readonly adjustAudio: boolean
}

/**
 * Build the chain of atempo filters needed for audio speed adjustment.
 * FFmpeg atempo only accepts values in [0.5, 100.0], but for values below 0.5
 * we chain multiple atempo filters (each halving). For high speeds we also chain.
 */
function buildAtempoChain(speed: number): string[] {
  const filters: string[] = []
  let remaining = speed
  // Bring remaining into range by halving or doubling
  while (remaining < 0.5) {
    filters.push("atempo=0.5")
    remaining /= 0.5
  }
  while (remaining > 100.0) {
    filters.push("atempo=100.0")
    remaining /= 100.0
  }
  filters.push(`atempo=${remaining}`)
  return filters
}

export async function speedRamp(options: SpeedRampOptions): Promise<string> {
  const { videoUrl, speed, adjustAudio } = options

  // Clamp speed to a safe range
  const clampedSpeed = Math.max(0.25, Math.min(4.0, speed))

  const workDir = await createWorkDir("speed-ramp")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[speedRamp] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    // setpts=PTS/speed speeds up (speed>1) or slows down (speed<1) video
    const videoFilter = `setpts=PTS/${clampedSpeed}`

    const args = ["-y", "-i", inputPath]

    if (adjustAudio) {
      const audioFilters = buildAtempoChain(clampedSpeed)
      args.push(
        "-filter:v", videoFilter,
        "-filter:a", audioFilters.join(","),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        outputPath,
      )
    } else {
      // Drop audio entirely
      args.push(
        "-filter:v", videoFilter,
        "-an",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        outputPath,
      )
    }

    console.log(`[speedRamp] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[speedRamp] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
