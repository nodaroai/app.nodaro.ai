import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

export interface SpeedRampSegment {
  /** Start time in input seconds. */
  readonly start: number
  /** End time in input seconds. */
  readonly end: number
  /** Speed factor for this segment. */
  readonly speed: number
}

export type SpeedRampAudioMode = "pitch-preserve" | "pitch-shift" | "drop"
export type SpeedRampQuality = "fast" | "smooth"

export interface SpeedRampOptions {
  readonly videoUrl: string
  /** Constant speed factor. Ignored when `ramps` is set. */
  readonly speed: number
  /** Reverse playback (applied AFTER speed change). */
  readonly reverse?: boolean
  /** Audio treatment.
   *  - `pitch-preserve` (default): chain `atempo` filters; voice stays natural.
   *  - `pitch-shift`: `asetrate` + `aresample`; voice goes high/low with speed (chipmunk / giant).
   *  - `drop`: discard audio entirely (`-an`).
   *  When `ramps` is set, audio is always dropped regardless of this flag — per-segment
   *  audio time-stretch is non-trivial in FFmpeg and rarely useful (cinematic speed-ramps
   *  typically swap in music). */
  readonly audioMode?: SpeedRampAudioMode
  /** Frame interpolation quality.
   *  - `fast` (default): pure `setpts` — frame-duplicate when slowing, frame-drop when speeding.
   *  - `smooth`: motion-compensated interpolation via `minterpolate=mi_mode=mci:fps=60`.
   *    ~5–20× slower than `fast`; consult cost-tier credit pricing. */
  readonly quality?: SpeedRampQuality
  /** Variable-speed segments. When provided, each segment runs at its own speed; the
   *  constant `speed` field is ignored. Segments must be sorted ascending by `start` and
   *  non-overlapping. Coverage outside the segments runs at 1.0× (passthrough). */
  readonly ramps?: ReadonlyArray<SpeedRampSegment>
  /** Backward-compat shim. When `audioMode` is unset and this is provided, maps:
   *  true → "pitch-preserve", false → "drop". */
  readonly adjustAudio?: boolean
}

/**
 * Build the chain of atempo filters needed for audio speed adjustment.
 * FFmpeg atempo only accepts values in [0.5, 100.0]. For values outside, chain.
 */
