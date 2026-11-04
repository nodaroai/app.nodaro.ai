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
import type { Readable } from "node:stream"
import { cleanupWorkDir, createWorkDir, parseFrameRate, runFfmpeg, runFfprobe } from "../providers/video/ffmpeg-utils.js"
import { findSceneCuts, readNumberedSceneScores, readSceneScores, sceneCutFilter, type SceneFrameScore } from "./media-proxy-cuts.js"

/** ffprobe / ffmpeg input options: the local file only, through the containers a recast clip comes in. */
export const SCENE_CUTS_INPUT_ARGS: readonly string[] = ["-protocol_whitelist", "file", "-format_whitelist", "mov,mp4,m4a,matroska,webm"]

/** The clip's first video stream: its size and length (the stream's, else the container's). Throws when it has none. */
export async function probeSceneCutsClip(localPath: string): Promise<{ width: number; height: number; durationSec: number }> {
  const out = await runFfprobe([
    "-v", "error", ...SCENE_CUTS_INPUT_ARGS,
    "-select_streams", "v:0", "-show_entries", "stream=width,height,duration:format=duration", "-of", "json", localPath,
  ])
  const parsed = JSON.parse(out) as { streams?: Array<{ width?: unknown; height?: unknown; duration?: unknown }>; format?: { duration?: unknown } }
  const stream = parsed.streams?.[0]
  const width = Number(stream?.width)
  const height = Number(stream?.height)
  if (!stream || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("not a video")
  const streamSec = Number(stream.duration)
  const durationSec = Number.isFinite(streamSec) && streamSec > 0 ? streamSec : Number(parsed.format?.duration)
  return { width, height, durationSec }
}

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
  /** The picture stream scored (default `0:v:0`; a caller that skips cover art names the stream it reads). */
  readonly map?: string
}

/**
 * The scores of every decoded frame of the clip's first video stream: one
 * decode (`scdet` on every frame, nothing written but the scores), read back
 * by `read`.
 */
async function scoreClipFrames<F extends SceneFrameScore>(
  localPath: string,
  opts: DetectCutFramesOptions,
  read: (input: Readable) => Promise<F[]>,
): Promise<F[]> {
  const workDir = await createWorkDir("scene-cuts")
  try {
    const scores = join(workDir, "scores.txt")
    await runFfmpeg(
      ["-v", "error", ...(opts.inputArgs ?? []), "-i", localPath, "-map", opts.map ?? "0:v:0", "-an", "-vf", sceneCutFilter(scores), "-f", "null", "-"],
      opts.timeoutMs,
      opts.peakMemoryMiB !== undefined || opts.slotSignal
        ? { ...(opts.peakMemoryMiB !== undefined ? { peakMemoryMiB: opts.peakMemoryMiB } : {}), ...(opts.slotSignal ? { signal: opts.slotSignal } : {}) }
        : undefined,
    )
    return await read(createReadStream(scores, "utf8"))
  } finally {
    await cleanupWorkDir(workDir)
  }
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
  const frames = await scoreClipFrames(localPath, opts, readSceneScores)
  if (frames.length === 0) return { cutsSec: [], firstFrameTimeS: null }
  const first = frames[0]!.t
  return { cutsSec: cutTimesFromFirstFrame(findSceneCuts(frames, { isolatedSpikeIsCut: true }), first), firstFrameTimeS: first }
}

/** A cut of `detectShotCuts`: when the new shot starts, and the frame it starts on. */
export interface NumberedCut {
  /** Seconds from the first decoded frame, to the millisecond (a `detectCutTimes` time). */
  readonly sec: number
  /** The decoded frame the new shot starts on: its number from 0 in decode order (a select filter's `n`). */
  readonly frame: number
}

/** The clip's cuts with the frames they start on, and its decoded frames. */
export interface ShotCutScan {
  /** Ascending, each once, never 0: exactly `detectCutTimes`' `cutsSec`, each with its frame. */
  readonly cuts: NumberedCut[]
  /** The number of the last decoded frame + 1 (0 when no frame was scored). */
  readonly frameCount: number
  /** The first decoded frame's time (s), or null when no frame was scored. */
  readonly firstFrameTimeS: number | null
  /** The last decoded frame's time, in seconds from the first one (0 for one frame or none). */
  readonly lastFrameSec: number
}

/**
 * The cuts of numbered frame scores — the same rule and the same times as
 * `detectCutTimes` (`findSceneCuts` with the lone-spike escape, then
 * `cutTimesFromFirstFrame`), each with the number of the frame it starts on.
 * Two cut frames that round to one millisecond keep the earlier frame. Pure.
 */
export function numberedCutsOf(frames: readonly { readonly n: number; readonly t: number; readonly score: number; readonly mafd: number }[]): ShotCutScan {
  if (frames.length === 0) return { cuts: [], frameCount: 0, firstFrameTimeS: null, lastFrameSec: 0 }
  const first = frames[0]!.t
  const frameAt = new Map<number, number>()
  for (const f of frames) if (!frameAt.has(f.t)) frameAt.set(f.t, f.n)
  const bySec = new Map<number, number>()
  for (const t of findSceneCuts(frames, { isolatedSpikeIsCut: true })) {
    const [sec] = cutTimesFromFirstFrame([t], first)
    const frame = frameAt.get(t)
    if (sec === undefined || frame === undefined) continue
    const held = bySec.get(sec)
    if (held === undefined || frame < held) bySec.set(sec, frame)
  }
  const cuts = [...bySec].map(([sec, frame]) => ({ sec, frame })).sort((a, b) => a.sec - b.sec)
  const last = frames[frames.length - 1]!
  const lastFrameSec = Math.max(0, Math.round((last.t - first) * 1000) / 1000)
  let lastN = 0
  for (const f of frames) if (f.n > lastN) lastN = f.n
  return { cuts, frameCount: lastN + 1, firstFrameTimeS: first, lastFrameSec }
}

/**
 * `detectCutTimes` with the frame each cut starts on: the same decode, the
 * same rule, the same times (`numberedCutsOf`), read with each frame's number
 * so a later decode of the same stream can pick a shot's first and last
 * frames exactly (Shot Cuts' frames, Split into Chunks' shots mode).
 */
export async function detectShotCuts(localPath: string, opts: DetectCutFramesOptions = {}): Promise<ShotCutScan> {
  return numberedCutsOf(await scoreClipFrames(localPath, opts, readNumberedSceneScores))
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
