/**
 * Canonical handle IDs for the Generate Video Pro node.
 *
 * Trimmed sibling of Generate Video (generate-video-handles.ts): only the
 * text cluster's `prompt` and the image cluster's `startFrame` +
 * `imageReferences` — no `negative` (the node has no negativePrompt field),
 * no end frame / video refs / audio clusters, no pickers cluster. The
 * provider set is Seedance-2-family only, which never uses those levers.
 */
import { DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES } from "./generate-image-handles"

export const GENERATE_VIDEO_PRO_INPUT_HANDLES = [
  "prompt",
  "startFrame",
  "imageReferences",
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
    case "startFrame":
    case "imageReferences":
      // Dynamic producers (loop / list / sub-workflow / etc.) can emit image
      // URLs at runtime — accept them at the canvas to match the
      // orchestrator's runtime routing. Same escape hatch as generate-video.
      return IMAGE_PRODUCER_TYPES.has(sourceType) || DYNAMIC_PRODUCER_TYPES.has(sourceType)
    default:
      return false
  }
}
