/**
 * The podcast pack on the `edit` resource (`POST /v1/podcast-pack`): several
 * podcast tools on one recording, for one price. Its input (the recording
 * once, and each tool's own settings), the body it sends and what it answers.
 * Split from `edit.ts`, which holds the methods; every name here is
 * re-exported from there.
 */
import { USE_CASE_NODE_TYPES, type UseCaseNodeType } from "@nodaro/shared/nodes"
import type { EditJobResult, EditResource } from "./edit.js"
import {
  withRecordings,
  type UseCaseRecordingsInput,
  type UseCaseSpeakerNamesInput,
} from "./edit-use-case-inputs.js"

/** The tools a podcast pack can run, in the order the pack starts them. */
export const PODCAST_PACK_TOOLS: readonly UseCaseNodeType[] = USE_CASE_NODE_TYPES

/** One tool a podcast pack can run (see {@link PODCAST_PACK_TOOLS}). */
export type PodcastPackTool = (typeof PODCAST_PACK_TOOLS)[number]

/**
 * The fields a tool's settings leave out in a pack: the recording and the
 * speakers' names belong to the pack, sent once for every tool.
 */
export type PodcastPackRecordingField = keyof UseCaseRecordingsInput | keyof UseCaseSpeakerNamesInput

/** A tool's type spelled as its method's name: `tighten-episode` → `tightenEpisode`. */
type MethodNameOf<S extends string> = S extends `${infer Head}-${infer Tail}` ? `${Head}${Capitalize<MethodNameOf<Tail>>}` : S

/**
 * Each tool's settings in a pack: what its own method takes (`tightenEpisode`,
 * `episodeChapters`, …), without the recording fields — read from the method
 * itself, so a tool and its settings never drift (a tool with no method of its
 * own fails to type here).
 */
export type PodcastPackToolSettings = EveryPackToolHasAMethod extends true
  ? { [T in PodcastPackTool]: Omit<ToolInputOf<T>, PodcastPackRecordingField> }
  : never

/** What a tool's own method takes as its input. */
type ToolInputOf<T extends PodcastPackTool> = EditResource[MethodNameOf<T> & keyof EditResource] extends (input: infer I, ...rest: never[]) => unknown ? I : never

/** Every tool has a method of its own: a type with none fails to compile here. */
type AssertTrue<T extends true> = T
type EveryPackToolHasAMethod = AssertTrue<{ [T in PodcastPackTool]: MethodNameOf<T> extends keyof EditResource ? true : false }[PodcastPackTool]>

/** The tools a pack runs, each with its settings (`{}` takes the tool's defaults). */
export type PodcastPackTools = { [T in PodcastPackTool]?: PodcastPackToolSettings[T] }

/**
 * Input for {@link EditResource.podcastPack} and
 * {@link EditResource.estimatePodcastPack}: the recording (or the recordings
 * of one conversation, see {@link UseCaseRecordingsInput}) once, and the tools
 * to run on it. Each tool refuses in a pack what it refuses on its own (Chapters
 * takes one recording, Trailer and Speaker Layout need a picture).
 */
export interface PodcastPackInput extends UseCaseRecordingsInput {
  /**
   * The tools to run, at least one (an empty object is refused `400
   * validation_error`). A tool's settings are what its own method takes,
   * without the recording.
   */
  tools: PodcastPackTools
  /**
   * Speaker label → the name to show (see
   * {@link UseCaseSpeakerNamesInput.speakerNames}); passed only to the tools
   * that take it (Tighten Episode, Speaker Layout).
   */
  speakerNames?: UseCaseSpeakerNamesInput["speakerNames"]
  /** A workflow (its id) to tie the pack's job and its tools' runs to. */
  workflowId?: string
  /** With `workflowId`: the node on it. */
  nodeId?: string
}

/** One tool of a pack that started: its own run, followed by its own job. */
export interface PodcastPackToolRun {
  tool: PodcastPackTool
  /** The tool's job: the same job its own method answers. Follow it with `client.jobs.getStatus(jobId)`. */
  jobId: string
  /** The tool's run. */
  executionId: string | null
}

/** One tool of a pack that did not start, and why. */
export interface PodcastPackNotStarted {
  tool: PodcastPackTool
  error: { code: string; message: string; tool?: PodcastPackTool }
}

/**
 * What a pack's job holds once its tools have started (its `output_data`),
 * and what {@link EditResource.podcastPack} answers beside the pack's `jobId`.
 */
export interface PodcastPackOutputData {
  /** The tools that started, in the pack's order. */
  tools: PodcastPackToolRun[]
  /** The tools that did not start (absent when every tool started). */
  notStarted?: PodcastPackNotStarted[]
  /** The recording's length, in seconds. */
  durationSec: number
  /** The units the pack is charged: every started 15 seconds of the recording. */
  units: number
}

/** A pack started by this request: its job, and each tool's. */
export interface PodcastPackStarted extends EditJobResult, PodcastPackOutputData {
  deduped?: false
}

/**
 * An `Idempotency-Key` retry that found the pack already started: `jobId` is
 * that pack's job, whose `output_data` lists its tools
 * ({@link PodcastPackOutputData}).
 */
export interface PodcastPackDeduped extends EditJobResult {
  deduped: true
}

/** What {@link EditResource.podcastPack} answers (`202`). */
export type PodcastPackJobResult = PodcastPackStarted | PodcastPackDeduped

/** What {@link EditResource.startPodcastPackTool} answers (`202`): the tool's run, followed like any run. */
export interface PodcastPackToolStarted {
  /** The tool's run: its job, to follow with `jobs.get` (and to continue free if it fails). */
  jobId: string
  /** The run's execution, when it started one. */
  executionId: string | null
  tool: PodcastPackTool
}

/** What a pack is estimated at (`data`). Nothing is created or charged. */
export interface PodcastPackEstimate {
  /** The tools the pack would run, in the pack's order. */
  tools: PodcastPackTool[]
  /** The recording's length, in seconds. */
  durationSec: number
  /** Every started 15 seconds of the recording. */
  units: number
  /** The pack's price, every tool included: 0 on an edition without credits, `null` when this server has no price for it. */
  credits: number | null
}

/** The pack's body: the recordings once, then the tools and the rest as given. */
export function podcastPackBody(input: PodcastPackInput): Record<string, unknown> {
  return withRecordings(input)
}
