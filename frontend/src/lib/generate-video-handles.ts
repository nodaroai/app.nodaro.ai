/**
 * Canonical handle IDs for the Generate Video node.
 * Order matches the visual BOTTOM-to-TOP layout on the node's left edge,
 * grouped into 4 clusters: text / image / audio / pickers.
 */
import { VIDEO_PRODUCER_TYPES, AUDIO_PRODUCER_TYPES } from "@nodaro/shared"
import {
  TEXT_PRODUCER_TYPES,
  IMAGE_PRODUCER_TYPES,
  IDENTITY_TYPES,
  LOOK_PICKER_TYPES,
  ELEMENTS_PICKER_TYPES,
} from "./generate-image-handles"

export const GENERATE_VIDEO_INPUT_HANDLES = [
  // Text cluster
  "prompt", "negative",
  // Image cluster
  "startFrame", "endFrame", "imageReferences", "videoReferences",
  // Audio cluster
  "audio", "audioReferences",
  // Pickers cluster
  "assets", "look", "elements",
] as const

export type GenerateVideoInputHandle = typeof GENERATE_VIDEO_INPUT_HANDLES[number]

const LOOK_PICKER_SET: ReadonlySet<string> = new Set(LOOK_PICKER_TYPES)
const ELEMENTS_PICKER_SET: ReadonlySet<string> = new Set(ELEMENTS_PICKER_TYPES)

export function isValidGenerateVideoConnection(
  targetHandle: string,
  sourceType: string,
  isPickerType: (s: string) => boolean,
): boolean {
  switch (targetHandle) {
    case "prompt":
      return TEXT_PRODUCER_TYPES.has(sourceType) || isPickerType(sourceType)
    case "negative":
      // Negative prompt is text-only — pickers like `mood: cheerful` would
      // invert the picker's intent if wired here. Matches the sibling
      // generate-image-handles.ts behavior.
      return TEXT_PRODUCER_TYPES.has(sourceType)
    case "startFrame":
    case "endFrame":
    case "imageReferences":
      return IMAGE_PRODUCER_TYPES.has(sourceType)
    case "videoReferences":
      return VIDEO_PRODUCER_TYPES.has(sourceType)
    case "audio":
    case "audioReferences":
      return AUDIO_PRODUCER_TYPES.has(sourceType)
    case "assets":
      return IDENTITY_TYPES.has(sourceType)
    case "look":
      return LOOK_PICKER_SET.has(sourceType)
    case "elements":
      return ELEMENTS_PICKER_SET.has(sourceType) || (isPickerType(sourceType) && !LOOK_PICKER_SET.has(sourceType))
    default:
      return false
  }
}
