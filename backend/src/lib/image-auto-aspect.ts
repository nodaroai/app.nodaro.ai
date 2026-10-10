/**
 * Two rules every Generate Image entry point applies to "auto", kept here so
 * the route and the workflow run cannot answer differently.
 */
import { isAutoAspectToken } from "@nodaro/shared"

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/**
 * The first image a generate-image job sends its provider — the photo "auto"
 * keeps the shape of. The worker's own precedence (`inpaintBase` in
 * workers/handlers/image-ai.ts): an inpaint / refine base when one is set, else
 * the first reference image, which is what the T2I→I2I swap sends.
 */
export function imageJobPhotoUrl(job: { baseImageUrl?: unknown; referenceImageUrls?: unknown }): string | undefined {
  const refs = Array.isArray(job.referenceImageUrls) ? job.referenceImageUrls : []
  return nonEmpty(job.baseImageUrl) ?? nonEmpty(refs[0])
}

/**
 * The ratio a trained character LoRA model is sent. That model has no catalog
 * entry and its adapter forwards `aspect_ratio` as is, so "auto" — which it
 * cannot take — is omitted and the adapter's default applies; any other value
 * passes through unchanged.
 */
export function aspectRatioForLoraModel(aspectRatio: unknown): string | undefined {
  if (isAutoAspectToken(aspectRatio)) return undefined
  return typeof aspectRatio === "string" ? aspectRatio : undefined
}
