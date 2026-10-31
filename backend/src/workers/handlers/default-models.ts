// backend/src/workers/handlers/default-models.ts — the model a handler runs
// when its payload names none, and generate-image's choice of model. Shared by
// the handlers and by the concurrency lanes' provider attribution
// (lib/concurrency-lanes/provider-of.ts), which must pick the provider exactly
// as the handler will, so neither keeps its own copy. Kept apart from the
// handler files: importing those pulls in the provider and ffmpeg runtimes.
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { T2I_TO_I2I_VARIANT } from "@nodaro/shared/models"

/** image-to-video (handlers/video-ai.ts). */
export const IMAGE_TO_VIDEO_DEFAULT_PROVIDER = "minimax"
/** text-to-video (handlers/video-ai.ts). */
export const TEXT_TO_VIDEO_DEFAULT_PROVIDER = "minimax"
/** voiced-video: its clip is image-to-video (handlers/video-ai.ts). */
export const VOICED_VIDEO_DEFAULT_PROVIDER = "minimax"
/** video-to-video (handlers/video-ai.ts). */
export const VIDEO_TO_VIDEO_DEFAULT_PROVIDER = "wan"
/** lip-sync (handlers/video-ai.ts). */
export const LIP_SYNC_DEFAULT_PROVIDER = "kling-avatar"
/** motion-transfer (handlers/video-ai.ts). */
export const MOTION_TRANSFER_DEFAULT_PROVIDER = "kling"
/** video-upscale (handlers/video-ai.ts). */
export const VIDEO_UPSCALE_DEFAULT_PROVIDER = "topaz"
/** edit-image (handlers/image-ai.ts). */
export const EDIT_IMAGE_DEFAULT_PROVIDER = "recraft-upscale"
/** generate-character-motion (handlers/entity.ts). */
export const CHARACTER_MOTION_DEFAULT_PROVIDER = "kling"
/** generate-location-motion (handlers/entity.ts). */
export const LOCATION_MOTION_DEFAULT_PROVIDER = "kling"
/** generate-object-motion (handlers/entity.ts). */
export const OBJECT_MOTION_DEFAULT_PROVIDER = "kling-turbo"
/** generate-creature-motion (handlers/entity.ts). */
export const CREATURE_MOTION_DEFAULT_PROVIDER = "kling-turbo"

/** The generate-image fields that decide which model runs. */
export interface GenerateImageModelInput {
  model?: string
  provider?: string
  aspectRatio?: string
  baseImageUrl?: string
  referenceImageUrls?: string[]
  maskUrl?: string
}

/**
 * The model generate-image runs (handlers/image-ai.ts): the payload's model,
 * else its provider, else the general default — swapped to its image-to-image
 * sibling for an edit of a base (an inpaint, or an explicit `baseImageUrl`).
 */
export function generateImageModelOf(d: GenerateImageModelInput): {
  /** The model named (or defaulted), before the image-to-image swap. */
  resolvedModel: string
  effectiveModel: string
  inpaintBase: string | undefined
  isInpaint: boolean
  isI2I: boolean
} {
  const resolvedModel = d.model ?? d.provider ?? defaultImageModel("general", d.aspectRatio)
  const inpaintBase = d.baseImageUrl ?? d.referenceImageUrls?.[0]
  // A mask present + a base → masked inpaint (composite + region hint).
  const isInpaint = Boolean(d.maskUrl && inpaintBase)
  // An EXPLICIT baseImageUrl (the "refine from this result" / full-image i2i case)
  // OR an inpaint → run image-to-image conditioned on the base.
  const isI2I = isInpaint || Boolean(d.baseImageUrl)
  const effectiveModel = isI2I ? (T2I_TO_I2I_VARIANT[resolvedModel] ?? resolvedModel) : resolvedModel
  return { resolvedModel, effectiveModel, inpaintBase, isInpaint, isI2I }
}
