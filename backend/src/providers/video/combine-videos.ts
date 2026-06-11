import { promises as fs } from "node:fs"
import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, getVideoDuration, createWorkDir, cleanupWorkDir, normalizeVideoForCombine } from "./ffmpeg-utils.js"
import { resolveXfadeName, resolveAudioCrossfadeCurve } from "@nodaro/shared"

interface CombineOptions {
  readonly videoUrls: readonly string[]
  /** Any id from `COMBINE_TRANSITIONS`. Validation happens at the route's
   *  Zod boundary; this signature stays string-typed to avoid pinning the
   *  worker to a stale subset of the catalog. */
  readonly transition: string
  readonly transitionDuration: number
  readonly audioMode: "keep" | "crossfade" | "remove"
  /** Id from `AUDIO_CROSSFADE_CURVES`. Only consulted when `audioMode==="crossfade"`.
   *  Falls back to `tri` (linear) when undefined. */
  readonly audioCrossfadeCurve?: string
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
export async function pickTargetResolution(
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

    runningDuration = offset + durations[i]
  }

  return { filter: parts.join(";"), outputLabel: "[vout]" }
}

/**
 * Build chained acrossfade audio filter for N clips. `curve` is an
 * `acrossfade=curve=...` name (e.g., "tri", "qsin"); when both `c1` and `c2`
 * are omitted FFmpeg defaults to triangular on both sides, so we pass the
 * curve through `c1` + `c2` to give the user the same curve at both ends.
 */
function buildAudioFilter(
  durations: readonly number[],
  transitionDuration: number,
  curve: string,
): { filter: string; outputLabel: string } {
  const parts: string[] = []

  for (let i = 1; i < durations.length; i++) {
    const inputA = i === 1 ? "[0:a]" : `[a${i - 1}]`
    const inputB = `[${i}:a]`
    const outputLabel = i === durations.length - 1 ? "[aout]" : `[a${i}]`

    parts.push(
      `${inputA}${inputB}acrossfade=d=${transitionDuration}:c1=${curve}:c2=${curve}${outputLabel}`
    )
  }

  return { filter: parts.join(";"), outputLabel: "[aout]" }
}

/**
 * Audio for hard-cut joins: per-boundary fade-out/fade-in + sample concat.
 * acrossfade is WRONG against a hard video cut — it OVERLAPS clips in time,
 * so every post-boundary segment's audio ran the full crossfade duration
 * early relative to its video (sound led picture by `d` seconds from the
 * first cut onward), and the apad that "matched" total durations merely hid
 * the shortfall as end-silence. Fades keep each clip's audio anchored to its
 * own video while still killing boundary clicks; durations are preserved
 * exactly, so no padding is needed.
 */
function buildCutAudioFilter(
  durations: readonly number[],
  fadeDuration: number,
  curve: string,
): { filter: string; outputLabel: string } {
  const n = durations.length
  const parts: string[] = []
  const labels: string[] = []
  for (let i = 0; i < n; i++) {
    const fades: string[] = []
    if (i > 0) fades.push(`afade=t=in:st=0:d=${fadeDuration}:curve=${curve}`)
    if (i < n - 1) {
      const st = Math.max(0, durations[i]! - fadeDuration)
      fades.push(`afade=t=out:st=${st}:d=${fadeDuration}:curve=${curve}`)
    }
    const label = `[ac${i}]`
    parts.push(`[${i}:a]${fades.length > 0 ? fades.join(",") : "anull"}${label}`)
    labels.push(label)
  }
  parts.push(`${labels.join("")}concat=n=${n}:v=0:a=1[aout]`)
  return { filter: parts.join(";"), outputLabel: "[aout]" }
}

