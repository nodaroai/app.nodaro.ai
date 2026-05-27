/**
 * Typed handle accepts predicates for Data root-category nodes:
 * `list`, `loop`, `web-scrape`, `extract-field`, `filter-list`,
 * `deduplicate`, `merge-lists`, `sort-list`.
 *
 * Mirrors the pattern in `generate-image-handles.ts` / `generate-video-handles.ts`.
 * Each per-node `isValid<Node>Connection` returns true when the source node
 * type can feed the target handle. All predicates are wired into:
 *   - `connection-validation.ts::isValidWorkflowConnection` — drag-to-connect
 *     and popover Connect button enforcement
 *   - `target-handle-registry.ts::TARGET_HANDLE_ACCEPTS` — source-direction
 *     popovers enumerate data-node target handles as candidates
 */

import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"
import {
  TEXT_PRODUCER_TYPES as IMAGE_TEXT_PRODUCERS,
  IMAGE_PRODUCER_TYPES,
} from "./generate-image-handles"

/** Producers of text/string output. Reuses generate-image-handles
 *  TEXT_PRODUCER_TYPES plus extract-field (its `text` mode emits a scalar)
 *  and `transcribe` (returns plain text). */
export const DATA_TEXT_PRODUCER_TYPES: ReadonlySet<string> = new Set<string>([
  ...IMAGE_TEXT_PRODUCERS,
  "extract-field",
  "transcribe",
])

/** Producers of list/array data — data nodes themselves plus AI nodes that
 *  output structured items via `__listResults`. */
export const LIST_PRODUCER_TYPES: ReadonlySet<string> = new Set<string>([
  "list", "loop",
  "web-scrape", "extract-field", "filter-list",
  "deduplicate", "merge-lists", "sort-list",
  "ai-writer", "generate-script",
])

/** Producers of JSON/dict-shaped data — web-scrape returns json arrays,
 *  extract-field has a `json` outputType, etc. */
export const JSON_PRODUCER_TYPES: ReadonlySet<string> = new Set<string>([
  "web-scrape", "extract-field",
  "list", "loop", "filter-list",
  "deduplicate", "merge-lists", "sort-list",
  "ai-writer", "generate-script",
])

/** True when `sourceType` can flow into a generic data input (text, list,
 *  json, or picker fragment). Excludes identity refs (character/face/object/
 *  location) — their outputs are typed structs, not data values. */
export function isDataProducer(sourceType: string, isPicker: (t: string) => boolean): boolean {
  return (
    DATA_TEXT_PRODUCER_TYPES.has(sourceType) ||
    LIST_PRODUCER_TYPES.has(sourceType) ||
    JSON_PRODUCER_TYPES.has(sourceType) ||
    isPicker(sourceType)
  )
}

/** Shared predicate for the "in" handle of every list-consumer data node
 *  (deduplicate / merge-lists / sort-list / extract-field). Each of those
 *  nodes used to inline the identical OR-of-two-sets check. */
const isListConsumer = (sourceType: string): boolean =>
  LIST_PRODUCER_TYPES.has(sourceType) || JSON_PRODUCER_TYPES.has(sourceType)

/** list-node `in`: pure pass-through, accepts any data producer. */
export function isValidListNodeConnection(
  targetHandleId: string,
  sourceType: string,
  isPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "in":
      return isDataProducer(sourceType, isPicker)
    default:
      return false
  }
}

/** web-scrape `in`: URL/query input — accepts text producers + list/json
 *  (auto-stringified at runtime). Picker outputs are prompt fragments
 *  (e.g. "cinematic blue tones"), not URLs/queries — excluded. */
export function isValidWebScrapeConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "in":
      return DATA_TEXT_PRODUCER_TYPES.has(sourceType) || isListConsumer(sourceType)
    default:
      return false
  }
}

/** extract-field `in`: reads JSON shape — accepts json/list producers. */
export function isValidExtractFieldConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "in":
      return isListConsumer(sourceType)
    default:
      return false
  }
}

/** filter-list: `in` accepts lists; `variables` accepts any data producer
 *  (resolved by name in condition expressions). */
