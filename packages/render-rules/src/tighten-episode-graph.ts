/**
 * Tighten Episode's built chain (decided 2026-10-13): the shipped
 * `podcast-tighten-episode` template, one recording, built from the node's
 * settings. Pure: no I/O, no provider calls, fresh objects every call.
 *
 *   source → transcribe (diarized, word timings) ─┬→ edit-plan (tighten) → render
 *         → silence-detect ──────────────────────┘
 *   render      Apply EDL; with framing, a Speaker View on automatic boxes
 *               (`autoRegions`: it deals its own default boxes over the
 *               speakers on screen — the builder never draws one)
 *   [captions]  render's media + render's transcript → add-captions
 *   [music]     render's media + music → mix (ducked under the render, ends with it)
 *               video: (captions | render) + mix → merge-video-audio (no original audio)
 *   [frames]    framed and following faces (`framingSource: "tracking"`):
 *               Speaker Frames on the plan's edit and the transcript, its
 *               tracks into Speaker View (use-case-framing.ts)
 *   review on   the render is a proxy preview (`quality: "proxy"`).
 */
import {
  ALL_CAPTION_STYLES,
  type CaptionStyle,
} from "@nodaro/shared/captions"
import {
  EDIT_PLAN_TIERS,
  EDL_TARGET_ASPECTS,
  type EdlTargetAspect,
} from "@nodaro/shared/edl"
import { SPEAKER_VIEW_LAYOUT_SETTINGS } from "./speaker-view-settings"
import { normalizeSpeakerViewData } from "./speaker-view-options"
import type {
  EpisodeOutputMap,
  PlanTier,
  UseCaseGraph,
  UseCaseGraphEdge,
  UseCaseGraphNode,
  UseCaseMediaKind,
  UseCaseMediaSource,
} from "./use-case-graph"
import { usecaseEdge, usecaseNode, usecaseSourceNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { TIGHTEN_FRAMED_RENDER_TYPE, TIGHTEN_NODE_IDS, TIGHTEN_RENDER_TYPE, withTightenTail } from "./tighten-episode-parts"
import { buildTightenMulticamGraph } from "./tighten-episode-multicam"
import { resolveUseCaseCameras, usecaseShapeIsMulticam, type UseCaseCameras, type UseCaseSourcesShape } from "./use-case-cameras"
import { usecaseIsMulticam } from "./use-case-multicam"
import { resolveUseCaseFramingSource, usecaseFramesNode, usecaseFramesWires } from "./use-case-framing"
import type { UseCaseSources } from "./use-case-registry"

export type { PlanTier, UseCaseMediaKind, UseCaseMediaSource } from "./use-case-graph"

/** Edit Plan's and Apply EDL's ceiling: a longer recording is refused up front. */
export const TIGHTEN_MAX_EPISODE_SEC = 180 * 60

export type TightenFramingAspect = EdlTargetAspect
export type TightenFramingLayout = "auto" | "single" | "side-by-side" | "stacked" | "grid" | "pip"
/** Frame the episode with Speaker View: an output aspect and a layout, boxes chosen automatically. */
export interface TightenFraming {
  readonly aspect: TightenFramingAspect
  readonly layout: TightenFramingLayout
}

export interface TightenEpisodeSettings {
  readonly output: UseCaseMediaKind
  /** null = no framing (an Apply EDL render); else a Speaker View render. Video episodes only. */
  readonly framing: TightenFraming | null
  readonly captions: boolean
  readonly captionStyle: CaptionStyle
  readonly reviewBeforeRender: boolean
  readonly planTier: PlanTier
  readonly instructions: string
  readonly styleGuide: string
  readonly musicDuckAmount: number
  /**
   * The Cameras settings, resolved only for two or more recordings or a Master
   * audio (absent otherwise, so a one-recording run's settings are what they
   * always were); a builder reads absent as the defaults.
   */
  readonly cameras?: UseCaseCameras
  /**
   * Framed and following faces (decided 2026-10-17): Speaker Frames' tracks
   * feed Speaker View. Resolved only when a framed video episode's framing
   * source is `tracking` (absent otherwise: the even split, so every run's
   * settings before it existed read as they always did).
   */
  readonly framingSource?: "tracking"
}

export const TIGHTEN_EPISODE_DEFAULTS: TightenEpisodeSettings = Object.freeze({
  output: "video",
  framing: null,
  captions: true,
  captionStyle: "word-highlight",
  reviewBeforeRender: false,
  planTier: "standard",
  instructions: "",
  styleGuide: "",
  musicDuckAmount: 75,
})

export interface TightenEpisodeSources {
  readonly media: UseCaseMediaSource
  readonly music?: { readonly url: string }
}

export { TIGHTEN_NODE_IDS } from "./tighten-episode-parts"

const ID = TIGHTEN_NODE_IDS
const RENDER_TYPE = TIGHTEN_RENDER_TYPE
const FRAMED_RENDER_TYPE = TIGHTEN_FRAMED_RENDER_TYPE
const includes = (list: readonly string[], v: unknown): boolean => typeof v === "string" && list.includes(v)
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback)

