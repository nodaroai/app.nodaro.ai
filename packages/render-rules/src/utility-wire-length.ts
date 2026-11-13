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
import { VIDEO_SFX_PRICING, VIDEO_UTIL_PRICING } from "@nodaro/shared/credits"
import { extractVideoDurationFromNode } from "@nodaro/shared/video"
import { MASK_COMPOSITE_BOUNDS, maskCompositeLeadHandle, pricedClipSeconds, videoMaskBilledSeconds } from "@nodaro/shared/media"
import { isRenderNodeType } from "@nodaro/shared/nodes"
import {
  renderLengthSec,
  resolveApplyEdlEstimateLength,
  resolveGraphOrigin,
  type EditPlanOutputReader,
  type EstimateGraphEdge,
  type EstimateGraphNode,
} from "./apply-edl-estimate"
import { keptLengthWire } from "./kept-length"
import { RECORDED_OUTPUT_LENGTH_NODE_TYPES } from "./length-following-video"

/** The steps charged by the length of the media they are given. */
export const LENGTH_PRICED_UTILITY_TYPES: ReadonlySet<string> = new Set(["trim-video", "loop-video", "combine-videos", "video-sfx", "pitch-tempo"])

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
 * The fields a Loop run sends its worker, from the node's settings: its mode
 * (default `repeat`), its copy count — `repeatCount`, else the older `loops` a
 * graph may still carry — its target length and its smart loop cut levers.
 * What every run of the node sends (the workflow run's payload, the editor's
 * Run) and what every quote of it prices (the server's estimate, the editor's
 * pill, the length it passes on): the one reading of `loops`.
 */
export function loopVideoRunFields(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    mode: data.mode ?? "repeat",
    repeatCount: data.repeatCount ?? data.loops,
    targetDuration: data.targetDuration,
    smartLoopCutBeforeRepeat: data.smartLoopCutBeforeRepeat,
    smartLoopCutLookback: data.smartLoopCutLookback,
  }
}

/**
 * How far past the end of its cut a Trim with "Lossless (snap to keyframe)"
 * on can run. Its stream copy (`-ss <snapped start> -t <end − snapped>`, the
 * provider's `trimVideo`) ends on whole frames and runs two frames past
 * `-t`, plus the end's rounding up to a frame boundary — measured on H.264/AAC
 * clips with the production-pinned ffmpeg 8.1.2 and with 9.0.2, alike:
 * 0.067–0.083 s at 30 fps, 0.083–0.092 s at 24 fps, 0.20–0.25 s at 10 fps and
 * 0.40–0.55 s at 5 fps. 0.6 s holds down to about 5 frames a second; a
 * sparser clip (a slideshow, a sparse screen recording) can run a little
 * further (1.0 s at 2 fps).
 */
export const LOSSLESS_TRIM_OVERSHOOT_SEC = 0.6

/**
 * The length a Trim with "Lossless (snap to keyframe)" on passes on, at most:
 * its run moves the start back to the keyframe at or before it — so the file
 * can begin seconds before the window — and copies to the end of its cut,
 * running up to {@link LOSSLESS_TRIM_OVERSHOOT_SEC} past it. So never more
 * than the cut's end plus that, and never more than its input:
 * - a time cut with an end, or the first N seconds: that end plus the
 *   overshoot, at most a known input — known whether or not the input is;
 * - seconds mode: a known input less the seconds it trims off the end, plus
 *   the overshoot, at most the input;
 * - the last N seconds: its input's length; on an input of unknown length, N
 *   — a minimum (the snap to an earlier keyframe can only add), never below
 *   what the same cut reads with Lossless off;
 * - a cut that runs to the clip's end (a time cut with no end), or one whose
 *   tail is in frames (its rate is not known here): its input's length —
 *   unknown when the input is.
 */
