import {
  VIDEO_REF_LIMITS_BY_PROVIDER,
  isMinimaxH3Provider,
  isSeedance2Provider,
  isWan3Provider,
} from "@nodaro/shared"

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

/**
 * True when the provider's image-to-video path FOLDS a lone closing frame into
 * its reference images — i.e. an end frame with no start frame is a reference
 * the model actually receives, not a half-formed frame pair.
 *
 * The Seedance 2.x, MiniMax Hailuo 3 and Wan 3 families all assemble their KIE
 * input through the shared `resolveSeedance2Inputs` (`@nodaro/prompts`), whose
 * reference mode takes a lone last frame as the sole reference image plus a
 * closing-frame prompt hint. NOTHING else does: VEO ships `[imageUrl,
 * endFrameUrl]` verbatim (a lone end frame would reach KIE as `[null, url]`),
 * the Gemini Omni branch drops the frame when there is no start frame, and the
 * generic KIE path sends `end_frame` with no image param at all. So the
 * exemption is keyed to the FOLD, not to "carries image references" — the
 * catalog has no capability for it, and these three family predicates are the
 * same membership the provider layer itself branches on
 * (`kie/video.ts::applySeedance2Params` / `applyMinimaxH3Params` / `runWan3`).
 * A ref-capable provider that grows the fold gets the exemption by joining a
 * family here; one that does not keeps the honest `image_required` 400.
 */
export function videoProviderFoldsLoneEndFrame(provider: string): boolean {
  return isSeedance2Provider(provider) || isMinimaxH3Provider(provider) || isWan3Provider(provider)
}

export function imageRequiredError(
  provider: string,
  lane: ImageRequiredLane = "text-to-video",
): { error: { code: "image_required"; message: string } } {
  return { error: { code: "image_required", message: imageRequiredMessage(provider, lane) } }
}