/**
 * A framing as Speaker View draws it: a layout its aspect has no renderer for
 * is snapped by Speaker View's own rule (its twin, else grid, else single), so
 * the quote, the stored snapshot and its hash describe what renders. A fresh
 * object either way.
 */
export function drawnTightenFraming(aspect: TightenFramingAspect, layout: TightenFramingLayout): TightenFraming {
  const { data } = normalizeSpeakerViewData({ targetAspect: aspect, layout })
  return { aspect, layout: (typeof data.layout === "string" ? data.layout : layout) as TightenFramingLayout }
}

/** The framing layouts Speaker View draws at `aspect` as chosen (the ones
 *  `drawnTightenFraming` leaves unchanged), in its settings order: what the
 *  node's panel offers, so a pick is never snapped at run time. */
export function tightenFramingLayouts(aspect: TightenFramingAspect): TightenFramingLayout[] {
  return SPEAKER_VIEW_LAYOUT_SETTINGS
    .filter((l) => drawnTightenFraming(aspect, l as TightenFramingLayout).layout === l)
    .map((l) => l as TightenFramingLayout)
}

/**
 * The node's raw settings as a run reads them: every unknown or out-of-range
 * value falls back to its default (never passed on), and a framing layout
 * Speaker View does not draw at its aspect is snapped as the render snaps it.
 * An audio recording makes an audio episode; an audio episode has no captions
 * and no framing. `shape` (how many recordings, whether a Master audio is
 * wired) decides whether the Cameras settings are resolved at all.
 */
export function resolveTightenEpisodeSettings(
  raw: Readonly<Record<string, unknown>> | undefined,
  mediaKind: UseCaseMediaKind,
  shape?: UseCaseSourcesShape,
): TightenEpisodeSettings {
  const r = raw ?? {}
  const d = TIGHTEN_EPISODE_DEFAULTS
  const output: UseCaseMediaKind = mediaKind === "audio" || r.output === "audio" ? "audio" : "video"
  const duck = typeof r.musicDuckAmount === "number" && Number.isFinite(r.musicDuckAmount)
    ? Math.min(100, Math.max(0, Math.round(r.musicDuckAmount)))
    : d.musicDuckAmount
  const f = r.framing as { aspect?: unknown; layout?: unknown } | null | undefined
  const framing: TightenFraming | null =
    output === "video" && f && typeof f === "object" && includes(EDL_TARGET_ASPECTS, f.aspect) && includes(SPEAKER_VIEW_LAYOUT_SETTINGS, f.layout)
      ? drawnTightenFraming(f.aspect as TightenFramingAspect, f.layout as TightenFramingLayout)
      : null
  return {
    output,
    framing,
    captions: output === "video" && (typeof r.captions === "boolean" ? r.captions : d.captions),
    captionStyle: includes(ALL_CAPTION_STYLES, r.captionStyle) ? (r.captionStyle as CaptionStyle) : d.captionStyle,
    reviewBeforeRender: r.reviewBeforeRender === true,
    planTier: includes(EDIT_PLAN_TIERS, r.planTier) ? (r.planTier as PlanTier) : d.planTier,
    instructions: str(r.instructions, d.instructions),
    styleGuide: str(r.styleGuide, d.styleGuide),
    musicDuckAmount: duck,
    ...(usecaseShapeIsMulticam(shape) ? { cameras: resolveUseCaseCameras(r.cameras, shape) } : {}),
    // Absent reads the even split (decided 2026-10-17): a saved node and an API caller keep their run.
    ...(framing && resolveUseCaseFramingSource(r.framingSource, "static") === "tracking" ? { framingSource: "tracking" as const } : {}),
  }
}

