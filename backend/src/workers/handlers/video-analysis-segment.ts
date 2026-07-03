/**
 * Window cutting + actual-boundary capture + upload for the video-analysis node.
 *
 * `computeWindowPlan` gives NOMINAL targets (k×STRIDE). This module turns each
 * target into a real, keyframe-snapped clip and records the ACTUAL absolute
 * start/end the merge layer needs:
 *   - Stream-copy cut `-ss <keyframe> -i src [-t CUT_LEN] -c copy` — `-ss`
 *     BEFORE `-i` is a keyframe-snapped input seek, and ffmpeg resets the output
 *     PTS to 0, so the LLM's clip-relative timestamps add cleanly onto the
 *     window's absolute start (`abs = startSec + sceneRelative`, per
 *     `mergeWindowResults`). The FINAL window gets NO `-t` (cuts to EOF).
 *   - The absolute start Sₖ is the source keyframe at/before the target (packet
 *     PTS listing — the smart-loop-cut precedent, stable under B-frame reorder).
 *     Eₖ = Sₖ + probed segment duration. A gap guard pulls Sₖ back so
 *     Sₖ₊₁ ≤ Eₖ always holds (the merge owns scenes on these actual boundaries).
 *
 * Single window (≤ SINGLE_MAX): the WHOLE source is the clip — no cut. Its own
 * clean remote URL is used directly when the source needed no normalization,
 * else the normalized local file is uploaded once.
 *
 * All clips upload to the jobId-scoped tmp prefix (`vaTmpKeys`) with NO
 * trackUserId — transient working set, never billed to a user's quota.
 */
import { join } from "node:path"
import { VIDEO_ANALYSIS_WINDOW } from "@nodaro/shared"
import { computeWindowPlan } from "./video-analysis-merge.js"
import type { VaTmpKeys } from "./video-analysis-state.js"
import { runFfmpeg, runFfprobe, getVideoDuration } from "../../providers/video/ffmpeg-utils.js"
import { uploadFileWithKeyToR2 } from "../../lib/storage.js"

const { LEN, OVERLAP } = VIDEO_ANALYSIS_WINDOW
/**
 * Nominal per-window cut length (s): LEN + OVERLAP so that after `-ss` snaps to
 * the keyframe at/before the target, each window still overlaps the next
 * window's start by ≥ OVERLAP (the merge's boundary-duplicate guards depend on
 * this overlap band existing).
 */
const CUT_LEN_SEC = LEN + OVERLAP

export interface CutWindow {
  k: number
  startSec: number
  endSec: number
  /**
   * The tmp R2 KEY of the clip, OR — for the single-window case whose source
   * was already remote-and-clean — the source's own public URL (used directly,
   * never re-uploaded and never deleted by `deleteVaTmp`, which only ever
   * removes deterministic `vaTmpKeys` entries).
   */
  r2Key: string
}

/**
 * Ascending list of source video KEYFRAME presentation timestamps. Uses packet
 * `pts_time` + `flags` (K = keyframe) — decode order ≠ display order with
 * B-frames, so packet PTS is the stable seek target (smart-loop-cut precedent).
 * Always includes 0 as a valid start candidate.
 */
async function sourceKeyframeTimes(srcPath: string): Promise<number[]> {
  const out = await runFfprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-show_packets",
    "-show_entries", "packet=pts_time,flags",
    "-of", "csv=p=0",
    srcPath,
  ])
  const times = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const [pts, flags] = l.split(",")
      return { pts: parseFloat(pts ?? ""), key: (flags ?? "").startsWith("K") }
    })
    .filter((p) => p.key && Number.isFinite(p.pts))
    .map((p) => p.pts)
    .sort((a, b) => a - b)
  if (times.length === 0 || times[0]! > 0) times.unshift(0)
  return times
}

/** The greatest keyframe time at or before `t` (defaults to the first keyframe). */
function keyframeAtOrBefore(kfs: number[], t: number): number {
  let best = kfs[0] ?? 0
  for (const k of kfs) {
    if (k <= t + 1e-6) best = k
    else break
  }
  return best
}

/**
 * Stream-copy cut from `startSec`. Non-final windows take exactly CUT_LEN_SEC;
 * the final window omits `-t` so it runs to EOF. `-ss` before `-i` +
 * `-c copy` = keyframe-snapped, byte-copy fast, output PTS reset to 0.
 */
