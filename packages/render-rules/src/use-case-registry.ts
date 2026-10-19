/**
 * One descriptor per use-case node (decided 2026-10-14): everything a route,
 * an estimator, the review and the editor need to know about a type, so none
 * of them names a type. Composed (decided 2026-10-18) from each node's row
 * (use-case-rows.ts: its builder key, label and inputs — a unit's from its
 * unit.json) and its builder's spec (use-case-specs.ts), with `reviewable`
 * from @nodaro/shared's review holds. The boot smoke's route probe follows
 * from the descriptors (backend/scripts/use-case-probe-paths.mjs): no list to
 * edit in ci.yml. Pure.
 */
import { REVIEW_HOLDING_USE_CASE_TYPES } from "@nodaro/shared/nodes"
import {
  isUseCaseNodeType,
  type UseCaseGraph,
  type UseCaseMediaKind,
  type UseCaseMediaSource,
  type UseCaseNodeType,
  type UseCaseResultKind,
} from "./use-case-graph"
import type { UseCaseSourcesShape } from "./use-case-cameras"
import { USE_CASE_ROWS } from "./use-case-rows"
import { USE_CASE_SPECS, type UseCaseBuilderKey } from "./use-case-specs"

export type UseCaseInputHandle = "media" | "music" | "introCard" | "masterAudio"
export interface UseCaseSources {
  /** The first recording (a builder that takes one recording reads only this one). */
  readonly media: UseCaseMediaSource
  /** Recordings 2..n, in order (decided 2026-10-17); absent for one recording. */
  readonly moreMedia?: readonly UseCaseMediaSource[]
  /** The separate audio every recording is synced to, when one is wired. */
  readonly masterAudio?: UseCaseMediaSource
  readonly music?: { readonly url: string }
  /** The card's probed length, when known (a quote prices what follows it on that). */
  readonly introCard?: { readonly url: string; readonly durationSec?: number }
}
/** Every recording of a run, the first first, in the order it is built in. */
export function usecaseRecordings(sources: UseCaseSources): readonly UseCaseMediaSource[] {
  return [sources.media, ...(sources.moreMedia ?? [])]
}
export type UseCaseSettings = Readonly<Record<string, unknown>>
/**
 * How long each video a use-case node delivers is, for a listing: a fixed
 * length, after the length of the input it names when that input is wired
 * (unknown when that input's length is).
 */
export interface UseCaseOutputLength {
  readonly fixedSec: number
  readonly after?: UseCaseInputHandle
}

export interface UseCaseDescriptor {
  readonly type: UseCaseNodeType
  /** English label (server messages, MCP); the editor shows its own localized label. */
  readonly label: string
  readonly route: string
  readonly maxSourceSec: number
  /** A recording without picture is refused before anything starts. */
  readonly needsVideo: boolean
  readonly inputs: readonly UseCaseInputHandle[]
  /** How many recordings `media` takes (Master audio not counted); a wire past the last is not read. */
  readonly maxRecordings: number
  /** The built node each wired input stands for (an estimate replaces it by the real source). */
  readonly inputNodeIds: Readonly<Partial<Record<UseCaseInputHandle, string>>>
  /** The node data keys a run sends its route. */
  readonly settingKeys: readonly string[]
  readonly reviewable: boolean
  readonly resultKind: UseCaseResultKind
  /**
   * The built nodes that try EVERY one of their kind (decided 2026-10-18: a
   * Clip Pack renders and captions every clip, a Trailer makes every chosen
   * format, whichever one fails). A node named here that runs over a list
   * tries every item, and when a stage's nodes are all named here every one
   * starts: one that fails never stops the others from starting. Each such
   * node still checks for a Stop before it starts, so a Stop never starts a paid
   * step. Any other node keeps the engine's default — the first failure stops
   * what has not started yet.
   */
  readonly triesEvery?: readonly string[]
  /** The length of each video it delivers (video-output-length.ts makes it the node's length rule); absent for a node that is not a video producer. */
  readonly outputLength?: UseCaseOutputLength
  /**
   * The node data an audio-only recording wired into `media` forces (the
   * editor's lock writes these values; the run's resolver reads an audio
   * recording so). Absent for a node that refuses an audio recording
   * (`needsVideo`) and for one an audio recording changes nothing on.
   */
  readonly audioForced?: Readonly<Record<string, unknown>>
  /** `shape`: how many recordings the run has and whether Master audio is wired (a one-recording run's settings never depend on it). */
  resolveSettings(raw: UseCaseSettings | undefined, mediaKind: UseCaseMediaKind, shape?: UseCaseSourcesShape): UseCaseSettings
  build(settings: UseCaseSettings, sources: UseCaseSources): UseCaseGraph
}

/** Each row's descriptor: its builder's spec plus the row's type, label, route and inputs. Throws at load on a builder no spec has. */
export const USE_CASE_DESCRIPTORS: { readonly [K in UseCaseNodeType]: UseCaseDescriptor } = Object.freeze(
  Object.fromEntries(
    USE_CASE_ROWS.map((row) => {
      const spec = Object.hasOwn(USE_CASE_SPECS, row.builder) ? USE_CASE_SPECS[row.builder as UseCaseBuilderKey] : undefined
      if (!spec) throw new Error(`${row.type}: builder "${row.builder}" is not a USE_CASE_SPECS key`)
      const descriptor: UseCaseDescriptor = {
        ...spec,
        type: row.type,
        label: row.label,
        route: `/v1/${row.type}`,
        inputs: row.inputs,
        reviewable: REVIEW_HOLDING_USE_CASE_TYPES.has(row.type),
      }
      return [row.type, descriptor]
    }),
  ),
) as { readonly [K in UseCaseNodeType]: UseCaseDescriptor }

export function usecaseDescriptor(type: UseCaseNodeType): UseCaseDescriptor {
  return USE_CASE_DESCRIPTORS[type]
}

export function usecaseContinuePath(type: UseCaseNodeType): string {
  return `${USE_CASE_DESCRIPTORS[type].route}/continue`
}

/** Is a node of `type` a use-case node whose own result is a list (Clip Pack's clips, Trailer's formats)? */
export function usecaseListsItsResult(type: string | null | undefined): boolean {
  if (!isUseCaseNodeType(type)) return false
  const kind = USE_CASE_DESCRIPTORS[type].resultKind
  return kind === "clips" || kind === "formats"
}

/**
 * Is a node of `type` a use-case node whose own result is text (Chapters' show
 * notes on `text`, its list on `json`), with no episode? Its `text` pip is also
 * what an edge naming no pip reads.
 */
export function usecaseResultIsText(type: string | null | undefined): boolean {
  return isUseCaseNodeType(type) && USE_CASE_DESCRIPTORS[type].resultKind === "chapters"
}

/**
 * The nodes of a use-case run that try every one of their kind
 * (`triesEvery`), read from the run's type; empty for any other graph (and for
 * a snapshot that names no use-case type).
 */
export function usecaseTriesEvery(graph: { readonly nodeType: unknown }): ReadonlySet<string> {
  return new Set(isUseCaseNodeType(graph.nodeType as string) ? (USE_CASE_DESCRIPTORS[graph.nodeType as UseCaseNodeType].triesEvery ?? []) : [])
}
