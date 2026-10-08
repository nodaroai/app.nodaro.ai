/**
 * SCENE CUTS of a video proxy (P3.2b) — found in the SAME decode that builds
 * the proxy, at the DECODE rate, and stored on the source clock beside the
 * span map.
 *
 * Why here and not later: the detection proxy samples at 2 fps, and at 2 fps a
 * camera cut is indistinguishable from a face that jumped (the holdout linked
 * host and guest into one track 19 times on a 170-minute two-camera episode
 * without a cut list). The decoder already sees every source frame, so a cut
 * costs one `scdet` pass over frames that are decoded anyway, with no second
 * read of the original.
 *
 * What a cut means: a cut at `c` ms starts a new shot at `c` — the source time
 * of the first frame after the change. A consumer counts the cuts at or before
 * a sample's time to know its shot (Speaker Frames' linker never links across
 * one).
 *
 * How a frame is judged (`findSceneCuts`). ffmpeg's `scdet` gives every decoded
 * frame its mean absolute difference to the previous frame (mafd) and a score,
 * min(mafd, |mafd − the previous frame's mafd|). On real footage a bare
 * threshold on that score does not separate cuts from camera work: cuts in a
 * dark interview score 7–10, while a stage pan or a handheld shake scores 5–7
 * on frame after frame, and a camera flash scores 50–60. So a frame is a
 * CANDIDATE when
 *   1. its score reaches the threshold, and
 *   2. it does not RETURN: none of the next `flashFrames` (3) frames has an
 *      mafd of `flashReturn` × its own or more — a flash, held for one frame
 *      or for three, jumps back to the picture before it by about as much as
 *      it jumped in, while the frames after a cut are ordinary motion. A
 *      spike that returns is a FLASH, and so is its jump back: neither is a
 *      candidate (the jump back of a held flash scores as high as its jump in,
 *      and its next frame is ordinary motion, so on its own it would pass);
 * and a candidate is a cut when
 *   3. it is ISOLATED: at least `isolation` × every NON-candidate score within
 *      `windowMs` of it — a cut is a spike, camera motion a plateau.
 * Isolation is measured against the background, not against other candidates:
 * two real cuts closer than the window (A → B → C in 300 ms, a quick reaction
 * insert) would otherwise each see the other as its plateau and both vanish,
 * leaving A, B and C one shot to the linker. Both are kept; two cuts between
 * the same pair of samples only step a sample's shot count by two. A flash
 * fails rule 2, so it stays background (its jump in and its jump back) and a
 * cut beside it is still judged against its 50–60.
 * The window is a constant of the rule, not the proxy's sample period: it is
 * the one that was measured, and a shorter one (a 30 or 60 fps proxy) sees no
 * neighbour at all, so the same source would get different cuts by proxy fps.
 * Gradual transitions (a dissolve, a fade through black) spread the change
 * over many frames and are not isolated spikes: that is the class this misses.
 * So is a flash held for more than `flashFrames` frames, which reads as two
 * cuts (as far as the picture says, it is a shot). And by the same look-ahead,
 * so is a real cut followed within `flashFrames` frames by a change at least
 * `flashReturn` × as large (a second cut, a whip pan): rule 2 cannot tell that
 * from a return, since mafd compares each frame only with the one before it.
 *
 * Pure apart from reading a line stream: `video-proxy-encode.ts` adds the
 * filter, hands the file's lines here and converts the times.
 */
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"

/**
 * The rule's constants. Set 2026-10-08 on the P3.0b holdout's cut ground truth
 * and the CC BY P3.0b clips — never on the frozen P3.0e set, which scores the
 * final verdict (the measurement is in the P3.2b PR). `isolation` and
 * `flashReturn` were fixed by reasoning before scoring; only `threshold` was
 * swept; `windowMs` is the 500 ms it was measured with (one sample period of
 * the 2 fps detection proxy), fixed whatever the proxy's fps. `flashFrames`
 * (decided 2026-10-08) extends rule 2 from the next frame to the next three,
 * so a flash held for two or three frames is not a cut; the rule was then
 * re-scored on the same holdout with the other constants unchanged. Every
 * constant is in `SCENE_CUT_RECIPE`, which keys the proxy, so a change re-encodes rather
 * than serving another rule's cuts.
 */
export const SCENE_CUT = { threshold: 6, isolation: 2, flashReturn: 0.5, flashFrames: 3, windowMs: 500 } as const

/** The rule, as the proxy's cache key and manifest name it. */
export const SCENE_CUT_RECIPE =
  `t${SCENE_CUT.threshold}-r${SCENE_CUT.isolation}-f${SCENE_CUT.flashReturn}x${SCENE_CUT.flashFrames}-w${SCENE_CUT.windowMs}`

/** Characters a path may hold and stay one filter-option value: the graph
 *  parser splits on `:` `,` `;` `[` `]` `'` `\` and whitespace. Our work dirs
 *  never contain them (`createWorkDir`). */
const SAFE_PATH = /^[A-Za-z0-9_\-./]+$/