function losslessTrimLength(mode: unknown, data: Readonly<Record<string, unknown>>, input: WireLength): WireLength {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
  const known = knownLength(input)
  const fixedKnown = known && known.perEpisodeSec === 0 ? known.fixedSec : undefined
  const fixed = (sec: number): InputLength => ({ fixedSec: Math.max(0, sec), perEpisodeSec: 0 })
  const cutEnd = mode === "time" ? num(data.endTime) : mode === "keep-first-seconds" ? num(data.keepFirstSeconds) : undefined
  if (cutEnd !== undefined && cutEnd > 0) {
    const bound = cutEnd + LOSSLESS_TRIM_OVERSHOOT_SEC
    return fixed(fixedKnown === undefined ? bound : Math.min(fixedKnown, bound))
  }
  if (mode === "seconds" && fixedKnown !== undefined) {
    const tail = Math.max(0, num(data.trimEndSeconds) ?? 0)
    return fixed(Math.min(fixedKnown, Math.max(0, fixedKnown - tail) + LOSSLESS_TRIM_OVERSHOOT_SEC))
  }
  if (mode === "keep-last-seconds" && known === undefined) {
    const keep = num(data.keepLastSeconds)
    if (keep !== undefined && keep > 0) return fixed(keep)
  }
  return input
}

/**
 * The real length a length-priced step's run recorded for the video it made
 * (`RECORDED_OUTPUT_LENGTH_NODE_TYPES`: Trim Video measures the file it cut),
 * when it has one: this run's (`fresh`), for the video `url` when one is
 * named; else the length recorded with the saved result that IS that video
 * (`url`, else this run's video, else the take the node hands on). Never
 * another file's: a video none of the saved results describe has none.
 * `undefined` for a step that records none (Loop, Combine Videos, …) and for a
 * take from before the step recorded it.
 */
function recordedOutputLengthSec(
  origin: EstimateGraphNode,
  url: string | undefined,
  fresh: RunOutputLengths | undefined,
): number | undefined {
  if (!RECORDED_OUTPUT_LENGTH_NODE_TYPES.has(origin.type ?? "")) return undefined
  const wanted = url?.trim() || undefined
  const freshSec = positiveSec(fresh?.durationSec)
  if (freshSec !== undefined && (wanted === undefined || fresh?.videoUrl?.trim() === wanted)) return freshSec
  const data = origin.data as Record<string, unknown> | undefined
  const video = wanted ?? (fresh?.videoUrl?.trim() || undefined)
  if (video !== undefined) return recordedLengthOfUrl(data, video)
  if (fresh !== undefined) return undefined
  const rows = Array.isArray(data?.generatedResults) ? (data.generatedResults as Array<{ url?: unknown; duration?: unknown } | null>) : []
  const row = rows[typeof data?.activeResultIndex === "number" ? data.activeResultIndex : 0]
  return typeof row?.url === "string" && row.url.trim() !== "" ? positiveSec(row.duration) : undefined
}

