/**
 * Clip Pack's built chain (decided 2026-10-14): the shipped `podcast-clip-pack`
 * template, one recording, built from the node's settings. Edit Plan in clips
 * mode plans the pack; its clip set fans the render out, one render per clip.
 * With framing, each clip renders with Speaker View on automatic boxes (the
 * same boxes on every clip, dealt over the episode's speakers); without, with
 * Apply EDL at the recording's shape. Captions caption each clip on its own
 * transcription (a clip cannot be paired with its own remapped transcript), as
 * the template does. Pure: no I/O, fresh objects every call.
 *
 *   source → transcribe (diarized, word timings) → edit-plan (clips) → render, once per clip
 *   source ──────────────────────────────────────→ edit-plan [, apply-edl] (their source)
 *   [framed] transcribe → speaker-view (the turns it switches on)
 *   [captions] each render → add-captions (an Each wire: one per clip)
 *   [frames]   framed and following faces (`framingSource: "tracking"`): ONE
 *              Speaker Frames run over the plan's whole clip set (its `edl`
 *              wire folds the pack, FAN_IN_TARGETS), its tracks — one value —
 *              into every clip's render (use-case-framing.ts)
 *
 * Two or more recordings or a Master audio: the multicam chain
 * (clip-pack-multicam.ts) — Camera Switch once per clip between the plan and
 * the render.
 */
