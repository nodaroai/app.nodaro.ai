/**
 * Canonical handle IDs for the Generate Video Pro node.
 *
 * Sibling of Generate Video (generate-video-handles.ts), trimmed to the
 * levers the multi-segment Seedance-2 engine actually consumes: the text
 * cluster (`prompt` + `negative`) and the full image/video cluster
 * (`startFrame`, `endFrame`, `imageReferences`, `videoReferences`).
 *
 * - `videoReferences` is the EXTEND SOURCE (limit 1, handle-limits.ts): the
 *   pro run continues from this clip — segment 1 rides the same anchored
 *   continuation transport later segments use between themselves (2s tail as
 *   @video_1 + its last frame as the i2v opening anchor).
 * - `endFrame` lands on the FINAL segment only (the video's closing frame).
 * - `negative` is appended to every segment prompt as an "Avoid:" suffix —
 *   Seedance 2 has no native negative param (same fallback the image side
 *   uses for non-native providers).
 * - Deliberately still ABSENT vs generate-video: `audio`/`audioReferences`
 *   (per-segment reference-audio semantics are undefined for a stitched
 *   multi-segment run — `generateAudio` covers sound) and
 *   `assets`/`look`/`elements` (they resolve through the @mention/promotion
 *   machinery the gvp payload path doesn't port yet — see payload-builder.ts's
 *   generate-video-pro case; identity images flow via `imageReferences`).
 */
import { DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"

export const GENERATE_VIDEO_PRO_INPUT_HANDLES = [
  // Text cluster
  "prompt",
  "negative",
  // Image / video cluster
  "startFrame",
  "endFrame",
  "imageReferences",
  "videoReferences",
] as const

export type GenerateVideoProInputHandle = typeof GENERATE_VIDEO_PRO_INPUT_HANDLES[number]

export function isValidGenerateVideoProConnection(
  targetHandle: string,
  sourceType: string,
  isPickerType: (s: string) => boolean,
): boolean {
  switch (targetHandle) {
    case "prompt":
      return TEXT_PRODUCER_TYPES.has(sourceType) || isPickerType(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    case "negative":
      // Text-only — a picker wired here would invert its intent. Matches
      // generate-video-handles.ts / generate-image-handles.ts.
      return TEXT_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    case "startFrame":
    case "endFrame":
    case "imageReferences":
      // Dynamic producers (loop / list / sub-workflow / etc.) can emit image
      // URLs at runtime — accept them at the canvas to match the
      // orchestrator's runtime routing. Same escape hatch as generate-video.
      return IMAGE_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    case "videoReferences":
      return VIDEO_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    default:
      return false
  }
}