/**
 * The length a Trim, Loop, Combine Videos or Video SFX passes on, from its
 * input wires' lengths (review round, decided 2026-10-07). Never shorter than
 * a run's output, so a step after it is never listed below its charge:
 * - Trim: a fixed window (`time` with an end after 0, keep the first or last
 *   N seconds) is the window; any other mode is its input's length (a cut only
 *   shortens it) — a time cut whose end is 0 runs to the clip's end, as its
 *   run sends it (`trimVideoRunFields`). With "Lossless (snap to keyframe)"
 *   on (any mode but the smart loop cut, which never snaps), at most the end
 *   of its cut plus {@link LOSSLESS_TRIM_OVERSHOOT_SEC}, never past its input
 *   ({@link losslessTrimLength}). The Trim's own price is still its window.
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
      // A keyframe-snapped cut is not its window (see above).
      if (data.losslessKeyframe === true && mode !== "smart-loop-cut") return losslessTrimLength(mode, data, input)
      const end = num(data.endTime)
      if (mode === "time" && end !== undefined && end > 0) return fixed(end - (num(data.startTime) ?? 0))
      const keep = num(mode === "keep-first-seconds" ? data.keepFirstSeconds : mode === "keep-last-seconds" ? data.keepLastSeconds : undefined)
      if (keep !== undefined) return fixed(known && known.perEpisodeSec === 0 ? Math.min(known.fixedSec, keep) : keep)
      return input
    }
    case "loop-video": {
      const run = loopVideoRunFields(data)
      if (run.mode === "duration") return fixed(num(run.targetDuration) ?? LOOP_DEFAULT_TARGET_SEC)
      const copies = Math.max(1, num(run.repeatCount) ?? 2)
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
    case "pitch-tempo": {
      // Audio is stretched by 1 / tempo (at most ×2, tempo ≥ 0.5) and a video
      // passes through whole (tempo is fixed at 1× there); which one the run
      // gets is not known before it, so the longer of the two is passed on.
      if (!known) return input
      const tempo = num(data.tempo)
      const stretch = tempo !== undefined && tempo > 0 ? 1 / Math.min(1, Math.max(0.5, tempo)) : 1
      return { fixedSec: known.fixedSec * stretch, perEpisodeSec: known.perEpisodeSec * stretch }
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
  const sec = secs[clipWireIndex(inputs, secs)]
  return sec === undefined ? undefined : Math.min(sec, VIDEO_SFX_PRICING.MAX_DURATION_SEC)
}

/**
 * The clip length, in seconds, a RUN estimate prices a Video Depth at, from
 * the lengths of the wires into it (`secs`, in the order of `inputs`): the
 * `video` wire's, else the first wire with a known length — the wire
 * {@link videoSfxClipSec} reads, without its 300-second clamp (a Video Depth
 * row past its provider's limit is that provider's highest reachable row).
 * `undefined` when no length is known: the highest row.
 */
export function videoDepthClipSec(
  inputs: ReadonlyArray<{ targetHandle?: string | null }>,
  secs: ReadonlyArray<number | undefined>,
): number | undefined {
  const i = clipWireIndex(inputs, secs)
  return i < 0 ? undefined : secs[i]
}

/** The wire whose clip a Video SFX / Video Mask / Video Depth is priced by: the `video` wire, else the first with a known length (-1: none). */
function clipWireIndex(inputs: ReadonlyArray<{ targetHandle?: string | null }>, secs: ReadonlyArray<number | undefined>): number {
  const videoWire = inputs.findIndex((e) => e.targetHandle === "video")
  return videoWire >= 0 ? videoWire : secs.findIndex((s) => s !== undefined)
}

/**
 * The PRICED length, in seconds, a RUN estimate quotes a Video Mask at: the
 * clip {@link videoSfxClipSec} reads, at the 30 fps basis billing charges by
 * (`videoMaskBilledSeconds`) when that same wire carries a frame rate
 * (`fpss`, in the order of `inputs`; {@link forwardedVideoFps}), else its own
 * length, as before, through `pricedClipSeconds` as a run is priced. A length
 * that is not positive stays as it is, and `undefined` when no length is known:
 * the longest row.
 */
export function videoMaskClipSec(
  inputs: ReadonlyArray<{ targetHandle?: string | null }>,
  secs: ReadonlyArray<number | undefined>,
  fpss: ReadonlyArray<number | undefined>,
): number | undefined {
  const sec = videoSfxClipSec(inputs, secs)
  if (sec === undefined || sec <= 0) return sec
  return pricedClipSeconds(videoMaskBilledSeconds(sec, fpss[clipWireIndex(inputs, secs)]))
}

/**
 * The length, in seconds, a RUN estimate prices a Mask Composite at: its
 * leading video's (`maskCompositeLeadHandle`). The video fill reads the
 * foreground exactly as {@link videoSfxClipSec} does; pixelate / blur read
 * the `background-video` wire only (a wired foreground is ignored by those
 * fills). `undefined` when that length is not known: the 300-second cap.
 */
