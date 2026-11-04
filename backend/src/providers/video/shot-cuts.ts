/**
 * Shot Cuts: where every shot of a clip starts and ends, measured from the file
 * by the platform's scene-cut rule (`detectShotCuts` — every decoded frame
 * scored by ffmpeg's `scdet`, the isolated spikes kept; the rule Video Mask's
 * per-shot masking and the internal scene-cuts step use), and, on request, each
 * shot's first and last decoded frame as an image. The caps, the shot list and
 * the budget are pure and live in `shot-cuts-plan.ts`.
 *
 * Bounded like the internal scene-cuts step: the download is SSRF-checked
 * (`downloadFile` → `safeFetch`) and capped at `SHOT_CUTS_MAX_BYTES`, the clip
 * is refused past `SHOT_CUTS_MAX_DURATION_SEC` before it is decoded, and the
 * probe and both decodes read the local copy only (`SCENE_CUTS_INPUT_ARGS`: no
 * playlist, external reference or second download), through the ffmpeg
 * admission with the clip's predicted peak memory and a kill budget that grows
 * with its length. A refusal that depends only on the file is a
 * `DeterministicJobError` (failed and refunded once, never retried).
 *
 * FRAMES are exact: the scoring decode numbers every frame (`frame:<n>` of the
 * metadata filter), each cut carries the number of the frame its shot starts
 * on, and ONE more decode of the same stream keeps exactly those frames
 * (`select` on `n`, no frame rate applied) — a shot's first frame, and the frame
 * before the next cut (or the clip's last) as its last. Written as PNG, the
 * platform's lossless still (as Extract Frame's).
 */
// @reads-none reads only the clip it downloads into its own work dir
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { SCENE_CUTS_INPUT_ARGS, detectShotCuts, probeSceneCutsClip } from "../../services/scene-cut-frames.js"
import { BIG_MEDIA_DOWNLOAD_LIMITS, cleanupWorkDir, createWorkDir, downloadFile, runFfmpeg } from "./ffmpeg-utils.js"
import { maskGeometryPeakMemoryMiB } from "./video-mask.js"
import {
  SHOT_CUTS_MAX_BYTES,
  SHOT_CUTS_MAX_DURATION_SEC,
  SHOT_CUTS_MAX_FRAME_SHOTS,
  planShots,
  shotCutsDecodeTimeoutMs,
  shotCutsTooLongMessage,
  shotCutsTooManyFramesMessage,
  type PlannedShot,
} from "./shot-cuts-plan.js"

export * from "./shot-cuts-plan.js"

export interface MeasureShotCutsOptions {
  readonly videoUrl: string
  /** Also write every shot's first and last frame. */
  readonly frames?: boolean
}

export interface MeasuredShotCuts {
  /** The directory the frames live in; the caller removes it once they are uploaded. */
  readonly workDir: string
  readonly durationSec: number
  readonly cutsSec: number[]
  readonly shots: PlannedShot[]
  /** With `frames`: each saved frame's file, by frame number. */
  readonly framePaths?: ReadonlyMap<number, string>
}

function refuse(message: string): never {
  throw new DeterministicJobError(message)
}

/** The frame numbers a run saves: every shot's first and last, each once, ascending. */
export function framesToSave(shots: readonly PlannedShot[]): number[] {
  return [...new Set(shots.flatMap((s) => [s.firstFrame, s.lastFrame]))].sort((a, b) => a - b)
}

/** The select expression that keeps exactly these frames (`n`, from 0 in decode order). */
export function selectFramesExpr(frames: readonly number[]): string {
  if (frames.length === 0) throw new RangeError("no frames to select")
  for (const n of frames) if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`frame ${n} is not a frame number`)
  return frames.map((n) => `eq(n,${n})`).join("+")
}

/**
 * Write the clip's frames `frames` (ascending numbers) as PNGs in `dir`, in ONE
 * decode, and return each one's file by number. Throws when ffmpeg wrote a
 * different count (the clip changed between the decodes, or a frame number
 * was past its end).
 */
export async function writeShotFrames(
  localPath: string,
  frames: readonly number[],
  dir: string,
  launch: { readonly timeoutMs: number; readonly peakMemoryMiB: number },
): Promise<Map<number, string>> {
  await runFfmpeg([
    "-v", "error", "-y", ...SCENE_CUTS_INPUT_ARGS, "-i", localPath,
    "-map", "0:v:0", "-an",
    "-vf", `select='${selectFramesExpr(frames)}'`,
    // Each kept frame once, as decoded: no frame rate duplicates or drops one.
    "-fps_mode", "passthrough",
    "-frames:v", String(frames.length),
    join(dir, "frame-%06d.png"),
  ], launch.timeoutMs, { peakMemoryMiB: launch.peakMemoryMiB })
  const written = (await fs.readdir(dir)).filter((f) => /^frame-\d{6}\.png$/.test(f)).sort()
  if (written.length !== frames.length) throw new Error(`shot frames: expected ${frames.length} frames, ffmpeg wrote ${written.length}`)
  return new Map(frames.map((n, i) => [n, join(dir, written[i]!)]))
}

/** Measure the clip at `videoUrl`: its shots, and with `frames` each shot's first and last frame. */
export async function measureShotCuts(options: MeasureShotCutsOptions): Promise<MeasuredShotCuts> {
  const workDir = await createWorkDir("shot-scan")
  try {
    const localPath = join(workDir, "source")
    await downloadFile(options.videoUrl, localPath, { limits: BIG_MEDIA_DOWNLOAD_LIMITS, maxBytes: SHOT_CUTS_MAX_BYTES })
    let probe: { width: number; height: number; durationSec: number }
    try {
      probe = await probeSceneCutsClip(localPath)
    } catch {
      refuse("The file is not a video that can be read (MP4, MOV, MKV or WebM).")
    }
    if (!Number.isFinite(probe.durationSec) || probe.durationSec <= 0) refuse("Could not read the video's length.")
    if (probe.durationSec > SHOT_CUTS_MAX_DURATION_SEC) refuse(shotCutsTooLongMessage(probe.durationSec))

    const launch = { timeoutMs: shotCutsDecodeTimeoutMs(probe.durationSec), peakMemoryMiB: maskGeometryPeakMemoryMiB(probe) }
    const scan = await detectShotCuts(localPath, { ...launch, inputArgs: SCENE_CUTS_INPUT_ARGS })
    if (scan.frameCount === 0) refuse("No frame of this video could be decoded.")
    const plan = planShots(scan.cuts, scan.frameCount, probe.durationSec)

    let framePaths: Map<number, string> | undefined
    if (options.frames) {
      if (plan.shots.length > SHOT_CUTS_MAX_FRAME_SHOTS) refuse(shotCutsTooManyFramesMessage(plan.shots.length))
      const dir = join(workDir, "frames")
      await fs.mkdir(dir)
      framePaths = await writeShotFrames(localPath, framesToSave(plan.shots), dir, launch)
    }
    await fs.rm(localPath, { force: true })
    return { workDir, durationSec: plan.durationSec, cutsSec: plan.cutsSec, shots: plan.shots, ...(framePaths ? { framePaths } : {}) }
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