export async function combineVideos(options: CombineOptions): Promise<string> {
  const { videoUrls, transition, transitionDuration, audioMode, audioCrossfadeCurve, trimStartFrames, trimEndFrames } = options
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
      // Frame trim is meant to clean transition artifacts at clip BOUNDARIES.
      // The first clip's start and the last clip's end are not boundaries —
      // they're the final video's opening/closing frames the user chose to
      // keep. Suppress trim on those outer edges.
      const isFirst = i === 0
      const isLast = i === rawPaths.length - 1
      const effStart = isFirst ? 0 : trimStartFrames
      const effEnd = isLast ? 0 : trimEndFrames
      const trimmedPath = await trimClipFrames(normalizedPath, workDir, i, effStart, effEnd)
      inputPaths.push(trimmedPath)
    }

    const outputPath = join(workDir, "output.mp4")

    // Concat-demuxer fast path: stream-copy, no filter graph. Used for cut
    // transitions where audio doesn't need filtering — including
    // cut+crossfade with a zero transition duration, where zero-length
    // fades degenerate to a plain cut (previously acrossfade d=0 errored
    // and only the catch-fallback saved the output).
    if (transition === "cut" && (audioMode !== "crossfade" || transitionDuration <= 0)) {
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

    const durations: number[] = []
    for (const clipPath of inputPaths) {
      const dur = await getVideoDuration(clipPath)
      durations.push(dur)
    }
    console.log(`[combineVideos] Clip durations: ${durations.map((d) => d.toFixed(2)).join(", ")}`)

    // xfade and acrossfade fail if the transition is longer than the shortest
    // clip; clamp to 90% of that to leave a little slack on both ends.
    const minDur = Math.min(...durations)
    const safeDuration = Math.min(transitionDuration, minDur * 0.9)

    const inputs: string[] = []
    for (const p of inputPaths) {
      inputs.push("-i", p)
    }

    // cut+crossfade: hard-cut video (concat filter) + timeline-preserving
    // boundary fades on audio (see buildCutAudioFilter — acrossfade would
    // shift every post-boundary segment's audio early).
    if (transition === "cut") {
      const videoConcatInputs = inputPaths.map((_, i) => `[${i}:v]`).join("")
      const videoConcat = `${videoConcatInputs}concat=n=${inputPaths.length}:v=1:a=0[vout]`
      const audioFilter = buildCutAudioFilter(durations, safeDuration, resolveAudioCrossfadeCurve(audioCrossfadeCurve))
      const fullFilter = `${videoConcat};${audioFilter.filter}`

      try {
        await runFfmpeg([
          "-y",
          ...inputs,
          "-filter_complex", fullFilter,
          "-map", "[vout]",
          "-map", audioFilter.outputLabel,
          "-c:v", "libx264",
          "-preset", "fast",
          "-c:a", "aac",
          outputPath,
        ])
      } catch {
        // The audio graph fails if any clip lacks an audio stream. Fall back
        // to concat demuxer with stream copy — preserves existing audio at
        // the cost of the boundary fades.
        console.log("[combineVideos] cut+crossfade failed, falling back to concat (no audio crossfade)")
        const listPath = join(workDir, "filelist.txt")
        const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
        await fs.writeFile(listPath, listContent)
        await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath])
      }

      console.log(`[combineVideos] Output (cut+crossfade): ${outputPath}`)
      return outputPath
    }

    const xfadeType = resolveXfadeName(transition)
    if (xfadeType === null) {
      // Unreachable: `cut` is handled above; Zod rejects unknown ids.
      throw new Error(`combineVideos: non-xfade transition reached xfade path: ${transition}`)
    }
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
      const audioFilter = buildAudioFilter(durations, safeDuration, resolveAudioCrossfadeCurve(audioCrossfadeCurve))
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
      // audioMode === "keep": the video xfade chain COMPRESSES the timeline
      // by D per boundary, so a plain audio concat left clip N's audio
      // (N-1)*D seconds late relative to its video. Anchor each clip's audio
      // at its video start instead: adelay to the xfade offset, then amix —
      // the D-second overlap regions mix the outgoing tail with the incoming
      // head. Clips without audio are simply omitted (silence adds nothing);
      // if NO clip has audio, emit video-only.
      const audioFlags = await Promise.all(inputPaths.map((p) => hasAudioStream(p)))
      const starts: number[] = []
      let acc = 0
      for (let i = 0; i < durations.length; i++) {
        starts.push(acc)
        acc += durations[i] - safeDuration
      }

      const delayParts: string[] = []
      const mixInputs: string[] = []
      for (let i = 0; i < inputPaths.length; i++) {
        if (!audioFlags[i]) continue
        const label = `[ka${i}]`
        const ms = Math.max(0, Math.round(starts[i] * 1000))
        delayParts.push(ms > 0 ? `[${i}:a]adelay=${ms}:all=1${label}` : `[${i}:a]anull${label}`)
        mixInputs.push(label)
      }

      if (mixInputs.length === 0) {
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
      } else {
        const audioMix = `${mixInputs.join("")}amix=inputs=${mixInputs.length}:normalize=0:duration=longest[aout]`
        const fullFilter = `${videoFilter.filter};${delayParts.join(";")};${audioMix}`
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
    }

    console.log(`[combineVideos] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