/** Tighten Episode's graph: one delivered episode (its output map names no kind, as every P1 snapshot). */
export type TightenEpisodeGraph = UseCaseGraph & { readonly outputMap: EpisodeOutputMap }

/**
 * The chain one Tighten Episode run executes, built from resolved settings and
 * its inputs. Two or more recordings or a Master audio: the multicam chain
 * (tighten-episode-multicam.ts); one recording: P1's chain below, unchanged.
 */
export function buildTightenEpisodeGraph(settings: TightenEpisodeSettings, sources: TightenEpisodeSources | UseCaseSources): TightenEpisodeGraph {
  if (usecaseIsMulticam(sources)) return buildTightenMulticamGraph(settings, sources)
  const audioIn = sources.media.kind === "audio"
  const framing = settings.output === "video" ? settings.framing : null
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  const sourceHandle = audioIn ? "audio" : "video"
  const nodes: UseCaseGraphNode[] = [
    usecaseSourceNode(ID.source, sources.media, 0, 1),
    usecaseTranscribeNode(ID.transcribe, 1, 0),
    usecaseNode(ID.silence, "silence-detect", 1, 2, { label: "Silence Detect", thresholdDb: -35, minSilenceMs: 700, padMs: 120 }),
    usecaseNode(ID.plan, "edit-plan", 2, 1, {
      label: "Tighten Plan", mode: "tighten", planTier: settings.planTier, instructions: settings.instructions,
      ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
      sourceOrder: [ID.source], sourceConfig: {},
    }),
    framing
      ? usecaseNode(ID.render, FRAMED_RENDER_TYPE, 3, 1, {
          label: "Speaker Layout", quality, targetAspect: framing.aspect, layout: framing.layout, autoRegions: true,
        })
      : usecaseNode(ID.render, RENDER_TYPE, 3, 1, { label: "Apply Cut", output: settings.output, quality, crossfadeMs: 0 }),
  ]
  const edges: UseCaseGraphEdge[] = [
    usecaseEdge(ID.source, sourceHandle, ID.transcribe, "audio"),
    usecaseEdge(ID.source, sourceHandle, ID.silence, "in"),
    usecaseEdge(ID.source, sourceHandle, ID.plan, "sources"),
    // Speaker View reads its sources from the edit; Apply EDL takes them wired.
    ...(framing ? [] : [usecaseEdge(ID.source, sourceHandle, ID.render, "sources")]),
    usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
    usecaseEdge(ID.silence, "json", ID.plan, "silence"),
    usecaseEdge(ID.plan, "edl", ID.render, "edl"),
    usecaseEdge(ID.transcribe, "json", ID.render, "transcript"),
  ]
  // Following faces: Speaker Frames after the render, so the even split's graph is unchanged.
  if (framing && settings.framingSource === "tracking") {
    nodes.push(usecaseFramesNode(3, 2))
    edges.push(...usecaseFramesWires({ edl: { nodeId: ID.plan, handle: "edl" }, transcript: { nodeId: ID.transcribe, handle: "json" }, renderId: ID.render }))
  }
  return withTightenTail(settings, sources, { nodes, edges, framed: !!framing })
}
