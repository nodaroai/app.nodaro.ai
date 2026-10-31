/**
 * Which mask frame goes with which clip frame — pure.
 *
 * A mask with the clip's own frame count is read frame for frame (index to
 * index). Video Mask re-encodes a variable-rate clip to a constant rate first
 * (`planVideoMaskSource`), so the mask of such a clip has ANOTHER frame count
 * than the clip the Cast Swap engine sends: each clip frame is then matched by
 * TIME to the mask frame shown at its moment (the last mask frame that starts
 * at or before it), both clocks counted from their own first frame.
 */

/** Half a millisecond either way is the same moment (container time bases round). */
const SAME_MOMENT_SEC = 0.0005

/** A frame's presentation times from ffprobe's `packet=pts_time` lines: sorted, from the first frame (0). Null when any is unreadable. */
export function frameTimesOf(ptsLines: string): number[] | null {
  const times: number[] = []
  for (const line of ptsLines.split(/\r?\n/)) {
    const v = line.trim().split(",")[0]!
    if (!v) continue
    const t = Number(v)
    if (!Number.isFinite(t)) return null
    times.push(t)
  }
  if (times.length === 0) return null
  times.sort((a, b) => a - b)
  const t0 = times[0]!
  return times.map((t) => t - t0)
}

/**
 * For each clip frame (its time from the clip's first frame), the index of
 * the mask frame shown at that moment: the last mask frame whose time is at or
 * before it, the first one for a clip frame before every mask frame. Both
 * lists sorted ascending. Never decreasing, so a mask decoded in order is read
 * once.
 */
export function maskFramesForClip(clipTimes: readonly number[], maskTimes: readonly number[]): Int32Array {
  const out = new Int32Array(clipTimes.length)
  let j = 0
  for (let i = 0; i < clipTimes.length; i++) {
    const t = clipTimes[i]! + SAME_MOMENT_SEC
    while (j + 1 < maskTimes.length && maskTimes[j + 1]! <= t) j++
    out[i] = j
  }
  return out
}

/**
 * Whether two clocks cover the same stretch of time: their last frames within
 * half a second, or 5 % of the clip, of each other. A mask that is not is not
 * this clip's.
 */
export function sameSpan(clipTimes: readonly number[], maskTimes: readonly number[]): boolean {
  const a = clipTimes.at(-1) ?? 0
  const b = maskTimes.at(-1) ?? 0
  return Math.abs(a - b) <= Math.max(0.5, 0.05 * Math.max(a, b))
}
