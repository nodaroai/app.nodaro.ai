/**
 * How long the video a length-priced step is given is, the one rule the
 * listing, the server's run estimate and the editor's run estimate read
 * (decided 2026-10-07).
 *
 * Trim, Loop and Combine Videos are priced by the length of what they are
 * given (`videoUtilityBaseCredits`, per 5 seconds of output) and Video SFX by
 * a row per clip length, at most 300 s. Each also passes a length on to the
 * step after it ({@link utilityOutputLength}), so a chain of them is priced
 * by the length that reaches each step.
 *
 * A LISTING knows more about a wire than a run estimate does (an episode the
 * app's user replaces is 60 seconds per minute of it, a generated video is its
 * configured duration), so it keeps its own walk in the backend and shares the
 * pieces here. A RUN estimate ({@link runWireLengthSec}) follows a render's
 * output at the render's own estimated minutes (the ceiling when the episode
 * is unknown, as the render itself is priced) and a chain of these steps, and
 * leaves every other source to its caller.
 */
import { VIDEO_SFX_PRICING, VIDEO_UTIL_PRICING, isRenderNodeType } from "@nodaro/shared"
import {
  renderLengthCeilingMinutes,
  resolveApplyEdlEstimateLength,
  resolveGraphOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "./apply-edl-estimate"

/** The steps charged by the length of the video they are given. */
export const LENGTH_PRICED_UTILITY_TYPES: ReadonlySet<string> = new Set(["trim-video", "loop-video", "combine-videos", "video-sfx"])

/** A wire's input length: seconds that do not depend on the episode, and seconds per minute of it. */
export interface InputLength {
  readonly fixedSec: number
  readonly perEpisodeSec: number
}

/**
 * What a listing knows of a wire's video: its length, or that it is a
 * recording the user replaces whose length has no unit in the listing (a
 * second recording beside the episode, such as an intro card), or nothing.
 */
export type WireLength = InputLength | "replaced-unknown" | undefined

/** The wire's length, when the listing has one. */
export const knownLength = (l: WireLength): InputLength | undefined => (typeof l === "object" ? l : undefined)

/**
 * The longest a Loop's output is in duration mode with no target set: the
 * default `loopVideo` (providers/video/loop-video.ts) renders.
 */
const LOOP_DEFAULT_TARGET_SEC = 10

/**
 * The length a Trim, Loop, Combine Videos or Video SFX passes on, from its
 * input wires' lengths (review round, decided 2026-10-07). Never shorter than
 * a run's output, so a step after it is never listed below its charge:
 * - Trim: a fixed window (`time` with an end, keep the first or last N
 *   seconds) is the window; any other mode is its input's length (a cut only
 *   shortens it).
 * - Loop: duration mode is its target; repeat mode its input's length times
 *   its copy count (the run's default, 2).
 * - Combine Videos: the sum of its inputs, a wire with no known length at the
 *   estimators' fallback, as the Combine's own price counts it.
 * - Video SFX: its input's, at most the 300 seconds a run accepts; on a
 *   length that follows the episode or a recording the user replaces, those
 *   300 seconds, fixed.
 */
export function utilityOutputLength(
  node: { id: string; type?: string | null; data?: unknown },
  inputs: ReadonlyArray<{ targetHandle?: string | null }>,
  lengths: ReadonlyArray<WireLength>,
): WireLength {
  const data = (node.data ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const fixed = (sec: number): InputLength => ({ fixedSec: Math.max(0, sec), perEpisodeSec: 0 })
  const videoWire = inputs.findIndex((e) => e.targetHandle === "video")
  const input = node.type === "video-sfx" && videoWire >= 0 ? lengths[videoWire] : lengths.find((l) => l !== undefined)
  const known = knownLength(input)
  switch (node.type) {
    case "trim-video": {
      const mode = data.trimMode ?? "time"
      const end = num(data.endTime)
      if (mode === "time" && end !== undefined) return fixed(end - (num(data.startTime) ?? 0))
      const keep = num(mode === "keep-first-seconds" ? data.keepFirstSeconds : mode === "keep-last-seconds" ? data.keepLastSeconds : undefined)
      if (keep !== undefined) return fixed(known && known.perEpisodeSec === 0 ? Math.min(known.fixedSec, keep) : keep)
      return input
    }
    case "loop-video": {
      if (data.mode === "duration") return fixed(num(data.targetDuration) ?? LOOP_DEFAULT_TARGET_SEC)
      const copies = Math.max(1, num(data.repeatCount ?? data.loops) ?? 2)
      return known ? { fixedSec: known.fixedSec * copies, perEpisodeSec: known.perEpisodeSec * copies } : input
    }
    case "combine-videos": {
      const each = lengths.map(knownLength)
      if (each.every((l) => l === undefined)) return lengths.includes("replaced-unknown") ? "replaced-unknown" : undefined
      return each.reduce<InputLength>(
        (sum, l) => ({
          fixedSec: sum.fixedSec + (l ? l.fixedSec : VIDEO_UTIL_PRICING.FALLBACK_DURATION_SECONDS),
          perEpisodeSec: sum.perEpisodeSec + (l ? l.perEpisodeSec : 0),
        }),
        { fixedSec: 0, perEpisodeSec: 0 },
      )
    }
    case "video-sfx": {
      if (input === "replaced-unknown" || (known && known.perEpisodeSec > 0)) return fixed(VIDEO_SFX_PRICING.MAX_DURATION_SEC)
      return known ? fixed(Math.min(known.fixedSec, VIDEO_SFX_PRICING.MAX_DURATION_SEC)) : undefined
    }
    default:
      return undefined
  }
}


/**
 * The clip length, in seconds, a RUN estimate prices a Video SFX at, from the
 * lengths of the wires into it (`secs`, in the order of `inputs`;
 * `undefined` where a wire's length is not known): the `video` wire's, else
 * the first wire with a known length (as {@link utilityOutputLength} reads
 * it), at most the 300 seconds a run accepts (decided 2026-10-07). Prompt and
 * negative wires never set it. `undefined` when no length is known: the
 * clip is then priced at {@link VIDEO_SFX_PRICING.FALLBACK_DURATION_SEC}, as
 * an unmeasured clip is charged.
 */
export function videoSfxClipSec(
  inputs: ReadonlyArray<{ targetHandle?: string | null }>,
  secs: ReadonlyArray<number | undefined>,
): number | undefined {
  const videoWire = inputs.findIndex((e) => e.targetHandle === "video")
  const sec = videoWire >= 0 ? secs[videoWire] : secs.find((s) => s !== undefined)
  return sec === undefined ? undefined : Math.min(sec, VIDEO_SFX_PRICING.MAX_DURATION_SEC)
}

/** What a run estimate reads that this module cannot know on its own. */
export interface RunWireLengthOptions {
  /** How an Edit Plan's saved output is read (the editor passes its cached reader). */
  readonly planOutputOf?: EditPlanOutputReader
  /**
   * The length, in seconds, of a source that is neither a render nor one of
   * the length-priced steps (an upload, a generated video): the caller's own
   * read, or `undefined` when it has none (the estimators' fallback then
   * stands in).
   */
  readonly otherSec?: (origin: EstimateGraphNode) => number | undefined
}

/**
 * The length, in seconds, of the video on a wire when a RUN is estimated, or
 * `undefined` when it is not known (the estimators' fallback length stands in,
 * as before): a render's output is the render's estimated minutes at the
 * ceiling ({@link renderLengthCeilingMinutes}, the figure the render itself is
 * priced at); the output of a Trim, Loop, Combine Videos or Video SFX is the
 * length that step passes on, from its own inputs' ({@link utilityOutputLength});
 * any other source is the caller's `otherSec`.
 *
 * @param rerunIds the nodes the priced run executes (empty for a single node).
 */
export function runWireLengthSec(
  sourceId: string | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
  options: RunWireLengthOptions = {},
  /** The steps already walked: a cycle stops at the fallback. */
  seen: ReadonlySet<string> = new Set(),
): number | undefined {
  const origin = resolveGraphOrigin(
    nodes.find((n) => n.id === sourceId),
    nodes,
    edges,
  )
  if (!origin) return undefined
  if (isRenderNodeType(origin.type)) {
    return renderLengthCeilingMinutes(resolveApplyEdlEstimateLength(origin, nodes, edges, rerunIds, options.planOutputOf)) * 60
  }
  if (LENGTH_PRICED_UTILITY_TYPES.has(origin.type ?? "")) {
    if (seen.has(origin.id)) return undefined
    const walked = new Set(seen).add(origin.id)
    const inputs = edges.filter((e) => e.target === origin.id)
    const lengths = inputs.map((e): WireLength => {
      const sec = runWireLengthSec(e.source, nodes, edges, rerunIds, options, walked)
      return sec === undefined ? undefined : { fixedSec: sec, perEpisodeSec: 0 }
    })
    return knownLength(utilityOutputLength(origin, inputs, lengths))?.fixedSec
  }
  return options.otherSec?.(origin)
}
