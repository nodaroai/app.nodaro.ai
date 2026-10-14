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
  type EditPlanTier,
} from "@nodaro/shared/edl"
import { SPEAKER_VIEW_LAYOUT_SETTINGS } from "./speaker-view-settings"
import { normalizeSpeakerViewData } from "./speaker-view-options"
import type { UseCaseGraph, UseCaseGraphEdge, UseCaseGraphNode, UseCaseHandleRef } from "./use-case-graph"

export const TIGHTEN_EPISODE = "tighten-episode" as const
/** Edit Plan's and Apply EDL's ceiling: a longer recording is refused up front. */
export const TIGHTEN_MAX_EPISODE_SEC = 180 * 60

export type UseCaseMediaKind = "video" | "audio"
export type PlanTier = EditPlanTier

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

export interface UseCaseMediaSource {
  readonly url: string
  readonly kind: UseCaseMediaKind
  readonly durationSec?: number
}
export interface TightenEpisodeSources {
  readonly media: UseCaseMediaSource
  readonly music?: { readonly url: string }
}

export const TIGHTEN_NODE_IDS = Object.freeze({
  source: "uc-source",
  transcribe: "uc-transcribe",
  silence: "uc-silence",
  plan: "uc-plan",
  render: "uc-render",
  captions: "uc-captions",
  music: "uc-music",
  mix: "uc-mix",
  merge: "uc-merge",
} as const)

const ID = TIGHTEN_NODE_IDS
const RENDER_TYPE = "apply-edl"
const FRAMED_RENDER_TYPE = "speaker-view"
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
 * and no framing.
 */
export function resolveTightenEpisodeSettings(
  raw: Readonly<Record<string, unknown>> | undefined,
  mediaKind: UseCaseMediaKind,
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
  }
}

const node = (id: string, type: string, column: number, row: number, data: Record<string, unknown>): UseCaseGraphNode => ({
  id,
  type,
  position: { x: column * 320, y: row * 220 },
  data: { fieldMappings: {}, ...data },
})
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): UseCaseGraphEdge => ({
  id: `uc-e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
})

/** The chain one Tighten Episode run executes, built from resolved settings and its inputs. */
export function buildTightenEpisodeGraph(settings: TightenEpisodeSettings, sources: TightenEpisodeSources): UseCaseGraph {
  const audioIn = sources.media.kind === "audio"
  const framing = settings.output === "video" ? settings.framing : null
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  const sourceHandle = audioIn ? "audio" : "video"
  // The probed length rides the upload node's declared `metadata.durationSeconds`
  // (unstamped, so `editPlanSourceDurationSec` trusts it) — Edit Plan's and the
  // estimate's length come from it; unknown leaves it off (180-minute ceiling).
  const duration = typeof sources.media.durationSec === "number" && sources.media.durationSec > 0
    ? { metadata: { durationSeconds: sources.media.durationSec } }
    : {}
  const nodes: UseCaseGraphNode[] = [
    node(ID.source, audioIn ? "upload-audio" : "upload-video", 0, 1, {
      label: "Episode recording", assetId: "", url: sources.media.url, ...duration,
    }),
    node(ID.transcribe, "transcribe", 1, 0, { label: "Transcribe", provider: "elevenlabs-stt", language: "auto", diarize: true }),
    node(ID.silence, "silence-detect", 1, 2, { label: "Silence Detect", thresholdDb: -35, minSilenceMs: 700, padMs: 120 }),
    node(ID.plan, "edit-plan", 2, 1, {
      label: "Tighten Plan", mode: "tighten", planTier: settings.planTier, instructions: settings.instructions,
      ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
      sourceOrder: [ID.source], sourceConfig: {},
    }),
    framing
      ? node(ID.render, FRAMED_RENDER_TYPE, 3, 1, {
          label: "Speaker Layout", quality, targetAspect: framing.aspect, layout: framing.layout, autoRegions: true,
        })
      : node(ID.render, RENDER_TYPE, 3, 1, { label: "Apply Cut", output: settings.output, quality, crossfadeMs: 0 }),
  ]
  const edges: UseCaseGraphEdge[] = [
    edge(ID.source, sourceHandle, ID.transcribe, "audio"),
    edge(ID.source, sourceHandle, ID.silence, "in"),
    edge(ID.source, sourceHandle, ID.plan, "sources"),
    // Speaker View reads its sources from the edit; Apply EDL takes them wired.
    ...(framing ? [] : [edge(ID.source, sourceHandle, ID.render, "sources")]),
    edge(ID.transcribe, "json", ID.plan, "transcript"),
    edge(ID.silence, "json", ID.plan, "silence"),
    edge(ID.plan, "edl", ID.render, "edl"),
    edge(ID.transcribe, "json", ID.render, "transcript"),
  ]
  const renderMediaHandle = framing ? "video" : "media"
  let media: UseCaseHandleRef = { nodeId: ID.render, handle: renderMediaHandle }

  if (settings.output === "video" && settings.captions) {
    nodes.push(node(ID.captions, "add-captions", 4, 0, {
      label: "Add Captions", style: settings.captionStyle, wordLevel: false, position: "bottom", fontSize: 24, color: "#ffffff",
    }))
    // Apply EDL's remapped transcript is its `json`; Speaker View's is its `transcript` pip.
    edges.push(edge(ID.render, renderMediaHandle, ID.captions, "in"), edge(ID.render, framing ? "transcript" : "json", ID.captions, "transcript"))
    media = { nodeId: ID.captions, handle: "video-out" }
  }

  if (sources.music) {
    nodes.push(
      node(ID.music, "upload-audio", 3, 3, { label: "Music bed", assetId: "", url: sources.music.url }),
      node(ID.mix, "mix-audio", 4, 2, {
        label: "Music under episode", trackCount: 2, trackVolumes: {}, trackOrder: [ID.render, ID.music],
        duckUnder: ID.render, duckAmount: settings.musicDuckAmount, endAt: "voice",
      }),
    )
    edges.push(edge(ID.render, renderMediaHandle, ID.mix, "in"), edge(ID.music, "audio", ID.mix, "in"))
    if (settings.output === "video") {
      nodes.push(node(ID.merge, "merge-video-audio", 5, 1, {
        label: "Episode with music", audioType: "voiceover", voiceoverVolume: 100, backgroundVolume: 30,
        keepOriginalAudio: false, originalAudioVolume: 30, originalAudioRole: "background", trackSettings: {},
      }))
      edges.push(edge(media.nodeId, media.handle, ID.merge, "in"), edge(ID.mix, "audio-out", ID.merge, "in"))
      media = { nodeId: ID.merge, handle: "video-out" }
    } else {
      media = { nodeId: ID.mix, handle: "audio-out" }
    }
  }

  return {
    nodeType: TIGHTEN_EPISODE,
    nodes,
    edges,
    outputMap: {
      media,
      preview: { nodeId: ID.render, handle: renderMediaHandle },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
    },
  }
}
