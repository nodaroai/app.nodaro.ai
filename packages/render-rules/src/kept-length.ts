/**
 * The steps that hand on media as long as one of their inputs (at most, for
 * some), and which input that is (decided 2026-10-16): the one rule the length walks read
 * — the run estimates' ({@link runWireLengthSec}), the run's own charge
 * ({@link runForwardedVideoLengthSec}) and the listing's
 * (`VIDEO_OUTPUT_LENGTH_RULES`, backend), so a length-priced step (Trim, Loop,
 * Combine Videos, Video SFX, Pitch & Tempo) after any of them is priced at the
 * length that really reaches it, never at the estimators' 8-second fallback.
 *
 * - The steps that keep their input's video whole ({@link LENGTH_KEEPING_VIDEO_TYPES}):
 *   their video wire. That set is an UPPER bound (a provider step may return
 *   less), which an estimate and a listing may follow; the run's CHARGE
 *   follows only the steps whose output is exactly as long as their input
 *   ({@link EXACT_LENGTH_VIDEO_TYPES}), never charging for length a provider
 *   did not return.
 * - Mix Audio set to end with the voice (`endAt: "voice"`, the ducked
 *   `duckUnder` track wired in): that track — the mix ends when it ends.
 * - Merge Video Audio, which ends with its longest track: when every track
 *   it is given keeps the length of the SAME node and none starts late, that
 *   node's. (A merge of different media is the longest of them, a rule only
 *   the listing has the arithmetic for.)
 *
 * A Tighten Episode's episode leaves from its render, its captions, or its
 * music mix and merge — each keeps the cut's length, so the step after the
 * node is priced at the cut's length by this rule, not by a special case.
 */
import { DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { resolveGraphOrigin, type EstimateGraphEdge, type EstimateGraphNode } from "./apply-edl-estimate"
import { UNIT_KEPT_LENGTHS } from "./unit-kept-lengths.generated"

/** The node units (tools/units/README.md) with a "length:*" capability: every one for the bound, the "exact" ones for the charge. */
const unitKeptLengthTypes = (mode: KeptLengthMode): string[] =>
  UNIT_KEPT_LENGTHS.filter(([, m]) => mode === "bound" || m === "exact").map(([type]) => type)

/**
 * A hand-written set ∪ its node units, refusing a type that is in both — a
 * type lives in one place (G1; the editor's and the server's composeSet keep
 * the same rule). Throws at module load, so any import of the set fails.
 */
function composeUnits(what: string, legacy: readonly string[], units: readonly string[]): ReadonlySet<string> {
  const clash = units.filter((t) => legacy.includes(t))
  if (clash.length > 0) throw new Error(`${what}: ${clash.join(", ")} is both hand-written and a node unit — a type lives in one place (tools/units/README.md)`)
  return new Set([...legacy, ...units])
}

/**
 * The steps that deliver their input's video whole: the backend listing's
 * `passVideo` rows are built from this set. An upper bound on what each
 * delivers (a provider step may return less). The hand-written steps ∪ every
 * node unit with a "length:pass-video" or "length:exact-video" capability.
 */
export const LENGTH_KEEPING_VIDEO_TYPES: ReadonlySet<string> = composeUnits("LENGTH_KEEPING_VIDEO_TYPES", [
  "add-captions",
  "resize-video",
  "social-media-format",
  "fade-video",
  // The mask has its clip's frames; the composite follows its foreground (the `video` wire).
  "video-mask",
  "mask-composite",
  "transcode-video",
  "video-overlay",
  "switchx",
  "video-upscale",
  "video-depth",
  "face-swap",
  "video-retake",
], unitKeptLengthTypes("bound"))

/**
 * The steps of {@link LENGTH_KEEPING_VIDEO_TYPES} whose output is exactly as
 * long as their input (local FFmpeg passes that never cut): the ones the run's
 * charge follows. The rest are bounds only (a provider step may return less;
 * Social Media Format cuts to the platform's limit). The hand-written steps ∪
 * every node unit with the "length:exact-video" capability.
 */
export const EXACT_LENGTH_VIDEO_TYPES: ReadonlySet<string> = composeUnits("EXACT_LENGTH_VIDEO_TYPES", [
  "add-captions",
  "resize-video",
  "fade-video",
  "transcode-video",
  "video-overlay",
], unitKeptLengthTypes("exact"))

/** How a walk reads a step: `bound` (an estimate or a listing) follows every step that keeps at most its input's length; `exact` (a run's charge) only those that keep exactly it. */
export type KeptLengthMode = "bound" | "exact"

/** The input handles a step takes its main medium on, when it has no `video` handle. */
const MAIN_INPUT_HANDLES: ReadonlySet<string> = new Set(["in", "media"])

const dataOf = (n: EstimateGraphNode): Record<string, unknown> => (n.data ?? {}) as Record<string, unknown>

/** The track a Mix Audio ends with: the ducked voice (`duckUnder`) when it is set to end with it, else none. */
export function mixVoiceTrackId(data: unknown): string | undefined {
  const d = (data ?? {}) as Record<string, unknown>
  return d.endAt === "voice" && typeof d.duckUnder === "string" && d.duckUnder !== "" ? d.duckUnder : undefined
}

/** Does a wire leave a node that hands on a video? */
function carriesVideo(edge: EstimateGraphEdge, nodes: readonly EstimateGraphNode[], edges: readonly EstimateGraphEdge[]): boolean {
  const type = resolveGraphOrigin(nodes.find((n) => n.id === edge.source), nodes, edges)?.type ?? ""
  return VIDEO_PRODUCER_TYPES.has(type) || DYNAMIC_PRODUCER_TYPES.has(type)
}

/**
 * The wire into `node` whose length `node` hands on whole, or `undefined`
 * when it hands on no single input's length (see the module note).
 */
export function keptLengthWire(
  node: EstimateGraphNode,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  /** The nodes already walked: a cycle keeps no length. */
  seen: ReadonlySet<string> = new Set(),
  mode: KeptLengthMode = "bound",
): EstimateGraphEdge | undefined {
  const type = node.type ?? ""
  const into = edges.filter((e) => e.target === node.id)
  if ((mode === "exact" ? EXACT_LENGTH_VIDEO_TYPES : LENGTH_KEEPING_VIDEO_TYPES).has(type)) {
    return (
      into.find((e) => e.targetHandle === "video") ??
      into.find((e) => (e.targetHandle == null || MAIN_INPUT_HANDLES.has(e.targetHandle)) && carriesVideo(e, nodes, edges))
    )
  }
  if (type === "mix-audio") {
    const voice = mixVoiceTrackId(node.data)
    return voice === undefined ? undefined : into.find((e) => e.source === voice)
  }
  if (type === "merge-video-audio") {
    if (into.length === 0) return undefined
    const tracks = (dataOf(node).trackSettings ?? {}) as Record<string, { startTime?: unknown } | undefined>
    if (into.some((e) => { const t = tracks[e.source]?.startTime; return typeof t === "number" && t > 0 })) return undefined
    const walked = new Set(seen).add(node.id)
    const origins = new Set(into.map((e) => keptLengthOrigin(e.source, nodes, edges, walked, mode)?.id))
    return origins.size === 1 && !origins.has(undefined) ? into[0] : undefined
  }
  return undefined
}

/**
 * The node whose length the media leaving `sourceId` has: through teleports
 * and every step that keeps an input's length ({@link keptLengthWire}). The
 * node itself when it keeps none; `undefined` for a missing node.
 */
export function keptLengthOrigin(
  sourceId: string | undefined,
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  /** The nodes already walked (a merge's tracks are walked from inside it): a cycle ends the walk. */
  seen: ReadonlySet<string> = new Set(),
  mode: KeptLengthMode = "bound",
): EstimateGraphNode | undefined {
  let current = resolveGraphOrigin(nodes.find((n) => n.id === sourceId), nodes, edges)
  const visited = new Set(seen)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const wire = keptLengthWire(current, nodes, edges, visited, mode)
    const next = wire ? resolveGraphOrigin(nodes.find((n) => n.id === wire.source), nodes, edges) : undefined
    if (!next) return current
    current = next
  }
  return current
}
