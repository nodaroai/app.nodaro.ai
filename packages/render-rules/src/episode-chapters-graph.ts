/**
 * Chapters' built chain (decided 2026-10-14): the recording transcribed, then
 * Edit Plan in chapters mode. Nothing renders: the node's text is the plan's
 * chapters as show notes (chapter-list-text.ts), its json the chapter list.
 * Pure: no I/O, fresh objects every call.
 *
 *   source → transcribe (diarized, word timings) → edit-plan (chapters)
 *   source ──────────────────────────────────────→ edit-plan (its source)
 */
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import type { ChaptersOutputMap, PlanTier, UseCaseGraph, UseCaseMediaKind, UseCaseMediaSource } from "./use-case-graph"
import { usecaseEdge, usecaseNode, usecaseSourceNode, usecaseTranscribeNode } from "./use-case-graph-parts"

export const EPISODE_CHAPTERS = "episode-chapters" as const

export interface EpisodeChaptersSettings {
  readonly planTier: PlanTier
  readonly instructions: string
  readonly styleGuide: string
}

export const EPISODE_CHAPTERS_DEFAULTS: EpisodeChaptersSettings = Object.freeze({ planTier: "economy", instructions: "", styleGuide: "" })

export const CHAPTERS_NODE_IDS = Object.freeze({ source: "uc-source", transcribe: "uc-transcribe", plan: "uc-plan" } as const)

export interface EpisodeChaptersSources {
  readonly media: UseCaseMediaSource
}

/** Chapters' graph: the plan's chapters, nothing rendered. */
export type EpisodeChaptersGraph = UseCaseGraph & { readonly outputMap: ChaptersOutputMap }

/**
 * The node's raw settings as a run reads them: every unknown or out-of-range
 * value falls back to its default (never passed on). The recording's kind
 * changes nothing (both are transcribed alike).
 */
export function resolveEpisodeChaptersSettings(
  raw: Readonly<Record<string, unknown>> | undefined,
  _mediaKind: UseCaseMediaKind,
): EpisodeChaptersSettings {
  const r = raw ?? {}
  const d = EPISODE_CHAPTERS_DEFAULTS
  return {
    planTier: typeof r.planTier === "string" && (EDIT_PLAN_TIERS as readonly string[]).includes(r.planTier) ? (r.planTier as PlanTier) : d.planTier,
    instructions: typeof r.instructions === "string" ? r.instructions : d.instructions,
    styleGuide: typeof r.styleGuide === "string" ? r.styleGuide : d.styleGuide,
  }
}

/** The chain one Chapters run executes, built from resolved settings and its recording. */
export function buildEpisodeChaptersGraph(settings: EpisodeChaptersSettings, sources: EpisodeChaptersSources): EpisodeChaptersGraph {
  const ID = CHAPTERS_NODE_IDS
  const pip = sources.media.kind === "audio" ? "audio" : "video"
  return {
    nodeType: EPISODE_CHAPTERS,
    nodes: [
      usecaseSourceNode(ID.source, sources.media, 0, 1),
      usecaseTranscribeNode(ID.transcribe, 1, 0),
      usecaseNode(ID.plan, "edit-plan", 2, 1, {
        label: "Chapters Plan", mode: "chapters", planTier: settings.planTier, instructions: settings.instructions,
        ...(settings.styleGuide ? { styleGuide: settings.styleGuide } : {}),
        sourceOrder: [ID.source], sourceConfig: {},
      }),
    ],
    edges: [
      usecaseEdge(ID.source, pip, ID.transcribe, "audio"),
      usecaseEdge(ID.source, pip, ID.plan, "sources"),
      usecaseEdge(ID.transcribe, "json", ID.plan, "transcript"),
    ],
    outputMap: { kind: "chapters", json: { nodeId: ID.plan, handle: "edl" }, transcript: { nodeId: ID.transcribe, handle: "json" }, planNodeId: ID.plan },
  }
}