async function cutWindowClip(
  srcPath: string,
  startSec: number,
  isFinal: boolean,
  outPath: string,
): Promise<void> {
  const args = ["-y", "-ss", startSec.toFixed(3), "-i", srcPath]
  if (!isFinal) args.push("-t", CUT_LEN_SEC.toFixed(3))
  args.push("-c", "copy", "-movflags", "+faststart", outPath)
  await runFfmpeg(args)
}

/**
 * Cut every planned window, capture its ACTUAL boundaries, and upload each clip
 * to its tmp key. Returns the window records the checkpoint + merge consume.
 */
export async function segmentAndUploadWindows(args: {
  localSourcePath: string
  durationSec: number
  tmp: VaTmpKeys
  workDir: string
  cleanRemoteUrl?: string
}): Promise<CutWindow[]> {
  const plan = computeWindowPlan(args.durationSec)

  // Single window: the whole source IS the clip (no cut). Prefer the clean
  // remote URL; otherwise upload the normalized local file once.
  if (plan.length === 1) {
    let r2Key: string
    if (args.cleanRemoteUrl) {
      r2Key = args.cleanRemoteUrl
    } else {
      r2Key = args.tmp.window(0)
      await uploadFileWithKeyToR2(args.localSourcePath, r2Key, "video/mp4")
    }
    return [{ k: 0, startSec: 0, endSec: args.durationSec, r2Key }]
  }

  const kfs = await sourceKeyframeTimes(args.localSourcePath)
  const windows: CutWindow[] = []
  let prevEnd = Number.POSITIVE_INFINITY
  for (let i = 0; i < plan.length; i++) {
    const isFinal = i === plan.length - 1
    let startSec = keyframeAtOrBefore(kfs, plan[i]!.targetStartSec)
    // Gap guard: if keyframe-snapping pushed this start past the previous
    // window's end, re-target an earlier keyframe (≤ prevEnd − OVERLAP) so the
    // actual-boundary ownership in the merge stays gap-free (Sₖ₊₁ ≤ Eₖ).
    if (i > 0 && startSec > prevEnd) {
      startSec = keyframeAtOrBefore(kfs, Math.max(0, prevEnd - OVERLAP))
    }
    const outPath = join(args.workDir, `window-${plan[i]!.k}.mp4`)
    await cutWindowClip(args.localSourcePath, startSec, isFinal, outPath)
    const segDur = await getVideoDuration(outPath)
    const measuredEnd = startSec + segDur
    if (isFinal && measuredEnd < args.durationSec - 1) {
      throw new Error(
        `video-analysis: final window ends at ${measuredEnd.toFixed(2)}s, ` +
          `short of source ${args.durationSec.toFixed(2)}s`,
      )
    }
    const endSec = Math.min(isFinal ? args.durationSec : measuredEnd, args.durationSec)
    const r2Key = args.tmp.window(plan[i]!.k)
    await uploadFileWithKeyToR2(outPath, r2Key, "video/mp4")
    windows.push({ k: plan[i]!.k, startSec, endSec, r2Key })
    prevEnd = endSec
  }
  // Overlap invariant (the gap guard above already enforces it — this is the
  // fail-loud net if a pathological keyframe layout ever slips through).
  for (let i = 1; i < windows.length; i++) {
    if (windows[i]!.startSec > windows[i - 1]!.endSec) {
      throw new Error(
        `video-analysis: window gap between ${windows[i - 1]!.k} and ${windows[i]!.k}`,
      )
    }
  }
  return windows
}

/**
 * Re-cut a SINGLE window from the (re-materialized) source using its STORED
 * boundaries, re-uploading to the same tmp key. The re-entry self-heal for a
 * window clip the aged tmp reaper swept between a stall and the resume.
 */
export async function recutWindowFromSource(args: {
  localSourcePath: string
  window: CutWindow
  durationSec: number
  workDir: string
}): Promise<void> {
  const { localSourcePath, window: w, durationSec, workDir } = args
  const isFinal = w.endSec >= durationSec - 1
  const outPath = join(workDir, `recut-window-${w.k}.mp4`)
  const ff = ["-y", "-ss", w.startSec.toFixed(3), "-i", localSourcePath]
  if (!isFinal) ff.push("-t", Math.max(0.5, w.endSec - w.startSec).toFixed(3))
  ff.push("-c", "copy", "-movflags", "+faststart", outPath)
  await runFfmpeg(ff)
  await uploadFileWithKeyToR2(outPath, w.r2Key, "video/mp4")
}
