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
  UseCaseHandleRef,
  UseCaseMediaKind,
  UseCaseMediaSource,
} from "./use-case-graph"
import { usecaseEdge, usecaseNode, usecaseSourceNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { usecaseTypeOfBuilder } from "./use-case-rows"

/** The shortest and longest clip a pack asks the plan for, in seconds. */
export const CLIP_PACK_MIN_TARGET_SEC = 5
export const CLIP_PACK_MAX_TARGET_SEC = 180

/** The render step: the shipped Speaker View node when framed, else Apply EDL (the template's). */
const FRAMED_RENDER_TYPE = "speaker-view"
const RENDER_TYPE = "apply-edl"

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

export const CLIP_PACK_NODE_IDS = Object.freeze({
  source: "uc-source",
  transcribe: "uc-transcribe",
  plan: "uc-plan",
  render: "uc-render",
  captions: "uc-captions",
} as const)

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
 * framing, no captions.
 */
export function resolveClipPackSettings(raw: Readonly<Record<string, unknown>> | undefined, mediaKind: UseCaseMediaKind): ClipPackSettings {
  const r = raw ?? {}
  const d = CLIP_PACK_DEFAULTS
  const audio = mediaKind === "audio"
  const target = typeof r.targetDurationSec === "number" && Number.isFinite(r.targetDurationSec)
    ? Math.min(CLIP_PACK_MAX_TARGET_SEC, Math.max(CLIP_PACK_MIN_TARGET_SEC, Math.round(r.targetDurationSec)))
    : d.targetDurationSec
  return {
    count: clampEditPlanClipCount(r.count) ?? d.count,
    targetDurationSec: target,
    framing: audio ? null : framingOf(r.framing),
    captions: !audio && (typeof r.captions === "boolean" ? r.captions : d.captions),
    captionStyle: includes(ALL_CAPTION_STYLES, r.captionStyle) ? (r.captionStyle as CaptionStyle) : d.captionStyle,
    reviewBeforeRender: r.reviewBeforeRender === true,
    planTier: includes(EDIT_PLAN_TIERS, r.planTier) ? (r.planTier as PlanTier) : d.planTier,
    instructions: typeof r.instructions === "string" ? r.instructions : d.instructions,
    styleGuide: typeof r.styleGuide === "string" ? r.styleGuide : d.styleGuide,
  }
}

/** The chain one Clip Pack run executes, built from resolved settings and its recording. */
export function buildClipPackGraph(settings: ClipPackSettings, sources: ClipPackSources): ClipPackGraph {
  const ID = CLIP_PACK_NODE_IDS
  const audioIn = sources.media.kind === "audio"
  const pip = audioIn ? "audio" : "video"
  const framing = audioIn ? null : settings.framing
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  const nodes: UseCaseGraphNode[] = [
    usecaseSourceNode(ID.source, sources.media, 0, 1),
    usecaseTranscribeNode(ID.transcribe, 1, 0),
    usecaseNode(ID.plan, "edit-plan", 2, 1, {
      label: "Find Clips", mode: "clips", planTier: settings.planTier, count: settings.count, targetDurationSec: settings.targetDurationSec,
      ...(framing ? { targetAspect: framing.aspect } : {}),
      instructions: settings.instructions,
      ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
      sourceOrder: [ID.source], sourceConfig: {},
    }),
    framing
      ? usecaseNode(ID.render, FRAMED_RENDER_TYPE, 3, 1, {
          label: "Render Clip", quality, targetAspect: framing.aspect, layout: framing.layout,
          switchType: framing.switchType, emphasisStyle: framing.emphasisStyle, autoRegions: true,
        })
      : usecaseNode(ID.render, RENDER_TYPE, 3, 1, { label: "Render Clip", output: audioIn ? "audio" : "video", quality, crossfadeMs: 0 }),
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
  const renderMedia = framing ? "video" : "media"
  let media: UseCaseHandleRef = { nodeId: ID.render, handle: renderMedia }
  if (!audioIn && settings.captions) {
    nodes.push(usecaseNode(ID.captions, "add-captions", 4, 1, {
      label: "Caption Clip", style: settings.captionStyle, wordLevel: true, autoTranscribe: true, position: "bottom", fontSize: 28, color: "#ffffff",
    }))
    // Each clip is captioned on its own: the wire reads the renders one by one.
    edges.push(usecaseEdge(ID.render, renderMedia, ID.captions, "in", true))
    media = { nodeId: ID.captions, handle: "video-out" }
  }
  return {
    nodeType: usecaseTypeOfBuilder("clipPack"),
    nodes,
    edges,
    outputMap: {
      kind: "clips",
      media,
      preview: { nodeId: ID.render, handle: renderMedia },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
    },
  }
}
