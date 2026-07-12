import { promises as fs } from "node:fs"
import { join } from "node:path"
import { downloadFile, runFfmpeg, runFfprobe, getVideoDuration, createWorkDir, cleanupWorkDir, normalizeVideoForCombine, trimEdgeFrames } from "./ffmpeg-utils.js"
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
  /** Length of the AUDIO crossfade in seconds, independent of the video
   *  transition. Audio settings never alter the video stream: at hard cuts
   *  the video is stream-copied untouched and only the audio blends; at
   *  xfade transitions the video fade length stays `transitionDuration`.
   *  Falls back to `transitionDuration` when undefined (pre-split workflows
   *  stored their audio crossfade length there). */
  readonly audioCrossfadeDuration?: number
  readonly trimStartFrames: number
  readonly trimEndFrames: number
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
 * Build chained acrossfade audio filter for N clips — a TRUE overlapping
 * blend: the incoming clip's audio starts `d` seconds before its video and
 * cross-mixes with the outgoing tail. Used for hard-cut joins, where it is
 * the only way to blend soundtracks (the clips share no overlap material).
 *
 * Known, accepted tradeoff (deliberate product decision 2026-07-12,
 * reversing PR #3307's fade-through-silence): after each boundary the
 * remaining clips' audio leads their video by `d` (accumulating per
 * boundary). For the ambient/music soundtracks AI clips carry this is
 * imperceptible at typical durations (≤1s) and sounds dramatically better
 * than fading through silence; content needing frame-accurate sync should
 * use audioMode "keep" or a short duration.
 *
 * `curve` is an `acrossfade=curve=...` name (e.g., "tri", "qsin"); we pass
 * it through `c1` + `c2` so both ends use the same shape.
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
 * Audio for xfade joins with an INDEPENDENT audio-fade length: each clip's
 * audio is anchored at its video start (adelay to the xfade offset — sync-
 * safe by construction, no matter what `audioFadeDuration` is), faded in
 * over its head and out over its tail, then everything is amixed. The clips
 * genuinely overlap by the VIDEO transition duration, so the fades cross-
 * blend there; when `audioFadeDuration` exceeds the video overlap the fades
 * simply extend into the solo regions — a longer, gentler blend with zero
 * effect on the video timeline. Degenerates to plain anchored amix (keep-
 * style) when `audioFadeDuration` is 0.
 */
function buildAnchoredCrossfadeAudioFilter(
  durations: readonly number[],
  videoTransitionDuration: number,
  audioFadeDuration: number,
  curve: string,
): { filter: string; outputLabel: string } {
  const n = durations.length
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < n; i++) {
    starts.push(acc)
    acc += durations[i]! - videoTransitionDuration
  }
  const parts: string[] = []
  const labels: string[] = []
  for (let i = 0; i < n; i++) {
    const chain: string[] = []
    if (audioFadeDuration > 0 && i > 0) {
      chain.push(`afade=t=in:st=0:d=${audioFadeDuration}:curve=${curve}`)
    }
    if (audioFadeDuration > 0 && i < n - 1) {
      const st = Math.max(0, durations[i]! - audioFadeDuration)
      chain.push(`afade=t=out:st=${st}:d=${audioFadeDuration}:curve=${curve}`)
    }
    const ms = Math.max(0, Math.round(starts[i]! * 1000))
    if (ms > 0) chain.push(`adelay=${ms}:all=1`)
    const label = `[xa${i}]`
    parts.push(`[${i}:a]${chain.length > 0 ? chain.join(",") : "anull"}${label}`)
    labels.push(label)
  }
  parts.push(`${labels.join("")}amix=inputs=${n}:normalize=0:duration=longest[aout]`)
  return { filter: parts.join(";"), outputLabel: "[aout]" }
}

