/**
 * Trailer's built chain (decided 2026-10-14): the shipped
 * `podcast-trailer-formats` template, one recording, built from the node's
 * settings. The plan picks the strongest moments and joins them with its own
 * crossfades into one 20–40 s trailer; Apply EDL renders it; an optional intro
 * card plays first (Combine Videos); one Social Media Format per chosen format
 * pads it (never crops: a centre crop of a two-person shot cuts a speaker off).
 * Pure: no I/O, fresh objects every call.
 *
 *   source → transcribe (diarized, word timings) → edit-plan (trailer) → apply-edl
 *   source ──────────────────────────────────────→ edit-plan, apply-edl (their source)
 *   apply-edl [→ combine-videos ← intro card] → one social-media-format per format
 */
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import type {
  FormatsOutputMap,
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

/** The render step: the shipped Apply EDL node, as in the template. */
const RENDER_TYPE = "apply-edl"

/** The formats a trailer is delivered in, in the order they are delivered. */
export const TRAILER_FORMATS = ["9:16", "1:1", "4:5", "16:9"] as const
export type TrailerFormat = (typeof TRAILER_FORMATS)[number]

/** Each format's platform spec (the template's three, and a 1920×1080 landscape) and the node that delivers it. */
export const TRAILER_FORMAT_SPECS = Object.freeze({
  "9:16": { specKey: "instagram:story-reel", platform: "instagram", contentType: "story-reel", label: "Story / Reel (9:16)", nodeId: "uc-format-9x16" },
  "1:1": { specKey: "instagram:feed-square", platform: "instagram", contentType: "feed-square", label: "Square Feed (1:1)", nodeId: "uc-format-1x1" },
  "4:5": { specKey: "instagram:feed-portrait", platform: "instagram", contentType: "feed-portrait", label: "Portrait Feed (4:5)", nodeId: "uc-format-4x5" },
  "16:9": { specKey: "x:x-video", platform: "x", contentType: "x-video", label: "Landscape (16:9)", nodeId: "uc-format-16x9" },
} as const)

/** The longest intro card a Trailer takes, in seconds (decided 2026-10-18): a title card, never a second episode. */
export const TRAILER_INTRO_CARD_MAX_SEC = 15

export interface EpisodeTrailerSettings {
  readonly formats: readonly TrailerFormat[]
  readonly reviewBeforeRender: boolean
  readonly planTier: PlanTier
  readonly instructions: string
  readonly styleGuide: string
}

export const EPISODE_TRAILER_DEFAULTS: EpisodeTrailerSettings = Object.freeze({
  formats: Object.freeze(["9:16", "1:1", "4:5"] as TrailerFormat[]),
  reviewBeforeRender: false,
  planTier: "standard",
  instructions: "",
  styleGuide: "",
})

export const TRAILER_NODE_IDS = Object.freeze({
  source: "uc-source",
  transcribe: "uc-transcribe",
  plan: "uc-plan",
  render: "uc-render",
  intro: "uc-intro",
  combine: "uc-combine",
} as const)

export interface EpisodeTrailerSources {
  readonly media: UseCaseMediaSource
  /** A short title-card video that plays before the trailer, with its probed length when known. */
  readonly introCard?: { readonly url: string; readonly durationSec?: number }
}

/** Trailer's graph: one delivery per chosen format. */
export type EpisodeTrailerGraph = UseCaseGraph & { readonly outputMap: FormatsOutputMap }

/**
 * The node's raw settings as a run reads them: every unknown or out-of-range
 * value falls back to its default (never passed on). Formats: unknown ones
 * dropped, duplicates merged, in the fixed delivery order.
 *
 * An empty format list resolves to the defaults here, while the route refuses
 * `formats: []` with a 400 (its body's `.min(1)`). The divergence is
 * deliberate: the route is the one place a caller can send an empty list on
 * purpose (and is told so), while every other reader (an estimate, the
 * expansion, a node an agent or an import wrote) gets a buildable graph. The
 * config panel never lets the last format be unticked.
 */
export function resolveEpisodeTrailerSettings(
  raw: Readonly<Record<string, unknown>> | undefined,
  _mediaKind: UseCaseMediaKind,
): EpisodeTrailerSettings {
  const r = raw ?? {}
  const d = EPISODE_TRAILER_DEFAULTS
  const asked = Array.isArray(r.formats) ? new Set(r.formats.filter((f): f is string => typeof f === "string")) : null
  const formats = asked ? TRAILER_FORMATS.filter((f) => asked.has(f)) : []
  return {
    formats: formats.length > 0 ? formats : [...d.formats],
    reviewBeforeRender: r.reviewBeforeRender === true,
    planTier: typeof r.planTier === "string" && (EDIT_PLAN_TIERS as readonly string[]).includes(r.planTier) ? (r.planTier as PlanTier) : d.planTier,
    instructions: typeof r.instructions === "string" ? r.instructions : d.instructions,
    styleGuide: typeof r.styleGuide === "string" ? r.styleGuide : d.styleGuide,
  }
}

/** The chain one Trailer run executes, built from resolved settings and its recording (and intro card). */
export function buildEpisodeTrailerGraph(settings: EpisodeTrailerSettings, sources: EpisodeTrailerSources): EpisodeTrailerGraph {
  const ID = TRAILER_NODE_IDS
  const pip = sources.media.kind === "audio" ? "audio" : "video"
  const quality = settings.reviewBeforeRender ? "proxy" : "final"
  const nodes: UseCaseGraphNode[] = [
    usecaseSourceNode(ID.source, sources.media, 0, 1),
    usecaseTranscribeNode(ID.transcribe, 1, 0),
    usecaseNode(ID.plan, "edit-plan", 2, 1, {
      label: "Trailer Plan", mode: "trailer", planTier: settings.planTier, instructions: settings.instructions,
      ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
      sourceOrder: [ID.source], sourceConfig: {},
    }),
    usecaseNode(ID.render, RENDER_TYPE, 3, 1, { label: "Apply Cut", output: "video", quality, crossfadeMs: 0 }),
  ]
  const edges: UseCaseGraphEdge[] = [
    usecaseEdge(ID.source, pip, ID.transcribe, "audio"),
    usecaseEdge(ID.source, pip, ID.plan, "sources"),
    usecaseEdge(ID.source, pip, ID.render, "sources"),
    usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
    usecaseEdge(ID.plan, "edl", ID.render, "edl"),
  ]
  let trailer: UseCaseHandleRef = { nodeId: ID.render, handle: "media" }
  if (sources.introCard) {
    nodes.push(
      usecaseNode(ID.intro, "upload-video", 3, 3, {
        label: "Intro card", assetId: "", url: sources.introCard.url,
        // Its probed length, declared as the recording's is (usecaseSourceNode): what Combine Videos is quoted on.
        ...(typeof sources.introCard.durationSec === "number" && sources.introCard.durationSec > 0
          ? { metadata: { durationSeconds: sources.introCard.durationSec } }
          : {}),
      }),
      usecaseNode(ID.combine, "combine-videos", 4, 1, {
        label: "Add Intro Card", transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", audioCrossfadeDuration: 0.5,
        trimEndFrames: 0, trimStartFrames: 0, smartCutFramesPrev: 8, smartCutFramesNext: 8, clipOrder: [ID.intro, ID.render],
      }),
    )
    edges.push(usecaseEdge(ID.intro, "video", ID.combine, "in"), usecaseEdge(ID.render, "media", ID.combine, "in"))
    trailer = { nodeId: ID.combine, handle: "video" }
  }
  for (const [row, format] of settings.formats.entries()) {
    const spec = TRAILER_FORMAT_SPECS[format]
    nodes.push(usecaseNode(spec.nodeId, "social-media-format", 5, row, {
      label: spec.label, platform: spec.platform, contentType: spec.contentType, specKey: spec.specKey,
      method: "pad", padColor: "#000000", formattedText: "",
    }))
    edges.push(usecaseEdge(trailer.nodeId, trailer.handle, spec.nodeId, "media"))
  }
  return {
    nodeType: usecaseTypeOfBuilder("trailer"),
    nodes,
    edges,
    outputMap: {
      kind: "formats",
      formats: settings.formats.map((format) => ({ format, ref: { nodeId: TRAILER_FORMAT_SPECS[format].nodeId, handle: "media" } })),
      preview: { nodeId: ID.render, handle: "media" },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
    },
  }
}