export function isValidFilterListConnection(
  targetHandleId: string,
  sourceType: string,
  isPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "in":
      return isListConsumer(sourceType)
    case "variables":
      return isDataProducer(sourceType, isPicker)
    default:
      return false
  }
}

/** deduplicate `in`: list-only. */
export function isValidDeduplicateConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "in":
      return isListConsumer(sourceType)
    default:
      return false
  }
}

/** merge-lists `in`: list-only; accepts multiple connections (order matters
 *  for concat). */
export function isValidMergeListsConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "in":
      return isListConsumer(sourceType)
    default:
      return false
  }
}

/** sort-list `in`: list-only. */
export function isValidSortListConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "in":
      return isListConsumer(sourceType)
    default:
      return false
  }
}

/** Loop-node columns: per-column accepts driven by column type. The col_add
 *  quick-add handle stays as a HandleIcon decoration (not a typed handle).
 *  Each column has both an input handle (loopColInputHandle) and an output
 *  handle (col.handleId); the input's accepts mirror the column's data type. */
export type LoopColumnType = "image-url" | "video-url" | "audio-url" | "json" | "text"

export function isValidLoopColumnConnection(
  columnType: LoopColumnType | undefined,
  sourceType: string,
  isPicker: (t: string) => boolean,
): boolean {
  const colType: LoopColumnType = columnType ?? "text"
  switch (colType) {
    case "image-url":
      return IMAGE_PRODUCER_TYPES.has(sourceType)
    case "video-url":
      return VIDEO_PRODUCER_TYPES.has(sourceType)
    case "audio-url":
      return AUDIO_PRODUCER_TYPES.has(sourceType)
    case "json":
      // Strictly structured-data sources only. Pickers emit prompt fragments
      // (single strings, not parseable as JSON) and identity refs emit
      // ref-structs, so neither is accepted here — see review feedback that
      // a `mood` picker (string "cheerful") was previously accepted for
      // json columns via an isDataProducer fallback that has been removed.
      return JSON_PRODUCER_TYPES.has(sourceType) || LIST_PRODUCER_TYPES.has(sourceType)
    case "text":
    default:
      return DATA_TEXT_PRODUCER_TYPES.has(sourceType)
        || LIST_PRODUCER_TYPES.has(sourceType)
        || JSON_PRODUCER_TYPES.has(sourceType)
        || isPicker(sourceType)
  }
}

/** Coarse loop validator — used by `isValidWorkflowConnection` for the
 *  drop-time gate when the target is a loop column input. Per-column
 *  refinement happens in the loop component's per-pip `accepts` predicate
 *  (which has access to the column type from node data); this validator
 *  cannot reach node data via its `getNodeType` signature, so it enforces
 *  the union: source must be a producer of SOMETHING the loop accepts. */
export function isValidLoopCoarse(
  sourceType: string,
  isPicker: (t: string) => boolean,
): boolean {
  return IMAGE_PRODUCER_TYPES.has(sourceType)
    || VIDEO_PRODUCER_TYPES.has(sourceType)
    || AUDIO_PRODUCER_TYPES.has(sourceType)
    || isDataProducer(sourceType, isPicker)
}

/** Brand colors for data-node handle pips. Teal matches the Data category
 *  color in the add-node popup (`text-[#14B8A6]`) so the pip identity reads
 *  consistently with the rest of the category. */
export const DATA_HANDLE_COLORS = {
  /** Generic list / data flow (list-node, list-processor in/out). */
  list: "#14B8A6",
  /** JSON output (web-scrape, extract-field json mode). */
  json: "#818CF8",
  /** Text output (extract-field text mode, web-scrape input). */
  text: "#22D3EE",
  /** Variables input (filter-list). */
  variables: "#F59E0B",
  /** Image-url column output (loop). */
  imageUrl: "#F472B6",
  /** Video-url column output (loop). */
  videoUrl: "#A78BFA",
  /** Audio-url column output (loop). */
  audioUrl: "#F59E0B",
} as const
