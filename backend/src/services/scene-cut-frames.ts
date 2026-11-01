/**
 * SCENE CUTS of a local clip, as FRAME INDICES — where each new shot starts.
 *
 * Video Mask's `perShot` uses them: a text-prompted tracker started on the
 * first shot finds no new subject after a hard cut, so every shot is segmented
 * on its own (and a held mask never crosses a cut).
 *
 * The rule is the media proxy's (`media-proxy-cuts.ts`) with its escape for
 * lone spikes (`isolatedSpikeIsCut`): ffmpeg's `scdet` scores every decoded
 * frame, and `findSceneCuts` keeps the isolated spikes that do not return,
 * and every lone spike even if it seems to. A missed cut costs a mask more
 * than an extra one does — a cut that opens on fast motion reads as a flash
 * without the escape, and the last shot's mask is then held on the new one —
 * so a one-frame camera flash may start a shot here. Its times are seconds from
 * the first decoded frame's timestamp; they become frame indices here at the
 * clip's constant rate, counted from that first frame (a source sent as it is
 * may start past 0).
 */

// @reads-none reads only the scene-score file ffmpeg writes into its own work dir
import { createReadStream } from "node:fs"
import { join } from "node:path"
import { cleanupWorkDir, createWorkDir, parseFrameRate, runFfmpeg } from "../providers/video/ffmpeg-utils.js"
import { findSceneCuts, readSceneScores, sceneCutFilter } from "./media-proxy-cuts.js"

/**
 * Cut times (s) → the indices of the frames that start each new shot, at
 * `frameRate` (an ffmpeg rational), counted from `firstFrameTimeS`. Sorted,
 * each once; never 0 (the first shot's start is not a cut). An unreadable
 * rate gives no cuts. Pure.
 */
export function cutTimesToFrames(timesS: readonly number[], firstFrameTimeS: number, frameRate: string): number[] {
  const fps = parseFrameRate(frameRate)
  if (fps === undefined) return []
  const frames = new Set<number>()
  for (const t of timesS) {
    const frame = Math.round((t - firstFrameTimeS) * fps)
    if (frame > 0) frames.add(frame)
  }
  return [...frames].sort((a, b) => a - b)
}

export interface DetectCutFramesOptions {
  /** Kill budget for the scan (default: the ffmpeg default). */
  readonly timeoutMs?: number
  /** The scan's predicted peak memory (default: the launcher's estimate). */
  readonly peakMemoryMiB?: number
  /** Input options placed before `-i` (a caller decoding an untrusted file confines the protocols and demuxers). */
  readonly inputArgs?: readonly string[]
  /** Gives up waiting for the ffmpeg slot when it aborts (`FfmpegLaunchOptions.signal`). */
  readonly slotSignal?: AbortSignal
}

/**
 * Where a new shot starts in the clip at `localPath`, in SECONDS from its
 * first decoded frame: one decode (`scdet` on every frame, nothing written
 * but the scores), then the proxy's cut rule with the lone-spike escape.
 * Ascending, each once, never 0; `[]` for a single shot. What both Video
 * Mask's frames (`detectCutFrames`) and the scene-cuts route
 * (`/v1/video-scene-cuts`) are measured with.
 */
export async function detectCutTimes(localPath: string, opts: DetectCutFramesOptions = {}): Promise<{ readonly cutsSec: number[]; readonly firstFrameTimeS: number | null }> {
  const workDir = await createWorkDir("scene-cuts")
  try {
    const scores = join(workDir, "scores.txt")
    await runFfmpeg(
      ["-v", "error", ...(opts.inputArgs ?? []), "-i", localPath, "-map", "0:v:0", "-an", "-vf", sceneCutFilter(scores), "-f", "null", "-"],
      opts.timeoutMs,
      opts.peakMemoryMiB !== undefined || opts.slotSignal
        ? { ...(opts.peakMemoryMiB !== undefined ? { peakMemoryMiB: opts.peakMemoryMiB } : {}), ...(opts.slotSignal ? { signal: opts.slotSignal } : {}) }
        : undefined,
    )
    const frames = await readSceneScores(createReadStream(scores, "utf8"))
    if (frames.length === 0) return { cutsSec: [], firstFrameTimeS: null }
    const first = frames[0]!.t
    return { cutsSec: cutTimesFromFirstFrame(findSceneCuts(frames, { isolatedSpikeIsCut: true }), first), firstFrameTimeS: first }
  } finally {
    await cleanupWorkDir(workDir)
  }
}

/**
 * Cut times (s, as ffmpeg stamps them) → seconds from the first decoded
 * frame, to the millisecond. Ascending, each once; never 0 or before it (the
 * first shot's start is not a cut). Pure.
 */
export function cutTimesFromFirstFrame(timesS: readonly number[], firstFrameTimeS: number): number[] {
  const out = new Set<number>()
  for (const t of timesS) {
    const s = Math.round((t - firstFrameTimeS) * 1000) / 1000
    if (Number.isFinite(s) && s > 0) out.add(s)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The frame indices where a new shot starts in the clip at `localPath`, at
 * its constant `frameRate` (`detectCutTimes`, counted in frames from the
 * first frame). Sorted, never 0; `[]` for a single shot.
 */
export async function detectCutFrames(localPath: string, frameRate: string, opts: DetectCutFramesOptions = {}): Promise<number[]> {
  const { cutsSec } = await detectCutTimes(localPath, opts)
  return cutTimesToFrames(cutsSec, 0, frameRate)
}
