/**
 * Connection-time validator for the Video SFX node.
 *
 * Mirrors the structure of `generate-video-handles.ts::isValidGenerateVideoConnection`
 * but for the narrower Video SFX surface:
 *   - "prompt"   accepts text producers OR visual pickers
 *   - "negative" accepts text producers OR visual pickers
 *               (Video SFX intentionally lets pickers influence the negative
 *                channel — unlike Generate Video, which restricts negative to
 *                pure text to avoid inverting picker semantics.)
 *   - "video"    accepts video producers (the source clip to add SFX to)
 *
 * Unknown handle IDs return `false` (strict — same as generate-video-handles).
 *
 * Task 17 wires this into `connection-validation.ts`.
 */
import { VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES } from "@/lib/generate-image-handles"

export function isValidVideoSfxConnection(
  targetHandleId: string,
  sourceType: string,
  isPickerType: (s: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
    case "negative":
      return TEXT_PRODUCER_TYPES.has(sourceType) || isPickerType(sourceType)
    case "video":
      return VIDEO_PRODUCER_TYPES.has(sourceType)
    default:
      return false
  }
}