export async function combineVideos(options: CombineOptions): Promise<string> {
  const { videoUrls, transition, transitionDuration, audioMode, audioCrossfadeCurve, audioCrossfadeDuration, trimStartFrames, trimEndFrames } = options
  const workDir = await createWorkDir("combine")

  // Audio crossfade length is its own knob; older workflows stored it in
  // transitionDuration (the fields were one), so fall back there.
  const audioCrossfadeSeconds = audioCrossfadeDuration ?? transitionDuration
  // A non-cut transition with zero duration IS a hard cut — route it through
  // the cut machinery (xfade duration=0 / acrossfade d=0 error out).
  const hardCutVideo = transition === "cut" || transitionDuration <= 0

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
      const trimmedPath = await trimEdgeFrames(
        normalizedPath, join(workDir, `trimmed_${i}.mp4`), effStart, effEnd,
      )
      if (trimmedPath === normalizedPath && (effStart > 0 || effEnd > 0)) {
        console.log(`[combineVideos] Trim would exceed clip ${i} duration, skipping`)
      }
      inputPaths.push(trimmedPath)
    }

    const outputPath = join(workDir, "output.mp4")

    // Probe audio presence once for the whole set (skipped for "remove" —
    // audio is dropped anyway). Drives the mixed-set silent-track injection
    // below and the audio-graph decisions in every branch.
    const audioFlags = audioMode === "remove"
      ? inputPaths.map(() => false)
      : await Promise.all(inputPaths.map((p) => hasAudioStream(p)))
    const anyAudio = audioFlags.some(Boolean)

    // A mixed set (some clips with audio, some without) breaks EVERY join
    // strategy: the concat demuxer's stream copy silently ends the audio
    // track at the first soundless segment (the rest of the video goes
    // mute), and the crossfade/keep filter graphs error on the missing
    // [i:a] pad, dropping audio wholesale via their fallbacks. Give
    // soundless clips a silent AAC track (44.1kHz stereo — the exact params
    // normalizeVideoForCombine pins) so every clip presents an identical
    // stream layout. Video is stream-copied, so this is a cheap remux;
    // -shortest bounds the infinite anullsrc to the clip's length.
    if (anyAudio) {
      for (let i = 0; i < inputPaths.length; i++) {
        if (audioFlags[i]) continue
        const silencedPath = join(workDir, `silenced_${i}.mp4`)
        console.log(`[combineVideos] Clip ${i} has no audio, adding silent track`)
        await runFfmpeg([
          "-y", "-i", inputPaths[i],
          "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
          "-map", "0:v", "-map", "1:a",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
          "-shortest",
          silencedPath,
        ])
        inputPaths[i] = silencedPath
        audioFlags[i] = true
      }
    }

    // Concat-demuxer fast path: stream-copy, no filter graph. Used for
    // hard-cut video (cut transition, or any transition at duration 0) when
    // audio needs no filtering: keep mode, remove mode, a zero-length audio
    // crossfade, or no audio at all. Safe to stream-copy because normalize
    // pinned identical codec params on every clip and the injection above
    // made stream layouts uniform.
    if (hardCutVideo && (audioMode !== "crossfade" || audioCrossfadeSeconds <= 0 || !anyAudio)) {
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
    const safeAudioCrossfade = Math.min(audioCrossfadeSeconds, minDur * 0.9)

    const inputs: string[] = []
    for (const p of inputPaths) {
      inputs.push("-i", p)
    }

    // Hard-cut video + audio crossfade: the video is stream-copied VERBATIM
    // (byte-identical to the fast path — audio settings must never alter the
    // video stream), and the audio is blended in its own pass with the
    // overlapping acrossfade chain, padded back to the video's full length.
    // Two passes: (1) decode all clips, acrossfade audio only; (2) concat
    // demuxer for the video + mux the blended track, everything -c copy.
    if (hardCutVideo) {
      const listPath = join(workDir, "filelist.txt")
      const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
      await fs.writeFile(listPath, listContent)

      try {
        const videoTotal = durations.reduce((sum, d) => sum + d, 0)
        const audioFilter = buildAudioFilter(durations, safeAudioCrossfade, resolveAudioCrossfadeCurve(audioCrossfadeCurve))
        const paddedFilter = `${audioFilter.filter};${audioFilter.outputLabel}apad=whole_dur=${videoTotal}[aoutp]`
        const audioPath = join(workDir, "blended_audio.m4a")
        await runFfmpeg([
          "-y",
          ...inputs,
          "-filter_complex", paddedFilter,
          "-map", "[aoutp]",
          "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
          audioPath,
        ])
        await runFfmpeg([
          "-y",
          "-f", "concat", "-safe", "0", "-i", listPath,
          "-i", audioPath,
          "-map", "0:v", "-map", "1:a",
          "-c", "copy",
          outputPath,
        ])
      } catch {
        // Safety net (probe miss on an exotic container): plain stream-copy
        // concat — preserves existing audio at the cost of the blend.
        console.log("[combineVideos] cut+crossfade failed, falling back to concat (no audio crossfade)")
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
      if (!anyAudio) {
        // No clip has audio — nothing to crossfade. Emit video-only directly
        // instead of letting the audio graph fail into the same fallback.
        console.log("[combineVideos] No audio streams, emitting video-only")
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
        // Anchored per-clip fades + amix: audio fade length is independent
        // of the video fade (see buildAnchoredCrossfadeAudioFilter) and each
        // clip's audio stays locked to its video start.
        const audioFilter = buildAnchoredCrossfadeAudioFilter(
          durations, safeDuration, safeAudioCrossfade, resolveAudioCrossfadeCurve(audioCrossfadeCurve),
        )
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
          // Safety net — the silent-track injection above should have made
          // the audio graph valid, but a probe miss on an exotic container
          // still lands here rather than failing the job.
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
      }
    } else {
      // audioMode === "keep": the video xfade chain COMPRESSES the timeline
      // by D per boundary, so a plain audio concat left clip N's audio
      // (N-1)*D seconds late relative to its video. Anchor each clip's audio
      // at its video start instead: adelay to the xfade offset, then amix —
      // the D-second overlap regions mix the outgoing tail with the incoming
      // head. Clips without audio are simply omitted (silence adds nothing —
      // after the mixed-set injection above this only happens when NO clip
      // has audio, in which case we emit video-only). Flags come from the
      // up-front probe.
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