export function buildAtempoChain(speed: number): string[] {
  if (speed <= 0) {
    throw new Error(`buildAtempoChain: speed must be > 0 (got ${speed})`)
  }
  const filters: string[] = []
  let remaining = speed
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

/**
 * Compose a setpts expression that maps every input timestamp `T` (in seconds)
 * to its output timestamp for a piecewise speed ramp. Segments must be sorted
 * ascending by `start` and non-overlapping; any input outside a declared
 * segment runs at 1.0× (passthrough).
 *
 * Time math: output_seconds(T) = cum[k] + (T - start[k]) / speed[k] where T
 * falls inside segment k. Boundaries cum[k] accumulate `(end - start) / speed`
 * over earlier segments plus the passthrough gaps between them.
 *
 * Returned string is suitable for FFmpeg `setpts='(...)/TB'`.
 */
export function buildRampSetptsExpression(ramps: ReadonlyArray<SpeedRampSegment>): string {
  if (ramps.length === 0) {
    throw new Error("buildRampSetptsExpression: ramps array is empty")
  }
  // Validate ordering + non-overlap.
  for (let i = 0; i < ramps.length; i++) {
    if (ramps[i].end <= ramps[i].start) {
      throw new Error(`buildRampSetptsExpression: segment ${i} has end <= start`)
    }
    if (ramps[i].speed <= 0) {
      throw new Error(`buildRampSetptsExpression: segment ${i} has speed <= 0`)
    }
    if (i > 0 && ramps[i].start < ramps[i - 1].end) {
      throw new Error(`buildRampSetptsExpression: segment ${i} overlaps segment ${i - 1}`)
    }
  }

  // cum[i] = output time at the START of segment i (in seconds).
  // Passthrough gaps between segments contribute their raw duration.
  const cum: number[] = [ramps[0].start]
  for (let i = 1; i < ramps.length; i++) {
    const prev = ramps[i - 1]
    const prevOutLen = (prev.end - prev.start) / prev.speed
    const gap = ramps[i].start - prev.end
    cum.push(cum[i - 1] + prevOutLen + gap)
  }

  // Build the piecewise expression. Iterate backwards so the LAST segment is
  // the deepest "else" branch and earlier segments wrap it.
  // - Before segment 0: output = T (passthrough from 0..start[0])
  // - Inside segment k: output = cum[k] + (T - start[k]) / speed[k]
  // - Between segment k and k+1 (gap): output = cum[k] + outLen[k] + (T - end[k])
  // - After last segment: output = cum[n-1] + outLen[n-1] + (T - end[n-1])
  let expr = ""
  for (let i = ramps.length - 1; i >= 0; i--) {
    const r = ramps[i]
    const segOutLen = (r.end - r.start) / r.speed
    const segPiece = `${cum[i]}+(T-${r.start})/${r.speed}`
    // The branch that handles T < end[i]:
    const innerStart = i === 0 ? "T" : `${cum[i - 1] + (ramps[i - 1].end - ramps[i - 1].start) / ramps[i - 1].speed}+(T-${ramps[i - 1].end})`
    const branchInSegment = `if(lt(T,${r.start}),${innerStart},${segPiece})`
    if (expr === "") {
      // After-last branch (T >= end[last]): cum[last] + segOutLen[last] + (T - end[last])
      const afterLast = `${cum[i] + segOutLen}+(T-${r.end})`
      expr = `if(lt(T,${r.end}),${branchInSegment},${afterLast})`
    } else {
      expr = `if(lt(T,${r.end}),${branchInSegment},${expr})`
    }
  }
  return `(${expr})/TB`
}

/**
 * Resolve `audioMode` accounting for the legacy `adjustAudio` shim.
 * Exported for tests.
 */
export function resolveAudioMode(opts: Pick<SpeedRampOptions, "audioMode" | "adjustAudio" | "ramps">): SpeedRampAudioMode {
  // Ramps always force audio drop (per-segment atempo is non-trivial; users
  // typically swap in music for cinematic speed-ramp shots).
  if (opts.ramps && opts.ramps.length > 0) return "drop"
  if (opts.audioMode) return opts.audioMode
  if (opts.adjustAudio === false) return "drop"
  return "pitch-preserve"
}

export async function speedRamp(options: SpeedRampOptions): Promise<string> {
  const { videoUrl, reverse = false, quality = "fast", ramps } = options
  const audioMode = resolveAudioMode(options)

  // Speed range tightened from the original 0.25-4.0 to 0.05-100.0 to match
  // what FFmpeg + chained atempo can deliver. The slider in the config panel
  // exposes the practical 0.1-10.0 sub-range; extreme values are reachable
  // via API / SDK.
  const clampedSpeed = Math.max(0.05, Math.min(100.0, options.speed))

  const usingRamps = !!(ramps && ramps.length > 0)
  const workDir = await createWorkDir("speed-ramp")

  try {
    const inputPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log(`[speedRamp] Downloading video from ${videoUrl}`)
    await downloadFile(videoUrl, inputPath)

    // ---- Build the video filter chain ----
    const videoFilters: string[] = []
    if (usingRamps) {
      const ptsExpr = buildRampSetptsExpression(ramps!)
      videoFilters.push(`setpts=${ptsExpr}`)
    } else {
      videoFilters.push(`setpts=PTS/${clampedSpeed}`)
    }
    if (quality === "smooth") {
      // Motion-compensated frame interpolation. fps=60 is a sensible default;
      // higher slow-motion factors arguably want higher target fps but the cost
      // grows quickly. Document this in the doc page.
      videoFilters.push("minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir")
    }
    if (reverse) {
      videoFilters.push("reverse")
    }
    const videoFilterStr = videoFilters.join(",")

    // ---- Build the audio filter chain ----
    let audioArgs: string[] = []
    if (audioMode === "drop" || usingRamps) {
      audioArgs = ["-an"]
    } else if (audioMode === "pitch-preserve") {
      const chain = buildAtempoChain(clampedSpeed).join(",")
      const filters = reverse ? `${chain},areverse` : chain
      audioArgs = ["-filter:a", filters, "-c:a", "aac", "-b:a", "128k"]
    } else {
      // pitch-shift: asetrate trick. We multiply the sample rate by `speed`,
      // then aresample back to the standard rate. This shifts pitch in
      // lockstep with playback speed — chipmunk effect at >1, giant at <1.
      const filters = [
        `asetrate=44100*${clampedSpeed}`,
        "aresample=44100",
        ...(reverse ? ["areverse"] : []),
      ].join(",")
      audioArgs = ["-filter:a", filters, "-c:a", "aac", "-b:a", "128k"]
    }

    const args = [
      "-y", "-i", inputPath,
      "-filter:v", videoFilterStr,
      ...audioArgs,
      "-c:v", "libx264",
      "-preset", quality === "smooth" ? "medium" : "fast",
      "-crf", "23",
      outputPath,
    ]

    console.log(`[speedRamp] Running FFmpeg: ffmpeg ${args.join(" ")}`)
    await runFfmpeg(args)

    console.log(`[speedRamp] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
