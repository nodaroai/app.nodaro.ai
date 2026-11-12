import { VIDEO_REF_LIMITS_BY_PROVIDER, videoProviderRefsReplaceStartFrame } from "@nodaro/shared/models"

/**
 * Which endpoint is answering. The two lanes accept DIFFERENT things, so the
 * copy must differ:
 *
 *  - "text-to-video"  — /v1/text-to-video and the orchestrator's t2v arm. They
 *    reject on `videoProviderRequiresImage(provider)` BEFORE looking at any
 *    reference. `resolveVideoModeForInputs` sends a refs-only single-id model
 *    down this lane only when its catalog does NOT declare `reference-to-video`
 *    (one that does takes the image-to-video lane instead). References never
 *    help here.
 *  - "image-to-video" — /v1/generate-video, which is only reached with this
 *    error once its catalog-derived `hasMultimodalRef` check has already
 *    failed. For a provider that carries image refs, wiring references IS a
 *    valid alternative on this endpoint.
 */
export type ImageRequiredLane = "text-to-video" | "image-to-video"

/**
 * What the refused request carried in place of a start frame, so the message
 * names what was actually sent rather than what the model could take.
 */
export interface ImageRequiredSent {
  /** Reference images were sent. */
  readonly referenceImages?: boolean
  /** An end frame was sent (with no start frame). */
  readonly endFrame?: boolean
}

/**
 * The single "this model has no text-to-video mode" message.
 *
 * Three sites need it: the t2v route's fast-fail, the i2v route's conditional
 * branch, and the orchestrator's pre-reservation throw. BOTH facts it states
 * are catalog-derived and neither may become a hand-maintained provider list:
 *   - "requires an input image"  <- videoProviderRequiresImage (MODEL_CATALOG `modes`)
 *   - the reference clause       <- videoProviderRefsReplaceStartFrame(provider)
 *     (the same rule /v1/generate-video's own `hasMultimodalRef` reads); a
 *     model whose image references are in-between frames that need the start
 *     frame (Grok Imagine Video 1.5) says so instead
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
  sent: ImageRequiredSent = {},
): string {
  const refsReplaceStart = videoProviderRefsReplaceStartFrame(provider)
  const base = `${provider} requires an input image — connect an image to the node's image input`
  if (lane === "image-to-video" && refsReplaceStart) {
    return `${base}, or wire image references (this model accepts either on this endpoint).`
  }
  if (refsReplaceStart) {
    // True on the t2v lane even for a ref-capable model: this endpoint rejects
    // before references are considered.
    return `${base}. Reference images alone reach this model only on the image-to-video endpoint (POST /v1/generate-video).`
  }
  // A model whose image references are in-between frames that need the start
  // frame (Grok Imagine Video 1.5): say what the request sent instead of one.
  if ((VIDEO_REF_LIMITS_BY_PROVIDER[provider]?.images ?? 0) > 0) {
    if (sent.referenceImages) return `${base} (its image references are in-between frames, which need a start frame).`
    if (sent.endFrame) return `${base} (an end frame alone is not enough — it needs a start frame).`
    return `${base} (it needs a start frame).`
  }
  return `${base} (this model cannot use reference images — it needs a start frame).`
}

export function imageRequiredError(
  provider: string,
  lane: ImageRequiredLane = "text-to-video",
  sent: ImageRequiredSent = {},
): { error: { code: "image_required"; message: string } } {
  return { error: { code: "image_required", message: imageRequiredMessage(provider, lane, sent) } }
}
