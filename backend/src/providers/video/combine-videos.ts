import { promises as fs } from "node:fs"
import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, getVideoDuration, createWorkDir, cleanupWorkDir, normalizeVideoForCombine } from "./ffmpeg-utils.js"

interface CombineOptions {
  readonly videoUrls: readonly string[]
  readonly transition: "cut" | "fade" | "dissolve" | "dip-to-black" | "dip-to-white"
  readonly transitionDuration: number
  readonly audioMode: "keep" | "crossfade" | "remove"
  readonly trimStartFrames: number
  readonly trimEndFrames: number
}

/**
 * Probe the frame rate of a video file.
 */
async function getVideoFps(filePath: string): Promise<number> {
  const output = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=r_frame_rate",
    "-of", "csv=p=0",
    filePath,
  ])
  // r_frame_rate is a fraction like "24/1" or "30000/1001"
  const [num, den] = output.trim().split("/").map(Number)
  if (!num || !den) return 24
  return num / den
}

/**
 * Trim frames from start and/or end of a video clip.
 * Returns the path to the trimmed file (or the original if no trimming needed).
 */
async function trimClipFrames(
  inputPath: string,
  workDir: string,
  index: number,
  trimStartFrames: number,
  trimEndFrames: number,
): Promise<string> {
  if (trimStartFrames <= 0 && trimEndFrames <= 0) return inputPath

  const fps = await getVideoFps(inputPath)
  const duration = await getVideoDuration(inputPath)
  const startSec = trimStartFrames / fps
  const endTrimSec = trimEndFrames / fps

  // Don't trim more than the clip length
  if (startSec + endTrimSec >= duration) {
    console.log(`[combineVideos] Trim would exceed clip ${index} duration (${duration.toFixed(2)}s), skipping`)
    return inputPath
  }

  const outputPath = join(workDir, `trimmed_${index}.mp4`)
  const args = ["-y", "-i", inputPath]
  if (trimStartFrames > 0) args.push("-ss", String(startSec))
  if (trimEndFrames > 0) args.push("-to", String(duration - endTrimSec))
  args.push("-c:v", "libx264", "-preset", "fast", "-c:a", "aac", outputPath)

  await runFfmpeg(args)
  return outputPath
}

/**
 * Map user-facing transition names to FFmpeg xfade transition types.
 * "dissolve" and "dip-to-black/white" both use "fade"; dip variants
 * are handled by inserting black/white frames between clips.
 */
function resolveXfadeTransition(transition: CombineOptions["transition"]): string {
  if (transition === "dissolve" || transition === "dip-to-black" || transition === "dip-to-white") {
    return "fade"
  }
  return transition
}

/**
 * Generate a solid-color clip (black or white) of the given duration and
 * resolution to act as an intermediate for dip-to-black / dip-to-white.
 */
