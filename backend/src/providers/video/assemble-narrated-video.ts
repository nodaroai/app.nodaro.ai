import { join } from "node:path"
import { promises as fs } from "node:fs"
import {
  downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir,
  getVideoDuration, probeMediaDuration, hasAudioStream,
  normalizeVideoForCombine, trimEdgeFrames,
} from "./ffmpeg-utils.js"
import { pickTargetResolution } from "./combine-videos.js"
import { buildAtempoChain } from "./speed-ramp.js"
import { planBlockFit, type BlockFitPlan } from "./narrated-block-fit.js"

export interface NarratedBlockInput {
  readonly videoUrl: string
  readonly audioUrl?: string
}
export interface AssembleNarratedVideoParams {
  readonly blocks: readonly NarratedBlockInput[]
  readonly voiceVolume?: number
  readonly clipAudioVolume?: number
  readonly maxSlowdown?: number
  readonly trimStartFrames?: number
  readonly trimEndFrames?: number
  /**
   * Optional progress callback, fraction in [0, 1]. `assembleNarratedVideo`
   * invokes it once after downloads finish (a small fixed tick), then
   * `assembleNarratedVideoFromLocalFiles` invokes it once per completed
   * block during the fit/normalize/concat pipeline (`(i + 1) / blocks.length`)
   * so callers see incremental movement instead of a single jump at the very
   * end. Calls are monotonically non-decreasing. A throwing callback must
   * NEVER fail the run — every call site wraps the invocation in try/catch.
   */
  readonly onProgress?: (fraction: number) => void
}

/**
 * A block whose inputs are already local files (post-download). This is the
 * seam `assembleNarratedVideo` wraps with `downloadFile` — kept as a
 * separate exported entry point so callers that already have local media
 * (and the e2e test, which cannot route `file://` fixtures through the
 * SSRF-guarded `downloadFile`/`safeFetch` path) can drive the fit/normalize/
 * concat pipeline directly.
 */
export interface LocalNarratedBlockInput {
  readonly videoPath: string
  readonly voicePath?: string | null
}
export interface AssembleNarratedVideoLocalParams {
  readonly blocks: readonly LocalNarratedBlockInput[]
  readonly voiceVolume?: number
  readonly clipAudioVolume?: number
  readonly maxSlowdown?: number
  readonly trimStartFrames?: number
  readonly trimEndFrames?: number
  /** See `AssembleNarratedVideoParams.onProgress`. */
  readonly onProgress?: (fraction: number) => void
}

/** Fires `onProgress` best-effort — a throwing callback must never fail the run. */
function reportProgress(onProgress: ((fraction: number) => void) | undefined, fraction: number): void {
  if (!onProgress) return
  try {
    onProgress(fraction)
  } catch {
    // Intentionally swallowed — progress reporting is best-effort and must
    // never affect assembly success/failure.
  }
}

const clampVol = (v: number | undefined, d: number) =>
  Math.max(0, Math.min(200, v ?? d)) / 100

/**
 * Audio-led assembler. Per block: seam-trim (interior joins) → probe post-trim
 * durations → planBlockFit → one normalized block file → concat. Audio never
 * cropped. Returns the local output MP4 path (caller uploads to R2).
 */
