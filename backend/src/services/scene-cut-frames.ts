/**
 * SCENE CUTS of a local clip, as FRAME INDICES — where each new shot starts.
 *
 * Video Mask's `perShot` uses them: a text-prompted tracker started on the
 * first shot finds no new subject after a hard cut, so every shot is segmented
 * on its own (and a held mask never crosses a cut).
 *
 * The rule is the media proxy's (`media-proxy-cuts.ts`): ffmpeg's `scdet`
 * scores every decoded frame, and `findSceneCuts` keeps the isolated spikes
 * that do not return (a camera flash is not a cut). Its times are seconds from
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
}

/**
 * The frame indices where a new shot starts in the clip at `localPath`, at
 * its constant `frameRate`: one decode (`scdet` on every frame, nothing
 * written but the scores), then the proxy's cut rule. Sorted, never 0; `[]`
 * for a single shot (a flash included).
 */
export async function detectCutFrames(localPath: string, frameRate: string, opts: DetectCutFramesOptions = {}): Promise<number[]> {
  const workDir = await createWorkDir("scene-cuts")
  try {
    const scores = join(workDir, "scores.txt")
    await runFfmpeg(
      ["-v", "error", "-i", localPath, "-map", "0:v:0", "-an", "-vf", sceneCutFilter(scores), "-f", "null", "-"],
      opts.timeoutMs,
      opts.peakMemoryMiB !== undefined ? { peakMemoryMiB: opts.peakMemoryMiB } : undefined,
    )
    const frames = await readSceneScores(createReadStream(scores, "utf8"))
    if (frames.length === 0) return []
    return cutTimesToFrames(findSceneCuts(frames), frames[0]!.t, frameRate)
  } finally {
    await cleanupWorkDir(workDir)
  }
}
