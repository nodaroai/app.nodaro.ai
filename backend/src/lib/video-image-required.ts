import { VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared"

/**
 * Which endpoint is answering. The two lanes accept DIFFERENT things, so the
 * copy must differ:
 *
 *  - "text-to-video"  — /v1/text-to-video and the orchestrator's t2v arm. They
 *    reject on `videoProviderRequiresImage(provider)` BEFORE looking at any
 *    reference, and `resolveVideoModeForInputs` sends a refs-only single-id
 *    model down this lane on purpose. References never help here.
 *  - "image-to-video" — /v1/generate-video, which is only reached with this
 *    error once its catalog-derived `hasMultimodalRef` check has already
 *    failed. For a provider that carries image refs, wiring references IS a
 *    valid alternative on this endpoint.
 */
export type ImageRequiredLane = "text-to-video" | "image-to-video"

/**
 * The single "this model has no text-to-video mode" message.
 *
 * Three sites need it: the t2v route's fast-fail, the i2v route's conditional
 * branch, and the orchestrator's pre-reservation throw. BOTH facts it states
 * are catalog-derived and neither may become a hand-maintained provider list:
 *   - "requires an input image"  <- videoProviderRequiresImage (MODEL_CATALOG `modes`)
 *   - the reference clause       <- VIDEO_REF_LIMITS_BY_PROVIDER[provider].images
 *     (the same source /v1/generate-video's own `hasMultimodalRef` reads)
 *
 * Every variant keeps the prefix `<provider> requires an input image` — the
 * orchestrator's test matches on exactly that (`payload-builder-image-required
 * .test.ts` uses /kling-3-omni requires an input image/), so do not reword it.
 *
 * The frontend editor gate (`frontend/src/lib/video-image-gate.ts` + the
 * `node.imageRequiredHint` key) restates the text-to-video variant, because the
 * editor's Run always goes through the mode resolver, i.e. the t2v lane. It
 * cannot import this module (backend-only graph); keep the two in step by hand.
 */
export function imageRequiredMessage(
  provider: string,
  lane: ImageRequiredLane = "text-to-video",
): string {
  const carriesImageRefs = (VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.images ?? 0) > 0
  const base = `${provider} requires an input image — connect an image to the node's image input`
  if (lane === "image-to-video" && carriesImageRefs) {
    return `${base}, or wire image references (this model accepts either on this endpoint).`
  }
  if (carriesImageRefs) {
    // True on the t2v lane even for a ref-capable model: this endpoint rejects
    // before references are considered.
    return `${base}. Reference images alone reach this model only on the image-to-video endpoint (POST /v1/generate-video).`
  }
  return `${base} (this model cannot use reference images — it needs a start frame).`
}

export function imageRequiredError(
  provider: string,
  lane: ImageRequiredLane = "text-to-video",
): { error: { code: "image_required"; message: string } } {
  return { error: { code: "image_required", message: imageRequiredMessage(provider, lane) } }
}