export async function assembleNarratedVideo(params: AssembleNarratedVideoParams): Promise<string> {
  const blocks = params.blocks ?? []
  if (blocks.length < 1) throw new Error("assemble-narrated-video needs at least 1 block")

  const workDir = await createWorkDir("assemble-narrated-video")
  try {
    // 1. Download all inputs.
    const localBlocks: LocalNarratedBlockInput[] = []
    for (let i = 0; i < blocks.length; i++) {
      try {
        const cp = join(workDir, `clip-${i}.in.mp4`)
        await downloadFile(blocks[i].videoUrl, cp)
        let voicePath: string | null = null
        if (blocks[i].audioUrl) {
          voicePath = join(workDir, `voice-${i}.in`)
          await downloadFile(blocks[i].audioUrl!, voicePath)
        }
        localBlocks.push({ videoPath: cp, voicePath })
      } catch (err) {
        throw new Error(`Block ${i + 1}: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
    }

    // Small tick once downloads are in — gives the caller an early sign of
    // life before the (longer) per-block fit pipeline starts ticking via the
    // block loop below. Capped at min(0.05, 0.5 / blocks.length) so it's
    // always strictly less than the first block's own (1 / blocks.length)
    // tick — a fixed 0.05 would regress on jobs with >20 blocks (e.g. a
    // 60-block job's first block tick is only 1/60 ≈ 0.017), breaking the
    // monotonic-non-decreasing contract on `onProgress`.
    reportProgress(params.onProgress, Math.min(0.05, 0.5 / blocks.length))

    // 2-4. Fit + normalize + concat — shared with the local-files entry point.
    // Pass our workDir so downloads and processing outputs land in the same
    // directory (the success path leaves it in place for the caller/worker
    // to clean up via cleanupWorkDir(dirname(outputPath)) after upload).
    return await assembleNarratedVideoFromLocalFiles(
      {
        blocks: localBlocks,
        voiceVolume: params.voiceVolume,
        clipAudioVolume: params.clipAudioVolume,
        maxSlowdown: params.maxSlowdown,
        trimStartFrames: params.trimStartFrames,
        trimEndFrames: params.trimEndFrames,
        onProgress: params.onProgress,
      },
      workDir,
    )
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
  // NOTE: success path leaves workDir for the worker to clean via
  // cleanupWorkDir(dirname(outputPath)) after upload (mirrors image-collage).
}

/**
 * Core fit/normalize/concat pipeline, given blocks whose video/voice are
 * already local files. `assembleNarratedVideo` wraps this with a download
 * step; callers that already have local media (or tests) can call this
 * directly.
 *
 * `workDir`: when omitted, a fresh work dir is created and OWNED by this
 * call — on error it is cleaned up here; on success it is left in place
 * (same leave-in-place contract as `assembleNarratedVideo`). When supplied
 * (as `assembleNarratedVideo` does), the caller owns its lifecycle — this
 * function never cleans it up, success or failure, so a caller-supplied
 * directory (e.g. one already holding freshly-downloaded inputs) is never
 * deleted out from under the caller on error.
 */
export async function assembleNarratedVideoFromLocalFiles(
  params: AssembleNarratedVideoLocalParams,
  workDir?: string,
): Promise<string> {
  const blocks = params.blocks ?? []
  if (blocks.length < 1) throw new Error("assemble-narrated-video needs at least 1 block")
  const voiceVol = clampVol(params.voiceVolume, 100)
  const clipVol = clampVol(params.clipAudioVolume, 40)
  const maxSlowdown = Math.max(1, Math.min(2, params.maxSlowdown ?? 1.5))
  const trimStart = Math.max(0, Math.min(120, Math.floor(params.trimStartFrames ?? 0)))
  const trimEnd = Math.max(0, Math.min(120, Math.floor(params.trimEndFrames ?? 0)))

  const ownsWorkDir = !workDir
  const dir = workDir ?? (await createWorkDir("assemble-narrated-video"))
  try {
    // 1. Target resolution across clips.
    const clipPaths = blocks.map((b) => b.videoPath)
    const { width, height } = await pickTargetResolution(clipPaths)

    // 2. Per-block: seam trim (interior only) → fit → normalized block file.
    const blockFiles: string[] = []
    for (let i = 0; i < blocks.length; i++) {
      try {
        let clip = blocks[i].videoPath
        // interior-join seam trim (protect first/last edges like combine-videos).
        const applyEnd = trimEnd > 0 && i < blocks.length - 1
        const applyStart = trimStart > 0 && i > 0
        if (applyEnd || applyStart) {
          clip = await trimEdgeFrames(
            clip, join(dir, `clip-${i}.trim.mp4`),
            applyStart ? trimStart : 0, applyEnd ? trimEnd : 0,
          )
        }

        const videoDur = await getVideoDuration(clip)
        const voice = blocks[i].voicePath ?? null
        const audioDur = voice ? await probeMediaDuration(voice) : null
        const plan = planBlockFit({ videoDurationSec: videoDur, audioDurationSec: audioDur, maxSlowdown })
        const clipHasAudio = await hasAudioStream(clip)

        // Normalize resolution/fps first (letterbox to target) — reuses the
        // combine-videos pipeline so concat -c copy works across blocks.
        const norm = join(dir, `clip-${i}.norm.mp4`)
        await normalizeVideoForCombine(clip, norm, width, height)

        // The block's FINAL video duration after fit: unchanged (clip
        // duration) for pad/passthrough, stretched-to-voice for slow (see
        // planBlockFit — the slow branch's setpts+tpad always lands exactly
        // on audioDur). Every block's audio stream must be padded/synthesized
        // to match this so the trailing `-f concat -c copy` never meets a
        // stream-less or short-audio block.
        const blockDurationSec = plan.kind === "slow" ? (audioDur ?? videoDur) : videoDur

        const out = join(dir, `block-${i}.mp4`)
        await runBlockFit({ norm, voice, plan, voiceVol, clipVol, clipHasAudio, out, blockDurationSec })
        blockFiles.push(out)
        reportProgress(params.onProgress, (i + 1) / blocks.length)
      } catch (err) {
        throw new Error(`Block ${i + 1}: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
    }

    // 3. Concat (stream copy — identical encode params from normalize + fit).
    const listPath = join(dir, "concat.txt")
    await fs.writeFile(listPath, blockFiles.map((p) => `file '${p}'`).join("\n"), "utf-8")
    const outputPath = join(dir, "assembled.mp4")
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath])
    return outputPath
  } catch (err) {
    if (ownsWorkDir) await cleanupWorkDir(dir)
    throw err
  }
}

