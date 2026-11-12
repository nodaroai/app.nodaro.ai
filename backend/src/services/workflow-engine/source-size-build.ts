/**
 * The workflow run's payload build, with the photo's size when "auto" needs it.
 *
 * `buildPayload` is synchronous, so the size of the photo an "auto" ratio
 * keeps the shape of is read here, ahead of the build, and handed in as
 * `PayloadBuildContext.sourceImage` — through the same probe the image routes
 * use, from the same image the build sends:
 *   - a source-image node (image-to-image / modify-image / edit-image): its
 *     wired or stored image (`autoAspectSourceImageUrl`), known up front;
 *   - Generate Image: the first image its build sends (`imageJobPhotoUrl` —
 *     the inpaint / refine base, else the first assembled reference), known
 *     only once its references have assembled. That one case builds once to
 *     read it and again with its size (`generateImageMayUsePhotoSize` gates
 *     it, so no other node is ever built twice); with references attached the
 *     build snaps against the i2i sibling, so the size is read only when the
 *     model asked with the assembled references needs it.
 * No photo, or a size that cannot be read: one build, without a size, and
 * "auto" snaps exactly as it always has.
 *
 * For a node that names a house model it also makes the served house models
 * current before the build (the orchestrator's answer comes from its API,
 * lib/house-models-served.ts); every other node never asks.
 */
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared/models"
import { buildPayload, type PayloadBuildContext } from "./payload-builder.js"
import { autoAspectSourceImageUrl, generateImageAutoNeedsPhotoSize, generateImageMayUsePhotoSize } from "./source-image.js"
import { probeImageDisplaySize } from "../../lib/image-source-size.js"
import { imageJobPhotoUrl } from "../../lib/image-auto-aspect.js"
import { refreshHouseModelsServed } from "../../lib/house-models-served.js"
import { namesHouseModel } from "../../lib/surface-deny.js"
import type { ResolvedInputs, SimpleNode } from "./types.js"

export type BuiltPayload = ReturnType<typeof buildPayload>

export async function buildPayloadWithSourceSize(
  node: SimpleNode,
  jobId: string,
  resolvedInputs: ResolvedInputs,
  usageLogId: string | undefined,
  ctx: PayloadBuildContext,
): Promise<BuiltPayload> {
  // A node that names a house model — in its data, or in the provider it was
  // handed (a FieldMapping, an app input) — is judged by `houseModelServed`,
  // which in the standalone orchestrator (no plugin loaded) answers from the
  // API: make that answer current first (cached; a no-op where the plugins are
  // loaded). The same `namesHouseModel` check as the build's narrow judge, so
  // a node that names none — every other model — never asks or waits, exactly
  // as on an install with no house model. A house model reached any other way
  // is asked about when the build judges it (`houseModelServedState` starts the
  // ask itself), and at worst the run is handed back once, with nothing held.
  // A drain during the ask rejects with its DrainAbortError: the run is handed back.
  if (namesHouseModel([node.data, resolvedInputs.provider])) await refreshHouseModelsServed()
  let photoUrl = autoAspectSourceImageUrl(node, resolvedInputs, ctx)
  let firstPass: BuiltPayload | undefined
  if (!photoUrl && generateImageMayUsePhotoSize(node)) {
    firstPass = buildPayload(node, jobId, resolvedInputs, usageLogId, ctx)
    photoUrl = generateImagePhotoUrl(node, firstPass.payload)
  }
  const sourceImage = photoUrl ? await probeImageDisplaySize(photoUrl) : undefined
  // Nothing to resolve with: the build already made is the build that runs.
  if (!sourceImage && firstPass) return firstPass
  return buildPayload(node, jobId, resolvedInputs, usageLogId, { ...ctx, sourceImage })
}

/**
 * The photo a built Generate Image payload's "auto" resolves against
 * (`imageJobPhotoUrl`), or undefined when its size cannot change what the build
 * sends: a run swapped to the trained character LoRA model, which takes no
 * "auto" (it may still carry an inpaint base — the route reads nothing for it
 * either), or a model — asked with the references the build assembled, so the
 * i2i sibling once they attach — with a native auto or no ratio lever.
 */
function generateImagePhotoUrl(node: SimpleNode, payload: BuiltPayload["payload"]): string | undefined {
  if (payload.model === FLUX_LORA_CHARACTER_MODEL_ID) return undefined
  const assembled = Array.isArray(payload.referenceImageUrls) ? payload.referenceImageUrls.length : 0
  return generateImageAutoNeedsPhotoSize(node, assembled) ? imageJobPhotoUrl(payload) : undefined
}