export function maskCompositeLeadSec(
  data: Readonly<Record<string, unknown>> | null | undefined,
  inputs: ReadonlyArray<{ targetHandle?: string | null }>,
  secs: ReadonlyArray<number | undefined>,
): number | undefined {
  const lead = maskCompositeLeadHandle(data)
  const wire = inputs.findIndex((e) => e.targetHandle === lead)
  // The video fill falls back to the first wire with a known length (Video SFX's reading); pixelate / blur read the background only.
  const sec = wire >= 0 ? secs[wire] : lead === "video" ? secs.find((s) => s !== undefined) : undefined
  // Mask Composite's own cap (the same 300 s as Video SFX today, but never tied to it).
  return sec === undefined ? undefined : Math.min(sec, MASK_COMPOSITE_BOUNDS.MAX_DURATION_SEC)
}

/**
 * Sources whose run hands on the file at their `url` field (backend
 * `output-extractor.ts` and the editor's `execution-graph.ts` both read an
 * Upload Video as `data.url`). Pasting a link into one, a copilot or MCP write,
 * an import: each can change `url` without clearing the results of earlier
 * uploads, so a result's recorded length describes THIS node's video only
 * while that result is the file at `url`.
 */
const URL_OUTPUT_VIDEO_TYPES: ReadonlySet<string> = new Set(["upload-video"])

const positiveSec = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

/** A saved result row's recorded length, for the row that holds `url`. */
function recordedLengthOfUrl(data: Record<string, unknown> | undefined, url: string): number | undefined {
  const results = Array.isArray(data?.generatedResults) ? (data.generatedResults as Array<{ url?: unknown; duration?: unknown }>) : []
  for (const r of results) {
    if (typeof r?.url === "string" && r.url.trim() === url) {
      const sec = positiveSec(r.duration)
      if (sec !== undefined) return sec
    }
  }
  return undefined
}

/**
 * The length, in seconds, of the video a source that is neither a render nor
 * a length-priced step passes on, as a workflow RUN hands it to the step after
 * it: the node's recorded result length, else its configured duration
 * (`extractVideoDurationFromNode`). An upload's is the length measured when it
 * was uploaded — and only while that upload is still the file the node hands
 * on: a link pasted over it later reads as unknown (or the `duration` declared
 * on the node), never the earlier file's length (decided 2026-10-13). The run forwards exactly this as the step's
 * upstream length (backend `input-resolver.ts` → `upstreamDuration`), and the
 * run estimates (the editor's and the server's) read a wire through this one
 * function. An upload's length is the server's measurement of the file, the
 * reading Trim, Loop and Combine Videos now measure before they reserve.
 * `undefined` when the node records no length: the estimators' fallback length
 * stands in.
 */
export function forwardedVideoLengthSec(origin: { readonly type?: string | null; readonly data?: unknown }): number | undefined {
  const data = origin.data as Record<string, unknown> | undefined
  if (URL_OUTPUT_VIDEO_TYPES.has(origin.type ?? "")) {
    const url = typeof data?.url === "string" ? data.url.trim() : ""
    // A length declared with the node (`duration`, as a workflow written
    // through the API may carry) stands when no saved result is its file.
    return url === "" ? undefined : (recordedLengthOfUrl(data, url) ?? positiveSec(data?.duration))
  }
  return extractVideoDurationFromNode(data)
}

/**
 * The frame rate of the video a source passes on, when the estimate can know
 * it: an upload that declares one with the node (`fps`, a positive number —
 * as a workflow written through the API may carry it beside `duration`),
 * only while the node holds a file (`url`), as {@link forwardedVideoLengthSec}
 * reads its length. `undefined` otherwise: the clip is priced at the 30 fps
 * basis, as before. Only Video Mask is priced by it ({@link videoMaskClipSec}).
 */