/**
 * The filter chain that scores every decoded frame: `scdet` computes the
 * scores (its own threshold set out of reach, so it flags nothing — the rule
 * above decides), and `metadata` writes every frame's scores to `file` and
 * passes the frame on untouched. Goes FIRST in the proxy's picture chain,
 * before `fps` drops frames. The file is about 90 bytes per decoded frame
 * (~30 MB for three hours at 30 fps), next to a source many times its size.
 */
export function sceneCutFilter(file: string): string {
  if (!SAFE_PATH.test(file)) throw new Error(`media proxy: scene-cut file path ${JSON.stringify(file)} cannot be passed in a filtergraph`)
  return `scdet=threshold=100,metadata=mode=print:file=${file}`
}

/** One decoded frame's scores: its time (s, from the segment's seek point). */
export interface SceneFrameScore {
  readonly t: number
  readonly score: number
  readonly mafd: number
}

/**
 * Every frame the metadata filter printed, in order, from a line stream (the
 * file can hold millions of lines). A frame with no time (`NOPTS`) or without
 * both scores is skipped rather than given made-up values.
 */
export async function readSceneScores(input: Readable): Promise<SceneFrameScore[]> {
  const out: SceneFrameScore[] = []
  let t = Number.NaN
  let score = Number.NaN
  let mafd = Number.NaN
  const flush = () => {
    if (Number.isFinite(t) && Number.isFinite(score) && Number.isFinite(mafd)) out.push({ t, score, mafd })
  }
  for await (const line of createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })) {
    if (line.startsWith("frame:")) {
      flush()
      const m = /pts_time:(\S+)/.exec(line)
      t = m ? Number(m[1]) : Number.NaN
      score = Number.NaN
      mafd = Number.NaN
    } else if (line.startsWith("lavfi.scd.score=")) {
      score = Number(line.slice("lavfi.scd.score=".length))
    } else if (line.startsWith("lavfi.scd.mafd=")) {
      mafd = Number(line.slice("lavfi.scd.mafd=".length))
    }
  }
  flush()
  return out
}

/**
 * The times (s, from the seek point) of the frames that start a new shot, by
 * the rule at the top of this file. Frames are in decode order.
 */
export function findSceneCuts(frames: readonly SceneFrameScore[]): number[] {
  const windowS = SCENE_CUT.windowMs / 1000
  // Rule 2: a spike followed within flashFrames frames by a change of at least
  // flashReturn × its own mafd is a flash, from its jump in to that change
  // (read as its jump back). Only the change's size is tested, not whether it
  // returns to the picture before the spike, so a real cut followed that soon
  // by a second cut or a whip pan is lost too (the header's known cost). A
  // frame already marked (a flash's jump back) starts no flash of its own.
  const flash = new Array<boolean>(frames.length).fill(false)
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k]
    if (flash[k] || f.score < SCENE_CUT.threshold) continue
    for (let j = 1; j <= SCENE_CUT.flashFrames && k + j < frames.length; j++) {
      if (frames[k + j].mafd >= SCENE_CUT.flashReturn * f.mafd) {
        for (let i = k; i <= k + j; i++) flash[i] = true
        break
      }
    }
  }
  const candidate = frames.map((f, k) => f.score >= SCENE_CUT.threshold && !flash[k])
  const out: number[] = []
  let lo = 0
  for (let k = 0; k < frames.length; k++) {
    if (!candidate[k]) continue
    const f = frames[k]
    while (frames[lo].t < f.t - windowS) lo++
    let background = 0
    for (let j = lo; j < frames.length && frames[j].t <= f.t + windowS; j++) {
      if (!candidate[j] && frames[j].score > background) background = frames[j].score
    }
    if (f.score >= SCENE_CUT.isolation * background) out.push(f.t)
  }
  return out
}

/** Whole microseconds: `10300 + 1.034367 × 1000` is otherwise a float hair off. */
const toMicros = (ms: number) => Math.round(ms * 1000) / 1000

/**
 * A segment's cut times back on the SOURCE clock: the seek point plus the time
 * from it (ffmpeg rebases a segment to its `-ss` point, exactly as the span map
 * assumes). With `lengthMs`, only the cuts inside the span are kept: the input
 * `-t` bounds the read, but a frame decoded at or past the span's end is not
 * the span's. A cut at the segment's first frame cannot exist (nothing came
 * before it), so a time of 0 is dropped.
 */
export function segmentCutsToSourceMs(timesS: readonly number[], seekMs: number, lengthMs?: number): number[] {
  const out: number[] = []
  for (const t of timesS) {
    const fromSeekMs = t * 1000
    if (!(fromSeekMs > 0)) continue
    if (lengthMs !== undefined && fromSeekMs >= lengthMs) continue
    out.push(toMicros(seekMs + fromSeekMs))
  }
  return out
}

/** The segments' cuts as one ascending list, each time once. */
export function mergeSceneCuts(lists: ReadonlyArray<readonly number[]>): number[] {
  return [...new Set(lists.flat())].sort((a, b) => a - b)
}

/** True for a stored cut list: finite, non-negative, strictly ascending. */
export function isSceneCutList(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x, i) => typeof x === "number" && Number.isFinite(x) && x >= 0 && (i === 0 || x > (v[i - 1] as number)))
}
