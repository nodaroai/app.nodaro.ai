/**
 * Rules the image entry points apply to "auto", kept here so the callers of
 * each cannot answer differently: two for Generate Image (the route and the
 * workflow run), one for an image-to-image request (the route's credit check,
 * its handler and the MCP verb that sends no ratio of its own).
 */
import { isAutoAspectToken } from "@nodaro/shared/model-catalog"

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

/**
 * The edit models on which an image-to-image request that names no aspect
 * ratio runs at "auto": GPT Image 2, 2.5 and 2.6. Their provider config sends
 * 16:9 when a request names no ratio (`providers/kie/models.ts`), so an edit
 * of a square photo came back wide. "Keep the photo's shape" is what such a
 * request means, so it runs exactly as a request that names "auto": GPT
 * Image 2 and 2.5 receive their own auto, which keeps the shape (GPT Image 2,
 * 2026-11-10: a 768x1024 photo at 2K came back 1536x2048), and GPT Image 2.6,
 * whose own auto renders a portrait square, the listed ratio nearest the photo
 * (`autoAspectFromSourceImage` on its catalog entries, and on no other).
 *
 * Every listed model prices by quality, size and input images, never by
 * ratio, and renders every size at "auto", so the default never moves a price
 * (pinned in the tests).
 */
export const UNSET_RATIO_IS_AUTO_EDIT_MODELS: ReadonlySet<string> = new Set([
  "gpt-image-2-i2i",
  "gpt-image-2-5-flare-i2i",
  "gpt-image-2-5-sunburst-i2i",
  "gpt-image-2-6-flare-i2i",
  "gpt-image-2-6-sunburst-i2i",
  "gpt-image-2-6-economy-i2i",
])

/**
 * The aspect ratio an image-to-image request asks for: the one it names, or
 * "auto" when it names none on a model of `UNSET_RATIO_IS_AUTO_EDIT_MODELS`.
 * Any other request comes back unchanged (undefined stays undefined, so the
 * other models keep their own default).
 */
export function imageToImageAspectRatio<T>(provider: unknown, aspectRatio: T): T | "auto" {
  const namesNone = aspectRatio === undefined || aspectRatio === null || aspectRatio === ""
  return namesNone && typeof provider === "string" && UNSET_RATIO_IS_AUTO_EDIT_MODELS.has(provider) ? "auto" : aspectRatio
}