export function forwardedVideoFps(origin: { readonly type?: string | null; readonly data?: unknown }): number | undefined {
  if (!URL_OUTPUT_VIDEO_TYPES.has(origin.type ?? "")) return undefined
  const data = origin.data as Record<string, unknown> | undefined
  const url = typeof data?.url === "string" ? data.url.trim() : ""
  return url === "" ? undefined : positiveSec(data?.fps)
}

/** The steps whose output keeps the frame rate of the video they are given. */
const RATE_KEEPING_UTILITY_TYPES: ReadonlySet<string> = new Set(["trim-video", "loop-video"])

/**
 * The frame rate of the video on a wire when a RUN is estimated, or
 * `undefined` when it is not known (the 30 fps basis): an upload's declared
 * rate ({@link forwardedVideoFps}), carried through the steps that keep it, the
 * way {@link runWireLengthSec} carries the length (decided 2026-10-21):
 * - Trim and Loop: the rate of the video they are given (a cut or a repeat
 *   never changes it).
 * - Combine Videos: the rate its clips share, when every clip's is known and
 *   they agree (the run conforms them to it, at most 60 fps —
 *   `pickTargetFps`); clips at different or unknown rates: unknown.
 * Any other step: unknown. Only Video Mask is priced by it
 * ({@link videoMaskClipSec}); the editor's and the server's run estimates both
 * read a wire through this one function.
 */
export function runWireFps(
  sourceId: string | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  /** The steps already walked: a cycle stops at unknown. */
  seen: ReadonlySet<string> = new Set(),
): number | undefined {
  const origin = resolveGraphOrigin(
    nodes.find((n) => n.id === sourceId),
    nodes,
    edges,
  )
  if (!origin) return undefined
  const type = origin.type ?? ""
  if (!RATE_KEEPING_UTILITY_TYPES.has(type) && type !== "combine-videos") return forwardedVideoFps(origin)
  if (seen.has(origin.id)) return undefined
  const walked = new Set(seen).add(origin.id)
  const rates = edges.filter((e) => e.target === origin.id).map((e) => runWireFps(e.source, nodes, edges, walked))
  if (RATE_KEEPING_UTILITY_TYPES.has(type)) return rates.find((r) => r !== undefined)
  // Combine Videos: one shared rate, keyed to 0.001 as the run tallies them (29.97 = 30000/1001).
  const first = rates[0]
  if (first === undefined || rates.some((r) => r === undefined || Math.round(r * 1000) !== Math.round(first * 1000))) return undefined
  return Math.min(60, Math.max(1, first))
}

/**
 * What a run already knows of a source's output that its saved node data does
 * not hold yet: the backend engine's `nodeStates[id].output` for a node that
 * ran in this execution. Only the fields the length read uses.
 */
export interface RunOutputLengths {
  /** The video the node handed on. */
  readonly videoUrl?: string
  /** Its real length, when the node measured or recorded it (a render, UGC Clip, Video Overlay). */
  readonly durationSec?: number
  /** A list the node handed on, and each row's notes (`durationSec`: that row's real length), row-aligned. */
  readonly listResults?: readonly string[]
  readonly listResultMeta?: ReadonlyArray<{ readonly durationSec?: number | null } | null | undefined>
}

/** The row-aligned list of a source: this run's, else the one its last run saved on the node. */
function listRowsOf(data: Record<string, unknown> | undefined, fresh: RunOutputLengths | undefined): Pick<RunOutputLengths, "listResults" | "listResultMeta"> {
  if (fresh?.listResults && fresh.listResults.length > 0) return fresh
  const rows = Array.isArray(data?.__listResults) ? (data.__listResults as string[]) : undefined
  const meta = Array.isArray(data?.__listResultMeta) ? (data.__listResultMeta as RunOutputLengths["listResultMeta"]) : undefined
  return { listResults: rows, listResultMeta: meta }
}

/**
 * The rows a Bundle wire (`outputMode: "all"`) handed its target: the list
 * its source last produced (this run's, else its saved one), with the id of
 * the node that holds them. `undefined` for any other wire, or a source with
 * no list.
 */
