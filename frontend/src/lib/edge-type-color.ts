/**
 * Resolve the canonical type color for an EDGE from its source handle, so an
 * idle wire reads in the same color as the handle pips it connects (text wires
 * blue, image cyan, video violet, …). Derives from the same sources of truth
 * as the handles themselves, in priority order:
 *   1. the picker registry (a picker's output is its family color),
 *   2. the per-node `(nodeType, handleId) -> type` output registry
 *      (authoritative; disambiguates multi-output nodes and reused handle ids
 *      like `out`), and
 *   3. the shared producer-type sets as a single-output safety net.
 *
 * Returns `undefined` when the source's output type is genuinely runtime-typed
 * or unknown (sub-workflow ports, router routes, list columns, …); the canvas
 * then falls back to the default neutral stroke.
 */
import { HANDLE_COLORS, type HandleColorType } from "./handle-colors"
import { HANDLE_OUTPUT_TYPES } from "./handle-output-types"
import { getPickerOutputMeta, PICKER_FAMILY_TYPES } from "./picker-handles"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"

/**
 * Resolve the canonical `HandleColorType` of a source handle's output — the
 * type counterpart to `getEdgeTypeColor`, derived from the same sources of
 * truth (picker registry → per-node output registry → producer-type sets).
 * Returns `undefined` for genuinely runtime-typed / unknown outputs.
 */
export function getEdgeType(
  sourceNodeType: string | undefined,
  sourceHandle: string | null | undefined,
): HandleColorType | undefined {
  if (!sourceNodeType) return undefined
  const picker = getPickerOutputMeta(sourceNodeType)
  if (picker) return PICKER_FAMILY_TYPES[picker.family]
  const byHandle = sourceHandle ? HANDLE_OUTPUT_TYPES[sourceNodeType]?.[sourceHandle] : undefined
  if (byHandle) return byHandle
  if (TEXT_PRODUCER_TYPES.has(sourceNodeType)) return "text"
  if (IMAGE_PRODUCER_TYPES.has(sourceNodeType)) return "image"
  if (VIDEO_PRODUCER_TYPES.has(sourceNodeType)) return "video"
  if (AUDIO_PRODUCER_TYPES.has(sourceNodeType)) return "audio"
  return undefined
}

export function getEdgeTypeColor(
  sourceNodeType: string | undefined,
  sourceHandle: string | null | undefined,
): string | undefined {
  if (!sourceNodeType) return undefined
  // Pickers keep their canonical per-FAMILY color (not HANDLE_COLORS[mapped
  // type]), so this branch stays ahead of the shared `getEdgeType` resolver.
  const picker = getPickerOutputMeta(sourceNodeType)
  if (picker) return picker.color
  // Everything else: derive the type via the shared resolver (single source of
  // truth — registry → producer-set order lives ONLY in `getEdgeType`) and map
  // it to its color, so the edge color and the connector icon can never drift.
  const type = getEdgeType(sourceNodeType, sourceHandle)
  return type ? HANDLE_COLORS[type] : undefined
}
