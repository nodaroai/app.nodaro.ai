/**
 * What a use-case wrapper job reports (its `output_data`), and the reads both
 * result shapes share — an episode's (wrapper-output.ts) and a list's
 * (wrapper-output-lists.ts) — so neither output module imports the other.
 * Pure.
 */
import type { StoredInlineGraph } from "@nodaro/render-rules"

/** One clip of a clip set, in plan order. */
export interface UseCaseClipRow {
  readonly url: string
  readonly quality: "proxy" | "final"
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  readonly title?: string
  readonly hook?: string
  /** The still of the file it delivers (none for an audio clip). */
  readonly thumbnailUrl?: string
  /** Its captions could not be added: the clip is its render, uncaptioned. */
  readonly captionsFailed?: true
}

/** One delivered format, in format order. */
export interface UseCaseFormatRow {
  readonly format: string
  readonly url: string
}

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