function bundleRows(
  edge: EstimateGraphEdge & { readonly data?: unknown },
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  freshOutputOf: ((nodeId: string) => RunOutputLengths | undefined) | undefined,
): (readonly string[] & { readonly sourceId: string }) | undefined {
  if ((edge.data as { outputMode?: unknown } | undefined)?.outputMode !== "all") return undefined
  const source = resolveGraphOrigin(
    nodes.find((n) => n.id === edge.source),
    nodes,
    edges,
  )
  if (!source) return undefined
  const rows = listRowsOf(source.data as Record<string, unknown> | undefined, freshOutputOf?.(source.id)).listResults?.filter((r) => typeof r === "string" && r !== "")
  return rows && rows.length > 0 ? Object.assign([...rows], { sourceId: source.id }) : undefined
}

/**
 * The length, in seconds, a workflow RUN forwards to the step after a source
 * for the video `url` on a wire from `sourceId` — the one place both engines
 * read it (decided 2026-10-13). Trim, Loop and Combine Videos are no longer
 * CHARGED by it: their runs measure each clip before they reserve, and the
 * measurement replaces this length on the job (backend
 * lib/video-utility-length.ts); steps that read an upstream length as a hint
 * (Video Analysis, Video Audit) still read it:
 *
 * - The output of a Trim, Loop, Combine Videos, Video SFX or Pitch & Tempo:
 *   the length that step passes on ({@link utilityOutputLength}) from what
 *   reached it, read the same way. This is the rule the run estimates price a
 *   chain with ({@link runWireLengthSec}), so a chain is charged what it was
 *   quoted.
 * - A row of a list (a Bundle of UGC Finish's or UGC Clip's clips): that row's
 *   own real length (`listResultMeta[i].durationSec`), never the node's.
 * - A node that measured its output in this run (a render — the length of
 *   the cut it rendered —, UGC Clip, Video Overlay): that length.
 * - A saved result that is `url`: its recorded length.
 * - Anything else: {@link forwardedVideoLengthSec} — the node's recorded or
 *   configured length. A `url` that is none of the node's saved results is
 *   read at the node's configured duration only, never at another take's
 *   length.
 * - A step whose output is exactly as long as an input (Add Captions, a Mix
 *   Audio that ends with its voice, … — `keptLengthWire`, `exact`) and knows
 *   none of its own: the length that input hands it (decided 2026-10-16).
 *
 * `undefined` when none is known: the step's fallback length stands in, as
 * before. A render whose length was never recorded stays unknown here (its
 * estimate holds the ceiling; the run charges the fallback).
 */