import { ALL_CAPTION_STYLES, type CaptionStyle } from "@nodaro/shared/captions"
import {
  EDIT_PLAN_DEFAULT_CLIP_COUNT,
  EDIT_PLAN_TIERS,
  EDL_TARGET_ASPECTS,
  SPEAKER_SWITCH_IDS,
  clampEditPlanClipCount,
  isKnownSpeakerEmphasisStyle,
  type EdlTargetAspect,
} from "@nodaro/shared/edl"
import { SPEAKER_VIEW_EMPHASIS_ATOMS, SPEAKER_VIEW_LAYOUT_SETTINGS } from "./speaker-view-settings"
import { drawnTightenFraming, type TightenFramingLayout } from "./tighten-episode-graph"
import type {
  ClipsOutputMap,
  PlanTier,
  UseCaseGraph,
  UseCaseGraphEdge,
  UseCaseGraphNode,
  UseCaseMediaKind,
  UseCaseMediaSource,
} from "./use-case-graph"
import { usecaseEdge, usecaseSourceNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { CLIP_PACK_NODE_IDS, clipPackPlanNode, clipPackRenderNode, withClipPackTail } from "./clip-pack-parts"
import { buildClipPackMulticamGraph } from "./clip-pack-multicam"
import { resolveUseCaseCameras, usecaseShapeIsMulticam, type UseCaseCameras, type UseCaseSourcesShape } from "./use-case-cameras"
import { usecaseIsMulticam } from "./use-case-multicam"
import { resolveUseCaseFramingSource, usecaseFramesNode, usecaseFramesWires } from "./use-case-framing"
import type { UseCaseSources } from "./use-case-registry"

/** The shortest and longest clip a pack asks the plan for, in seconds. */
export const CLIP_PACK_MIN_TARGET_SEC = 5
export const CLIP_PACK_MAX_TARGET_SEC = 180

export interface ClipPackFraming {
  readonly aspect: EdlTargetAspect
  readonly layout: TightenFramingLayout
  /** Speaker View's switch at each speaker change. */
  readonly switchType: string
  /** Speaker View's emphasis: a "+"-joined set of atoms, or "none". */
  readonly emphasisStyle: string
}

export const CLIP_PACK_DEFAULT_FRAMING: ClipPackFraming = Object.freeze({ aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale" })

export interface ClipPackSettings {
  readonly count: number
  readonly targetDurationSec: number
  /** null = no framing (an Apply EDL render at the recording's shape); else a Speaker View render. Video only. */
  readonly framing: ClipPackFraming | null
  readonly captions: boolean
  readonly captionStyle: CaptionStyle
  readonly reviewBeforeRender: boolean
  readonly planTier: PlanTier
  readonly instructions: string
  readonly styleGuide: string
  /**
   * The Cameras settings, resolved only for two or more recordings or a Master
   * audio (absent otherwise, so a one-recording run's settings are what they
   * always were); a builder reads absent as the defaults.
   */
  readonly cameras?: UseCaseCameras
  /**
   * Framed and following faces (decided 2026-10-17): Speaker Frames' tracks
   * feed every clip's Speaker View. Resolved only when a framed pack's framing
   * source is `tracking` (absent otherwise: the even split, so every run's
   * settings before it existed read as they always did).
   */
  readonly framingSource?: "tracking"
}

export const CLIP_PACK_DEFAULTS: ClipPackSettings = Object.freeze({
  count: EDIT_PLAN_DEFAULT_CLIP_COUNT,
  targetDurationSec: 60,
  framing: CLIP_PACK_DEFAULT_FRAMING,
  captions: true,
  captionStyle: "karaoke",
  reviewBeforeRender: false,
  planTier: "standard",
  instructions: "",
  styleGuide: "",
})

export { CLIP_PACK_NODE_IDS } from "./clip-pack-parts"

export interface ClipPackSources {
  readonly media: UseCaseMediaSource
}

/** Clip Pack's graph: one clip per planned clip. */
export type ClipPackGraph = UseCaseGraph & { readonly outputMap: ClipsOutputMap }

const includes = (list: readonly string[], v: unknown): v is string => typeof v === "string" && list.includes(v)

/** A Speaker View emphasis this version draws: "none", or "+"-joined known atoms, none repeated. */
export function isClipPackEmphasis(v: unknown): v is string {
  return typeof v === "string" && isKnownSpeakerEmphasisStyle(v)
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
const quotedList = (list: readonly string[]): string => {
  const q = list.map((x) => `"${x}"`)
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}` : (q[0] ?? "")
}
/** What Clip Pack's request body says of an emphasis Speaker View does not draw, named from the atoms it does. */
export const CLIP_PACK_EMPHASIS_REFUSAL = `emphasisStyle is "none", or ${quotedList(SPEAKER_VIEW_EMPHASIS_ATOMS)} joined with "+" (each once)`

/**
 * A framing as a run reads it, field by field (decided 2026-10-18): a field
 * that is missing or unknown takes its default, the valid ones are kept — a
 * bad emphasis never swaps out the aspect or the layout. A missing layout is
 * the default `stacked`. The layout is then snapped as Speaker View draws it
 * at the aspect (`drawnTightenFraming`). `null` = no framing.
 */
function framingOf(raw: unknown): ClipPackFraming | null {
  if (raw === null) return null
  const d = CLIP_PACK_DEFAULT_FRAMING
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d }
  const f = raw as { aspect?: unknown; layout?: unknown; switchType?: unknown; emphasisStyle?: unknown }
  const aspect = includes(EDL_TARGET_ASPECTS, f.aspect) ? (f.aspect as EdlTargetAspect) : d.aspect
  const layout = includes(SPEAKER_VIEW_LAYOUT_SETTINGS, f.layout) ? (f.layout as TightenFramingLayout) : d.layout
  const drawn = drawnTightenFraming(aspect, layout)
  return {
    aspect: drawn.aspect,
    layout: drawn.layout,
    switchType: includes(SPEAKER_SWITCH_IDS, f.switchType) ? f.switchType : d.switchType,
    emphasisStyle: isClipPackEmphasis(f.emphasisStyle) ? f.emphasisStyle : d.emphasisStyle,
  }
}

/**
 * The node's raw settings as a run reads them: every unknown or out-of-range
 * value falls back to its default (never passed on); the count is clamped to
 * 1–50 and the length to 5–180 s. An audio recording makes audio clips: no
 * framing, no captions. `shape` (how many recordings, whether a Master audio
 * is wired) decides whether the Cameras settings are resolved at all; a
 * framing source is kept only when a framed pack follows faces (absent reads
 * the even split: a saved node and an API caller keep their run).
 */
export function resolveClipPackSettings(
  raw: Readonly<Record<string, unknown>> | undefined,
  mediaKind: UseCaseMediaKind,
  shape?: UseCaseSourcesShape,
): ClipPackSettings {
  const r = raw ?? {}
  const d = CLIP_PACK_DEFAULTS
  const audio = mediaKind === "audio"
  const target = typeof r.targetDurationSec === "number" && Number.isFinite(r.targetDurationSec)
    ? Math.min(CLIP_PACK_MAX_TARGET_SEC, Math.max(CLIP_PACK_MIN_TARGET_SEC, Math.round(r.targetDurationSec)))
    : d.targetDurationSec
  const framing = audio ? null : framingOf(r.framing)
  return {
    count: clampEditPlanClipCount(r.count) ?? d.count,
    targetDurationSec: target,
    framing,
    captions: !audio && (typeof r.captions === "boolean" ? r.captions : d.captions),
    captionStyle: includes(ALL_CAPTION_STYLES, r.captionStyle) ? (r.captionStyle as CaptionStyle) : d.captionStyle,
    reviewBeforeRender: r.reviewBeforeRender === true,
    planTier: includes(EDIT_PLAN_TIERS, r.planTier) ? (r.planTier as PlanTier) : d.planTier,
    instructions: typeof r.instructions === "string" ? r.instructions : d.instructions,
    styleGuide: typeof r.styleGuide === "string" ? r.styleGuide : d.styleGuide,
    ...(usecaseShapeIsMulticam(shape) ? { cameras: resolveUseCaseCameras(r.cameras, shape) } : {}),
    ...(framing && resolveUseCaseFramingSource(r.framingSource, "static") === "tracking" ? { framingSource: "tracking" as const } : {}),
  }
}

/**
 * The chain one Clip Pack run executes, built from resolved settings and its
 * inputs. Two or more recordings or a Master audio: the multicam chain
 * (clip-pack-multicam.ts); one recording: P2's chain below, unchanged.
 */
export function buildClipPackGraph(settings: ClipPackSettings, sources: ClipPackSources | UseCaseSources): ClipPackGraph {
  if (usecaseIsMulticam(sources)) return buildClipPackMulticamGraph(settings, sources)
  const ID = CLIP_PACK_NODE_IDS
  const audioIn = sources.media.kind === "audio"
  const pip = audioIn ? "audio" : "video"
  const framing = audioIn ? null : settings.framing
  const nodes: UseCaseGraphNode[] = [
    usecaseSourceNode(ID.source, sources.media, 0, 1),
    usecaseTranscribeNode(ID.transcribe, 1, 0),
    clipPackPlanNode(settings, framing, [ID.source], {}),
    clipPackRenderNode(settings, framing, audioIn ? "audio" : "video", 3),
  ]
  // The clip set fans the render out (Edit Plan's default "each"); Speaker View
  // reads its sources from each clip's edit and needs the transcript for turns.
  const edges: UseCaseGraphEdge[] = [
    usecaseEdge(ID.source, pip, ID.transcribe, "audio"),
    usecaseEdge(ID.source, pip, ID.plan, "sources"),
    ...(framing ? [] : [usecaseEdge(ID.source, pip, ID.render, "sources")]),
    usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
    usecaseEdge(ID.plan, "edl", ID.render, "edl"),
    ...(framing ? [usecaseEdge(ID.transcribe, "json", ID.render, "transcript")] : []),
  ]
  // Following faces: one Speaker Frames run over the whole clip set, after the render, so the even split's graph is unchanged.
  if (framing && settings.framingSource === "tracking") {
    nodes.push(usecaseFramesNode(3, 2))
    edges.push(...usecaseFramesWires({ edl: { nodeId: ID.plan, handle: "edl" }, transcript: { nodeId: ID.transcribe, handle: "json" }, renderId: ID.render }))
  }
  return withClipPackTail(settings, { nodes, edges, framed: !!framing, audio: audioIn, renderColumn: 3 })
}