/**
 * Build + run the single ffmpeg pass that fits one block to browser-safe MP4.
 *
 * Invariant (Finding 1 fix): EVERY block file must come out with an audio
 * stream whose duration equals `blockDurationSec` (this block's final video
 * duration). `-f concat -c copy` stitches block files by raw stream
 * assumption — a stream-less or short-audio block corrupts audio continuity
 * for every block after it, so all three audio branches below funnel through
 * `apad=whole_dur=<blockDurationSec>` (or a `-t`-bounded `anullsrc` when
 * there's no real audio source at all) before mapping `[aout]`.
 */
async function runBlockFit(opts: {
  norm: string; voice: string | null
  plan: BlockFitPlan
  voiceVol: number; clipVol: number; clipHasAudio: boolean; out: string
  blockDurationSec: number
}): Promise<void> {
  const { norm, voice, plan, voiceVol, clipVol, clipHasAudio, out, blockDurationSec } = opts
  const padDur = blockDurationSec.toFixed(3)
  const args: string[] = ["-y", "-i", norm]
  if (voice) args.push("-i", voice)

  // Only synthesize a silence input when there's no real audio source at
  // all (no voice AND the clip itself has no audio track) — keeps every
  // block's output audio stream present/uniform for the final concat.
  const needsSilenceInput = !voice && !clipHasAudio
  // `needsSilenceInput` implies `!voice`, so this input always lands at
  // index 1 (right after `norm`, since no voice input precedes it).
  const silenceInputIndex = 1
  if (needsSilenceInput) {
    args.push(
      "-f", "lavfi", "-t", padDur,
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    )
  }

  const vf: string[] = []
  const filterParts: string[] = []

  // Video timeline.
  if (plan.kind === "slow") {
    vf.push(`setpts=${plan.factor}*PTS`)
    if (plan.holdSec > 0) vf.push(`tpad=stop_mode=clone:stop_duration=${plan.holdSec}`)
  }

  // Audio graph — every branch funnels into `[aout]` padded/bounded to
  // `blockDurationSec` so the block file always has a full-length audio
  // stream, uniform in codec params across blocks (safe for `-c copy` concat).
  const clipAudioRef = "[0:a]"
  const voiceRef = "[1:a]"
  if (voice) {
    // voice chain: optional delay (pad) or atempo hold-sync (slow) + volume.
    const voiceChain: string[] = []
    if (plan.kind === "pad" && plan.voiceDelaySec > 0) {
      const ms = Math.round(plan.voiceDelaySec * 1000)
      voiceChain.push(`adelay=${ms}|${ms}`)
    }
    voiceChain.push(`volume=${voiceVol}`)
    filterParts.push(`${voiceRef}${voiceChain.join(",")}[vo]`)

    if (clipHasAudio) {
      // clip ambient: if slowing, time-stretch pitch-preserved to match video.
      const clipChain: string[] = []
      if (plan.kind === "slow") {
        clipChain.push(buildAtempoChain(1 / plan.factor).join(","))
      }
      clipChain.push(`volume=${clipVol}`)
      filterParts.push(`${clipAudioRef}${clipChain.join(",")}[amb]`)
      filterParts.push(`[vo][amb]amix=inputs=2:normalize=0:duration=longest[amix]`)
      filterParts.push(`[amix]apad=whole_dur=${padDur}[aout]`)
    } else {
      filterParts.push(`[vo]apad=whole_dur=${padDur}[aout]`)
    }
  } else if (clipHasAudio) {
    // Passthrough-with-audio: no voice, but guarantee the duration invariant
    // by padding the clip's own audio to the block's video duration.
    filterParts.push(`${clipAudioRef}apad=whole_dur=${padDur}[aout]`)
  } else {
    // No voice, no clip audio: synthesize exact-length silence so this
    // block's audio stream is never absent (the Finding-1 corruption case).
    filterParts.push(`[${silenceInputIndex}:a]anull[aout]`)
  }
  const audioOutLabel = "[aout]"

  if (vf.length) filterParts.push(`[0:v]${vf.join(",")}[vout]`)
  const videoMap = vf.length ? "[vout]" : "0:v"

  args.push("-filter_complex", filterParts.join(";"))
  args.push("-map", videoMap)
  args.push("-map", audioOutLabel)
  // Encode identically across blocks so the final concat can -c copy.
  // -ar/-ac pin every block's audio stream to the same sample rate/channel
  // layout regardless of source (clip ambient may be 48kHz, anullsrc is
  // 44100, TTS voice tracks vary by provider) — `-f concat -c copy` splices
  // raw streams, so a sample-rate mismatch between blocks corrupts the
  // concatenated audio track.
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", out)
  await runFfmpeg(args)
}
