/**
 * video-retake node handle taxonomy.
 *
 * Three target handles: video (primary), prompt, look (Look picker family).
 * One source handle: video.
 *
 * Mirrors the structure used by generate-video-handles.ts. The producer/picker
 * sets aren't re-defined here — they're imported from the existing single
 * source of truth (`@nodaro/shared` for VIDEO_PRODUCER_TYPES, the sibling
 * generate-image-handles for TEXT_PRODUCER_TYPES + LOOK_PICKER_TYPES) so the
 * three video-flavored handle taxonomies (generate-video, video-retake,
 * generate-image) stay consistent.
 */
import { VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, LOOK_PICKER_TYPES } from "./generate-image-handles"

export const VIDEO_RETAKE_HANDLE_IDS = ["video", "prompt", "look"] as const
export type VideoRetakeHandleId = (typeof VIDEO_RETAKE_HANDLE_IDS)[number]

// LOOK_PICKER_TYPES is a ReadonlyArray; wrap it in a Set for O(1) membership
// checks during connection validation. Same pattern as generate-video-handles.
const LOOK_PICKER_NODE_TYPES: ReadonlySet<string> = new Set(LOOK_PICKER_TYPES)

export function isValidVideoRetakeConnection(
  targetHandleId: VideoRetakeHandleId,
  sourceType: string,
  isPickerType: (s: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "video":
      return VIDEO_PRODUCER_TYPES.has(sourceType)
    case "prompt":
      return TEXT_PRODUCER_TYPES.has(sourceType) || isPickerType(sourceType)
    case "look":
      return LOOK_PICKER_NODE_TYPES.has(sourceType)
  }
}
