/**
 * Resolve the canonical type color for an EDGE from its source handle, so an
 * idle wire reads in the same color as the handle pips it connects (text wires
 * blue, image cyan, video violet, …). Derives from the same sources of truth
 * as the handles themselves — `HANDLE_COLORS`, the picker registry, and the
 * shared producer-type sets. Single-output handles match their pip by
 * construction; multi-output handles are disambiguated by output-handle id.
 * Caveat: a multi-output handle NOT listed in `OUTPUT_HANDLE_TYPE` falls back
 * to the node-level producer type and may not match its pip — a shared
 * `(nodeType, handleId) -> type` registry would close that seam.
 *
 * Returns `undefined` when the source's output type is ambiguous/unknown; the
 * canvas then falls back to the default neutral stroke.
 */
import { HANDLE_COLORS } from "./handle-colors"
import { getPickerOutputMeta } from "./picker-handles"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"

// Output handle ids that unambiguously denote a data type (used first so
// multi-output nodes — e.g. generate-script's `dialogue` vs `images` — get the
// right per-wire color instead of one node-level guess).
// NOTE: these values are kept in sync BY HAND with the source-handle pip
// colors in the node components. The ones below were verified against the
// actual `color={HANDLE_COLORS.x}` props (a shared (nodeType,handleId)->color
// registry would remove the need for this — see the doc-comment seam above).
const OUTPUT_HANDLE_TYPE: Record<string, keyof typeof HANDLE_COLORS> = {
  // text
  text: "text",
  dialogue: "text",
  transcript: "text",
  // image
  image: "image",
  images: "image",
  // video
  video: "video",
  scenes: "video",
  // audio
  audio: "audio",
  music: "audio",
  sfx: "audio",
  vocals: "audio",
  instrumental: "audio",
  // entity / identity refs — each matches its OWN node's pip color, which is
  // the node's category color (character=pink, object=emerald, location=cyan,
  // face=orange), not a single "identity" color.
  characterRef: "identity",
  characters: "identity",
  locations: "identity",
  voiceId: "identity",
  voicePersona: "identity",
  objectRef: "imageRef",
  locationRef: "image",
  faceRef: "face",
  // single-purpose
  mask: "mask",
  approved: "approve",
  rejected: "negative",
}

export function getEdgeTypeColor(
  sourceNodeType: string | undefined,
  sourceHandle: string | null | undefined,
): string | undefined {
  if (!sourceNodeType) return undefined
  // Pickers: the family color is the canonical output color.
  const picker = getPickerOutputMeta(sourceNodeType)
  if (picker) return picker.color
  // Per-handle type (disambiguates multi-output nodes).
  const byHandle = sourceHandle ? OUTPUT_HANDLE_TYPE[sourceHandle] : undefined
  if (byHandle) return HANDLE_COLORS[byHandle]
  // Single-output nodes: classify by producer-type set.
  if (TEXT_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.text
  if (IMAGE_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.image
  if (VIDEO_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.video
  if (AUDIO_PRODUCER_TYPES.has(sourceNodeType)) return HANDLE_COLORS.audio
  return undefined
}
