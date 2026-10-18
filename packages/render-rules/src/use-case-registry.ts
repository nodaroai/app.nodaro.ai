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
import { USE_CASE_ROWS } from "./use-case-rows"
import { USE_CASE_SPECS, type UseCaseBuilderKey } from "./use-case-specs"

export type UseCaseInputHandle = "media" | "music" | "introCard"
export interface UseCaseSources {
  readonly media: UseCaseMediaSource
  readonly music?: { readonly url: string }
  readonly introCard?: { readonly url: string }
}
export type UseCaseSettings = Readonly<Record<string, unknown>>

export interface UseCaseDescriptor {
  readonly type: UseCaseNodeType
  /** English label (server messages, MCP); the editor shows its own localized label. */
  readonly label: string
  readonly route: string
  readonly maxSourceSec: number
  /** A recording without picture is refused before anything starts. */
  readonly needsVideo: boolean
  readonly inputs: readonly UseCaseInputHandle[]
  /** The built node each wired input stands for (an estimate replaces it by the real source). */
  readonly inputNodeIds: Readonly<Partial<Record<UseCaseInputHandle, string>>>
  /** The node data keys a run sends its route. */
  readonly settingKeys: readonly string[]
  readonly reviewable: boolean
  readonly resultKind: UseCaseResultKind
  resolveSettings(raw: UseCaseSettings | undefined, mediaKind: UseCaseMediaKind): UseCaseSettings
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
