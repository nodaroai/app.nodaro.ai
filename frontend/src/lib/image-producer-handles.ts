/**
 * Per-node typed-handle predicates for image-producer nodes:
 * edit-image, modify-image, image-to-image, generate-mask,
 * upscale-image, remove-background, face-swap (video producer),
 * image-to-text (text producer from an image input).
 *
 * Each `isValid<Node>Connection(targetHandleId, sourceType, isPickerType)`
 * returns true iff a source node type is allowed on the given target
 * handle. The same predicates are called from `connection-validation.ts`
 * (drag-to-connect) AND `HandlePopover` (one-click Connect button), so
 * routing and visual-candidate highlight always agree.
 *
 * Convention: every typed image/video/audio/text target handle OR's in
 * `DYNAMIC_PRODUCER_TYPES` (loop / list / sub-workflow / reduce /
 * adjust-volume) — without that escape hatch, the canvas validator hard-
 * rejects edges the backend resolver would happily route at runtime
 * (same drift fix #2823 / #2827 applied to image/video/audio).
 */
import { VIDEO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, IDENTITY_TYPES } from "./generate-image-handles"

const ACCEPTS_IMAGE_OR_DYN = (s: string): boolean =>
  IMAGE_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_VIDEO_OR_DYN = (s: string): boolean =>
  VIDEO_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)
const ACCEPTS_TEXT_OR_DYN = (s: string): boolean =>
  TEXT_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)

/** Sources that can supply a picker prompt-fragment to the `cinematography`
 *  legacy target on edit/modify/image-to-image. Mirrors getCompatibleNodes'
 *  cinematography branch (accepts any visual picker). */
const ACCEPTS_CINEMATOGRAPHY = (
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean => isVisualPicker(sourceType)

// ─── edit-image ────────────────────────────────────────────────────────
// Inputs: image, mask, cinematography. Source: image (renamed from `out`).
export function isValidEditImageConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "mask":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── modify-image ──────────────────────────────────────────────────────
// Inputs: image, mask (conditional on provider — predicate accepts it
// unconditionally so a connection saved with a mask-supporting provider
// stays valid if the user later switches providers; the config panel
// hides the pip via supportsMask). Source: image (renamed from `out`).
export function isValidModifyImageConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "mask":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── image-to-image ────────────────────────────────────────────────────
// Same shape as modify-image.
export function isValidImageToImageConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "mask":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── generate-mask ─────────────────────────────────────────────────────
// Single image input. Outputs are static (image + mask) — no validator
// needed on the source side.
export function isValidGenerateMaskConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── upscale-image ─────────────────────────────────────────────────────
// Single image input. Source: image (renamed from `out`).
export function isValidUpscaleImageConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── remove-background ─────────────────────────────────────────────────
// Single image input. Source: image (renamed from `out`).
export function isValidRemoveBackgroundConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── face-swap ─────────────────────────────────────────────────────────
// Inputs: face (image producer — a face image), video (renamed from `in`).
// Source: video (renamed from `out`).
//
// `face` also accepts identity refs (character/face) — both extract a face
// image at execution time. The backend's face-swap resolver reads
// `imageUrl` from the upstream node regardless of which identity type it is.
const ACCEPTS_FACE_OR_IDENTITY = (sourceType: string): boolean =>
  ACCEPTS_IMAGE_OR_DYN(sourceType) || IDENTITY_TYPES.has(sourceType)

export function isValidFaceSwapConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "face":
      return ACCEPTS_FACE_OR_IDENTITY(sourceType)
    case "video":
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── image-to-text ─────────────────────────────────────────────────────
// Single image input. Source: text (already `text` — no rename needed).
export function isValidImageToTextConnection(
  targetHandleId: string,
  sourceType: string,
): boolean {
  switch (targetHandleId) {
    case "image":
      return ACCEPTS_IMAGE_OR_DYN(sourceType)
    case "video":
      // Backend will pull the first frame from a video input (frame-extract
      // fallback). Accept video producers as image-to-text sources.
      return ACCEPTS_VIDEO_OR_DYN(sourceType)
    case "text":
      // image-to-text can also accept a text prompt for guided captioning
      // via the `customPrompt` field (LLM_FEATURE_DEFAULTS["image-to-text"]).
      return ACCEPTS_TEXT_OR_DYN(sourceType)
    default:
      return false
  }
}

// ─── Friendly labels for source-direction popover candidate rows ──────

export const IMAGE_PRODUCER_HANDLE_LABELS: Record<string, Record<string, string>> = {
  "edit-image":        { image: "Image", mask: "Mask", cinematography: "Cinematography" },
  "modify-image":      { image: "Image", mask: "Mask", cinematography: "Cinematography" },
  "image-to-image":    { image: "Image", mask: "Mask", cinematography: "Cinematography" },
  "generate-mask":     { image: "Image" },
  "upscale-image":     { image: "Image" },
  "remove-background": { image: "Image" },
  "face-swap":         { face: "Face", video: "Video" },
  "image-to-text":     { image: "Image", video: "Video", text: "Prompt" },
}
