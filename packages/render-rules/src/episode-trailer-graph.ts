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
 *
 * Two or more recordings or a Master audio (decided 2026-10-17) build the
 * multicam chain instead (episode-trailer-multicam.ts): the same tail after a
 * plan over every recording and, with two or more cameras, Camera Switch.
 */
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import type {
  FormatsOutputMap,
  PlanTier,
  UseCaseGraph,
  UseCaseGraphEdge,
  UseCaseGraphNode,
  UseCaseMediaKind,
  UseCaseMediaSource,
} from "./use-case-graph"
import { usecaseEdge, usecaseNode, usecaseSourceNode, usecaseTranscribeNode } from "./use-case-graph-parts"
import { TRAILER_FORMATS, TRAILER_NODE_IDS, TRAILER_RENDER_TYPE, withTrailerTail, type TrailerFormat } from "./episode-trailer-parts"
import { buildTrailerMulticamGraph } from "./episode-trailer-multicam"
import { resolveUseCaseCameras, usecaseShapeIsMulticam, type UseCaseCameras, type UseCaseSourcesShape } from "./use-case-cameras"
import { usecaseIsMulticam } from "./use-case-multicam"

export { TRAILER_FORMATS, TRAILER_FORMAT_SPECS, TRAILER_NODE_IDS, type TrailerFormat } from "./episode-trailer-parts"

/** The longest intro card a Trailer takes, in seconds (decided 2026-10-18): a title card, never a second episode. */
export const TRAILER_INTRO_CARD_MAX_SEC = 15

export interface EpisodeTrailerSettings {
  readonly formats: readonly TrailerFormat[]
  readonly reviewBeforeRender: boolean
  readonly planTier: PlanTier
  readonly instructions: string
  readonly styleGuide: string
  /**
   * The Cameras settings, resolved only for two or more recordings or a Master
   * audio (absent otherwise, so a one-recording run's settings are what they
   * always were); the builder reads absent as the defaults.
   */
  readonly cameras?: UseCaseCameras
}

export const EPISODE_TRAILER_DEFAULTS: EpisodeTrailerSettings = Object.freeze({
  formats: Object.freeze(["9:16", "1:1", "4:5"] as TrailerFormat[]),
  reviewBeforeRender: false,
  planTier: "standard",
  instructions: "",
  styleGuide: "",
})

export interface EpisodeTrailerSources {
  readonly media: UseCaseMediaSource
  /** A short title-card video that plays before the trailer, with its probed length when known. */
  readonly introCard?: { readonly url: string; readonly durationSec?: number }
  /** Recordings 2..n, in order (decided 2026-10-17): the cameras of the same conversation. */
  readonly moreMedia?: readonly UseCaseMediaSource[]
  /** The mixer or recorder track every recording is lined up to, and the trailer's sound. */
  readonly masterAudio?: UseCaseMediaSource
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
 * config panel never lets the last format be unticked. `shape` (how many
 * recordings, whether a Master audio is wired) decides whether the Cameras
 * settings are resolved at all.
 */
export function resolveEpisodeTrailerSettings(
  raw: Readonly<Record<string, unknown>> | undefined,
  _mediaKind: UseCaseMediaKind,
  shape?: UseCaseSourcesShape,
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
    ...(usecaseShapeIsMulticam(shape) ? { cameras: resolveUseCaseCameras(r.cameras, shape) } : {}),
  }
}

/**
 * The chain one Trailer run executes, built from resolved settings and its
 * inputs. Two or more recordings or a Master audio: the multicam chain
 * (episode-trailer-multicam.ts); one recording: P2's chain below, unchanged.
 */
export function buildEpisodeTrailerGraph(settings: EpisodeTrailerSettings, sources: EpisodeTrailerSources): EpisodeTrailerGraph {
  if (usecaseIsMulticam(sources)) return buildTrailerMulticamGraph(settings, sources)
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
    usecaseNode(ID.render, TRAILER_RENDER_TYPE, 3, 1, { label: "Apply Cut", output: "video", quality, crossfadeMs: 0 }),
  ]
  const edges: UseCaseGraphEdge[] = [
    usecaseEdge(ID.source, pip, ID.transcribe, "audio"),
    usecaseEdge(ID.source, pip, ID.plan, "sources"),
    usecaseEdge(ID.source, pip, ID.render, "sources"),
    usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
    usecaseEdge(ID.plan, "edl", ID.render, "edl"),
  ]
  return withTrailerTail(settings, sources, { nodes, edges, renderColumn: 3 })
}
