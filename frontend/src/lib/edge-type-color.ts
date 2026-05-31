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
import { HANDLE_COLORS } from "./handle-colors"
import { HANDLE_OUTPUT_TYPES } from "./handle-output-types"
import { getPickerOutputMeta } from "./picker-handles"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"

export function getEdgeTypeColor(
  sourceNodeType: string | undefined,
  sourceHandle: string | null | undefined,
): string | undefined {
  if (!sourceNodeType) return undefined
  // Pickers: the family color is the canonical output color.
  const picker = getPickerOutputMeta(sourceNodeType)
  if (picker) return picker.color
  // Authoritative per-node output-handle registry (single source of truth,
  // kept in sync with the pips by the handle-color drift guard).
  const byHandle = sourceHandle ? HANDLE_OUTPUT_TYPES[sourceNodeType]?.[sourceHandle] : undefined
  if (byHandle) return HANDLE_COLORS[byHandle]
  // Safety net for single-output nodes not (yet) in the registry: classify by
  // producer-type set. The registry wins above, so this never overrides it.
  if (TEXT_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.text
  if (IMAGE_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.image
  if (VIDEO_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.video
  if (AUDIO_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.audio
  return undefined
}
