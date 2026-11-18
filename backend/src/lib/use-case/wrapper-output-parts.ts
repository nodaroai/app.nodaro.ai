/**
 * What a use-case wrapper job reports (its `output_data`), and the reads both
 * result shapes share — an episode's (wrapper-output.ts) and a list's
 * (wrapper-output-lists.ts) — so neither output module imports the other.
 * Pure.
 */
import type { StoredInlineGraph } from "@nodaro/render-rules"
import type { UseCaseCamerasReport } from "@nodaro/render-rules"
import type { ClipPackClip, ClipPackFailedClip, UseCaseSpeaker } from "@nodaro/shared/edl"

export type { ClipPackFailedClip }

/**
 * One clip of a clip set, in plan order: the wire shape `@nodaro/shared`
 * publishes (and the SDK re-exports), so what the server writes and what an
 * app reads cannot drift apart.
 */
export type UseCaseClipRow = ClipPackClip

/** One delivered format, in format order. */
export interface UseCaseFormatRow {
  readonly format: string
  readonly url: string
}

/** The cameras report's shape is render-rules' (one reader for every lane, usecaseCamerasReportOf). */
export type { UseCaseCameraSpeaker, UseCaseCamerasReport } from "@nodaro/render-rules"

export interface UseCaseWrapperOutput {
  readonly videoUrl?: string
  readonly audioUrl?: string
  readonly json?: unknown
  readonly plan?: unknown
  readonly transcript?: unknown
  readonly quality: "proxy" | "final"
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly useCaseSettings?: Readonly<Record<string, unknown>>
  /** The episode's length, in seconds, when the run knows it. */
  readonly durationSec?: number
  readonly _executionId: string
  readonly failedNodeId?: string
  readonly failedStep?: string
  /** A clip set's clips. */
  readonly clips?: readonly UseCaseClipRow[]
  /** How many planned clips could not be rendered. */
  readonly failedClips?: number
  /** Which planned clips could not be rendered, in plan order (decided 2026-11-17). */
  readonly failedClipList?: readonly ClipPackFailedClip[]
  /** How many delivered clips came without captions (their captions could not be added). */
  readonly failedCaptions?: number
  /** Clips rendered, but the run stopped before captioning them: nothing is kept; Continue captions them. */
  readonly captionsNotRun?: true
  /** Why no clip rendered: the render step's own error. */
  readonly renderError?: string
  /** A run's delivered formats. */
  readonly formats?: readonly UseCaseFormatRow[]
  /** The chosen formats whose step failed (the run keeps the formats that rendered). */
  readonly failedFormats?: readonly string[]
  /** A text result (chapters). */
  readonly text?: string
  /** A run on several recordings or a Master audio: who was put on which camera, and the sync and map notes. */
  readonly cameras?: UseCaseCamerasReport
  /** An episode's or a layout's speakers, first heard first: their label, the name the request gave, their talk. */
  readonly speakers?: readonly UseCaseSpeaker[]
}

/** What the wrapper job kept from its request that the output reports back (never read by the run's graph). */
export interface UseCaseWrapperRequest {
  /** Speaker label → display name, as the request sent it (`input_data.speakerNames`). */
  readonly speakerNames?: unknown
}

type State = { readonly status?: unknown; readonly output?: Readonly<Record<string, unknown>> }

/** A node's output, when it completed. */
export const completedOutput = (
  states: Readonly<Record<string, unknown>>,
  id: string,
): Readonly<Record<string, unknown>> | undefined => {
  const s = states[id] as State | undefined
  return s?.status === "completed" ? s.output : undefined
}
export const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
export const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => !!v && typeof v === "object" && !Array.isArray(v)

/** The first step (in graph order) that failed, in the user's words (its label), never only an inner node id. */
export function failedStepOf(
  graph: StoredInlineGraph,
  nodeStates: Readonly<Record<string, unknown>>,
): { readonly failedNodeId?: string; readonly failedStep?: string } {
  const failed = graph.nodes.find((n) => (nodeStates[n.id] as State | undefined)?.status === "failed")
  return failed ? { failedNodeId: failed.id, failedStep: str(failed.data.label) ?? failed.type } : {}
}