export function runForwardedVideoLengthSec(
  sourceId: string,
  url: string | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  freshOutputOf?: (nodeId: string) => RunOutputLengths | undefined,
  seen: ReadonlySet<string> = new Set(),
): number | undefined {
  const origin = resolveGraphOrigin(
    nodes.find((n) => n.id === sourceId),
    nodes,
    edges,
  )
  if (!origin) return undefined
  if (LENGTH_PRICED_UTILITY_TYPES.has(origin.type ?? "")) {
    // The real length the step's run recorded for the file it made (Trim): that, before the length its settings pass on.
    const recorded = recordedOutputLengthSec(origin, url, freshOutputOf?.(origin.id))
    if (recorded !== undefined) return recorded
    if (seen.has(origin.id)) return undefined
    const walked = new Set(seen).add(origin.id)
    // One entry per CLIP that reached the step: a Bundle wire hands it every
    // row of its list, each at that row's own length (as the step's own run
    // was handed them); any other wire one video.
    const inputs: Array<{ targetHandle?: string | null }> = []
    const lengths: WireLength[] = []
    for (const e of edges.filter((edge) => edge.target === origin.id)) {
      const rows = bundleRows(e, nodes, edges, freshOutputOf)
      const secs = rows
        ? rows.map((row) => runForwardedVideoLengthSec(rows.sourceId, row, nodes, edges, freshOutputOf, walked))
        : [runForwardedVideoLengthSec(e.source, undefined, nodes, edges, freshOutputOf, walked)]
      for (const sec of secs) {
        inputs.push(e)
        lengths.push(sec === undefined ? undefined : { fixedSec: sec, perEpisodeSec: 0 })
      }
    }
    return knownLength(utilityOutputLength(origin, inputs, lengths))?.fixedSec
  }
  const data = origin.data as Record<string, unknown> | undefined
  const fresh = freshOutputOf?.(origin.id)
  const wanted = url?.trim() || undefined
  if (wanted !== undefined) {
    const rows = listRowsOf(data, fresh)
    const row = rows.listResults?.indexOf(wanted) ?? -1
    if (row >= 0) {
      const sec = positiveSec(rows.listResultMeta?.[row]?.durationSec)
      if (sec !== undefined) return sec
    }
  }
  const freshSec = positiveSec(fresh?.durationSec)
  if (freshSec !== undefined && (wanted === undefined || fresh?.videoUrl?.trim() === wanted)) return freshSec
  // A step that keeps an input's length and recorded none of its own: the
  // length that input hands it (decided 2026-10-16, kept-length.ts).
  const kept = (): number | undefined => {
    // Only a step whose output is exactly its input's length: a charge never
    // counts length a provider step may not have returned.
    const wire = seen.has(origin.id) ? undefined : keptLengthWire(origin, nodes, edges, new Set(), "exact")
    return wire ? runForwardedVideoLengthSec(wire.source, undefined, nodes, edges, freshOutputOf, new Set(seen).add(origin.id)) : undefined
  }
  if (wanted === undefined) return forwardedVideoLengthSec(origin) ?? kept()
  const recorded = recordedLengthOfUrl(data, wanted)
  if (recorded !== undefined) return recorded
  // A take none of the saved results describe (this run's own, a row with no
  // notes): the node's configured length, never another take's.
  return positiveSec(data?.duration) ?? kept()
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
 * ceiling ({@link renderLengthSec}, the figure the render itself is
 * priced at); the output of a Trim, Loop, Combine Videos or Video SFX is the
 * length that step passes on, from its own inputs' ({@link utilityOutputLength});
 * any other source is the caller's `otherSec`, and when that has none and the
 * source keeps an input's length (Add Captions, a Mix Audio that ends with its
 * voice, … — `keptLengthWire`, decided 2026-10-16), that input's length.
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
    return renderLengthSec(resolveApplyEdlEstimateLength(origin, nodes, edges, rerunIds, options.planOutputOf))
  }
  if (LENGTH_PRICED_UTILITY_TYPES.has(origin.type ?? "")) {
    // A step that does not run again hands on its take: the real length its run recorded for it (Trim), when it did.
    if (!rerunIds.has(origin.id)) {
      const recorded = recordedOutputLengthSec(origin, undefined, undefined)
      if (recorded !== undefined) return recorded
    }
    if (seen.has(origin.id)) return undefined
    const walked = new Set(seen).add(origin.id)
    const inputs = edges.filter((e) => e.target === origin.id)
    const lengths = inputs.map((e): WireLength => {
      const sec = runWireLengthSec(e.source, nodes, edges, rerunIds, options, walked)
      return sec === undefined ? undefined : { fixedSec: sec, perEpisodeSec: 0 }
    })
    return knownLength(utilityOutputLength(origin, inputs, lengths))?.fixedSec
  }
  const own = options.otherSec?.(origin)
  if (own !== undefined || seen.has(origin.id)) return own
  // A step that keeps an input's length (kept-length.ts): that input's.
  const wire = keptLengthWire(origin, nodes, edges)
  return wire ? runWireLengthSec(wire.source, nodes, edges, rerunIds, options, new Set(seen).add(origin.id)) : undefined
}