async function generateColorClip(
  workDir: string,
  index: number,
  durationSec: number,
  color: "black" | "white",
  width: number,
  height: number,
): Promise<string> {
  const outputPath = join(workDir, `${color}_${index}.mp4`)
  await runFfmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=${width}x${height}:d=${durationSec}:r=24`,
    "-f", "lavfi",
    "-i", `anullsrc=r=44100:cl=stereo`,
    "-t", String(durationSec),
    "-c:v", "libx264",
    "-preset", "fast",
    "-c:a", "aac",
    outputPath,
  ])
  return outputPath
}

/**
 * Check whether a file contains at least one audio stream.
 */
async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const output = await runFfprobe([
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      filePath,
    ])
    return output.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Probe the resolution of a video file (width x height). Falls back to
 * 1920x1080 if the probe fails or returns something unparseable — a missing
 * resolution shouldn't abort the whole combine.
 */
async function getVideoResolution(filePath: string): Promise<{ width: number; height: number }> {
  try {
    const output = await runFfprobe([
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x",
      filePath,
    ])
    const [w, h] = output.trim().split("x").map(Number)
    return { width: w || 1920, height: h || 1080 }
  } catch {
    return { width: 1920, height: 1080 }
  }
}

/**
 * Pick the resolution every clip will be normalized to before combining.
 * xfade/acrossfade and the concat filter all require identical input
 * dimensions, so one odd-sized clip in the set would otherwise abort the
 * whole job. We take the most common (width, height) — ties broken by
 * largest area — so the common case (all clips already match) is a no-op,
 * and a lone mismatched clip gets letterboxed to fit the majority.
 */
async function pickTargetResolution(
  paths: readonly string[],
): Promise<{ width: number; height: number }> {
  const resolutions = await Promise.all(paths.map(getVideoResolution))
  const tally = new Map<string, { width: number; height: number; count: number }>()
  for (const r of resolutions) {
    const key = `${r.width}x${r.height}`
    const entry = tally.get(key)
    if (entry) entry.count++
    else tally.set(key, { width: r.width, height: r.height, count: 1 })
  }
  let best = { width: 1920, height: 1080, count: 0 }
  for (const e of tally.values()) {
    const better =
      e.count > best.count ||
      (e.count === best.count && e.width * e.height > best.width * best.height)
    if (better) best = e
  }
  // normalizeVideoForCombine rounds to even for yuv420p, so we don't here.
  return { width: best.width, height: best.height }
}

/**
 * Build chained xfade video filter for N clips.
 *
 * For N clips the chain has N-1 xfade stages:
 *   [0:v][1:v]xfade=...:offset=O0[v01];
 *   [v01][2:v]xfade=...:offset=O1[v012];
 *   ...
 *
 * Each offset = (running duration so far) - transitionDuration.
 */
function buildVideoFilter(
  durations: readonly number[],
  transitionType: string,
  transitionDuration: number,
): { filter: string; outputLabel: string } {
  const parts: string[] = []
  let runningDuration = durations[0]

  for (let i = 1; i < durations.length; i++) {
    const offset = Math.max(0, runningDuration - transitionDuration)
    const inputA = i === 1 ? "[0:v]" : `[v${i - 1}]`
    const inputB = `[${i}:v]`
    const outputLabel = i === durations.length - 1 ? "[vout]" : `[v${i}]`

    parts.push(
      `${inputA}${inputB}xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset}${outputLabel}`
    )

    // Running duration after this xfade
    runningDuration = offset + transitionDuration + durations[i] - transitionDuration
    // Simplified: runningDuration = offset + durations[i]
    runningDuration = offset + durations[i]
  }

  return { filter: parts.join(";"), outputLabel: "[vout]" }
}

/**
 * Build chained acrossfade audio filter for N clips.
 */
function buildAudioFilter(
  durations: readonly number[],
  transitionDuration: number,
): { filter: string; outputLabel: string } {
  const parts: string[] = []

  for (let i = 1; i < durations.length; i++) {
    const inputA = i === 1 ? "[0:a]" : `[a${i - 1}]`
    const inputB = `[${i}:a]`
    const outputLabel = i === durations.length - 1 ? "[aout]" : `[a${i}]`

    parts.push(
      `${inputA}${inputB}acrossfade=d=${transitionDuration}${outputLabel}`
    )
  }

  return { filter: parts.join(";"), outputLabel: "[aout]" }
}

export async function combineVideos(options: CombineOptions): Promise<string> {
  const { videoUrls, transition, transitionDuration, audioMode, trimStartFrames, trimEndFrames } = options
  const workDir = await createWorkDir("combine")

  try {
    // Download all clips first, then probe their resolutions so the whole set
    // can be normalized to one target — xfade/acrossfade/concat all reject
    // mismatched input dimensions.
    const rawPaths: string[] = []
    for (let i = 0; i < videoUrls.length; i++) {
      const rawPath = join(workDir, `input_${i}.mp4`)
      console.log(`[combineVideos] Downloading video ${i + 1}/${videoUrls.length}`)
      await downloadFile(videoUrls[i], rawPath)
      rawPaths.push(rawPath)
    }

    const target = await pickTargetResolution(rawPaths)
    console.log(`[combineVideos] Normalizing ${rawPaths.length} clips to ${target.width}x${target.height}`)

    const inputPaths: string[] = []
    for (let i = 0; i < rawPaths.length; i++) {
      const normalizedPath = join(workDir, `normalized_${i}.mp4`)
      await normalizeVideoForCombine(rawPaths[i], normalizedPath, target.width, target.height)
      const trimmedPath = await trimClipFrames(normalizedPath, workDir, i, trimStartFrames, trimEndFrames)
      inputPaths.push(trimmedPath)
    }

    const outputPath = join(workDir, "output.mp4")

    // Simple cut: use concat demuxer (fastest, stream copy)
    if (transition === "cut") {
      const listPath = join(workDir, "filelist.txt")
      const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
      await fs.writeFile(listPath, listContent)

      const args = ["-y", "-f", "concat", "-safe", "0", "-i", listPath]
      if (audioMode === "remove") {
        args.push("-c:v", "copy", "-an", outputPath)
      } else {
        args.push("-c", "copy", outputPath)
      }
      await runFfmpeg(args)

      console.log(`[combineVideos] Output (cut): ${outputPath}`)
      return outputPath
    }

    // For dip-to-black/white we interleave color clips between each input
    let clipPaths = [...inputPaths]
    if (transition === "dip-to-black" || transition === "dip-to-white") {
      const color = transition === "dip-to-black" ? "black" : "white"
      const { width, height } = target
      const dipDuration = transitionDuration
      const expandedPaths: string[] = []

      for (let i = 0; i < inputPaths.length; i++) {
        expandedPaths.push(inputPaths[i])
        if (i < inputPaths.length - 1) {
          const colorClip = await generateColorClip(workDir, i, dipDuration, color as "black" | "white", width, height)
          expandedPaths.push(colorClip)
        }
      }
      clipPaths = expandedPaths
    }

    // Probe durations for all clips
    const durations: number[] = []
    for (const clipPath of clipPaths) {
      const dur = await getVideoDuration(clipPath)
      durations.push(dur)
    }
    console.log(`[combineVideos] Clip durations: ${durations.map((d) => d.toFixed(2)).join(", ")}`)

    // Clamp transition duration so it doesn't exceed any clip's length
    const minDur = Math.min(...durations)
    const safeDuration = Math.min(transitionDuration, minDur * 0.9)

    // Build input args
    const inputs: string[] = []
    for (const p of clipPaths) {
      inputs.push("-i", p)
    }

    const xfadeType = resolveXfadeTransition(transition)
    const videoFilter = buildVideoFilter(durations, xfadeType, safeDuration)

    // Try with audio crossfade first, fall back to video-only if clips lack audio
    if (audioMode === "remove") {
      await runFfmpeg([
        "-y",
        ...inputs,
        "-filter_complex", videoFilter.filter,
        "-map", videoFilter.outputLabel,
        "-c:v", "libx264",
        "-preset", "fast",
        "-an",
        outputPath,
      ])
    } else if (audioMode === "crossfade") {
      const audioFilter = buildAudioFilter(durations, safeDuration)
      const fullFilter = `${videoFilter.filter};${audioFilter.filter}`

      try {
        await runFfmpeg([
          "-y",
          ...inputs,
          "-filter_complex", fullFilter,
          "-map", videoFilter.outputLabel,
          "-map", audioFilter.outputLabel,
          "-c:v", "libx264",
          "-preset", "fast",
          "-c:a", "aac",
          outputPath,
        ])
      } catch {
        // Fallback: some clips may not have audio streams
        console.log("[combineVideos] Audio crossfade failed, falling back to video-only")
        await runFfmpeg([
          "-y",
          ...inputs,
          "-filter_complex", videoFilter.filter,
          "-map", videoFilter.outputLabel,
          "-c:v", "libx264",
          "-preset", "fast",
          "-an",
          outputPath,
        ])
      }
    } else {
      // audioMode === "keep": concat audio streams without crossfade
      // We still need xfade for video, but concat audio separately
      // Probe each clip for audio; generate silent placeholders for clips without audio
      const audioFlags = await Promise.all(clipPaths.map((p) => hasAudioStream(p)))
      const silentParts: string[] = []
      const concatInputs: string[] = []

      for (let i = 0; i < clipPaths.length; i++) {
        if (audioFlags[i]) {
          concatInputs.push(`[${i}:a]`)
        } else {
          const label = `[silent_${i}]`
          silentParts.push(`aevalsrc=0:c=stereo:s=44100:d=${durations[i]}${label}`)
          concatInputs.push(label)
        }
      }

      const audioPreamble = silentParts.length > 0 ? silentParts.join(";") + ";" : ""
      const audioConcat = concatInputs.join("") +
        `concat=n=${clipPaths.length}:v=0:a=1[aout]`
      const fullFilter = `${videoFilter.filter};${audioPreamble}${audioConcat}`

      await runFfmpeg([
        "-y",
        ...inputs,
        "-filter_complex", fullFilter,
        "-map", videoFilter.outputLabel,
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-c:a", "aac",
        outputPath,
      ])
    }

    console.log(`[combineVideos] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
