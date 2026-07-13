/**
 * Canonical handle IDs for the Edit Video Pro node.
 *
 * Sibling of generate-video-pro-handles.ts: `video` (the REQUIRED source to
 * edit, cap 1), `prompt` (what the replaced span should contain), and
 * `imageReferences` (≤9, forwarded to the bridge segments). No frame/audio
 * clusters — Seedance-2 reference mode owns the conditioning.
 */
import { DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"

export const EDIT_VIDEO_PRO_INPUT_HANDLES = ["video", "prompt", "imageReferences"] as const
export type EditVideoProInputHandle = typeof EDIT_VIDEO_PRO_INPUT_HANDLES[number]

export function isValidEditVideoProConnection(
  targetHandle: string,
  sourceType: string,
  isPickerType: (s: string) => boolean,
): boolean {
  switch (targetHandle) {
    case "video":
      return VIDEO_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    case "prompt":
      return TEXT_PRODUCER_TYPES.has(sourceType) || isPickerType(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    case "imageReferences":
      return IMAGE_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    default:
      return false
  }
}
