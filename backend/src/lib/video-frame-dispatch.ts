/**
 * The one place a start/end frame is shaped before it reaches a provider.
 *
 * Two decisions, both measured (see the design spec and
 * `packages/shared/src/video-output-canvas.ts`):
 *
 *   FIT — resize the frame to the model's own output canvas. A frame that is
 *   not already that size is reshaped by the provider instead, and Seedance 2.5
 *   does it ONE FRAME IN: the opening frame is the user's image, the rest of the
 *   clip is ~2% taller. Five of ten production runs with a 940x1672 image
 *   snapped; three of three with the same image resized to 720x1280 did not.
 *
 *   DELIVERY — send the frame as a frame, or as a reference image bound in prose
 *   as the opening frame. The Seedance 2.0 family (fast, standard, mini)
 *   crop-zooms the frame 2% and drifts 11-26% darker within six frames in frame
 *   mode; as a reference the same models hold a flat look from frame 0. Every
 *   other model measured reproduces the opening frame BETTER in frame mode, so
 *   `auto` only switches the 2.0 family.
 *
 * Called by every video dispatch path — the router (KIE + Replicate + relay),
 * the private-plugin toolkit, and the LTX branch that bypasses the router. A
 * guard test fails the build when a new path skips it.
 */
import { getModel } from "@nodaro/shared/model-catalog"
import type { FrameDelivery } from "@nodaro/shared/video"
import { planFrameDelivery } from "@nodaro/prompts/assembly"
import { prepareVideoFrames, type FrameFitApplied } from "./video-frame-fit.js"
import type { ProviderOptions } from "../providers/provider.interface.js"

export interface FrameDispatchInput {
  readonly model: string | undefined
  readonly imageUrl?: string
  readonly endFrameUrl?: string
  readonly prompt?: string
  readonly options?: ProviderOptions
}

export interface FrameDispatchResult {
  readonly imageUrl?: string
  readonly endFrameUrl?: string
  readonly prompt?: string
  readonly options?: ProviderOptions
  /** What the fit did, if anything — for the job's output_data. */
  readonly applied: readonly FrameFitApplied[]
  readonly delivery: Exclude<FrameDelivery, "auto">
}

function supportsReferenceImages(model: string | undefined): boolean {
  if (!model) return false
  const features = getModel(model)?.features
  // A keyframes model's reference images are in-between FRAMES: a start/end
  // frame delivered "as a reference" would become one of them.
  return Boolean(features?.includes("reference-image") && !features.includes("keyframes"))
}

/**
 * Fit both frames, then decide how they travel. Never throws: a frame that
 * cannot be reshaped travels as it arrived (`prepareVideoFrames` is best-effort
 * by construction), and a delivery switch that cannot be expressed falls back to
 * frame mode.
 */
export async function applyFrameFitAndDelivery(input: FrameDispatchInput): Promise<FrameDispatchResult> {
  const { model, options } = input

  if (!input.imageUrl && !input.endFrameUrl) {
    // Nothing to fit and nothing to re-route; `planFrameDelivery` would answer
    // "frame" here anyway.
    return { ...input, applied: [], delivery: "frame" }
  }

  const fitted = await prepareVideoFrames({
    provider: model,
    resolution: options?.resolution,
    aspectRatio: options?.aspectRatio,
    imageUrl: input.imageUrl,
    endFrameUrl: input.endFrameUrl,
    fit: options?.frameFit,
  })

  const imageUrl = fitted.imageUrl ?? input.imageUrl
  const endFrameUrl = fitted.endFrameUrl ?? input.endFrameUrl

  // ONE planner, shared with the editor's config panel (@nodaro/prompts) so the
  // mode the panel promises is the mode the request actually runs.
  const plan = planFrameDelivery({
    provider: model,
    requested: options?.frameDelivery,
    supportsReferenceImages: supportsReferenceImages(model),
    startFrameUrl: imageUrl,
    endFrameUrl,
    userReferenceUrls: options?.referenceImageUrls,
    prompt: input.prompt,
  })

  if (plan.delivery === "frame") {
    if (plan.refusedReason === "image-cap") {
      console.log(
        `[frame-fit] ${model}: reference delivery would exceed the model's image cap — keeping frame mode`,
      )
    }
    return { ...input, imageUrl, endFrameUrl, applied: fitted.applied, delivery: "frame" }
  }

  const prompt = plan.promptSuffix
    ? [input.prompt?.trim(), plan.promptSuffix].filter(Boolean).join("\n")
    : input.prompt

  console.log(
    `[frame-fit] ${model}: delivering ${[imageUrl, endFrameUrl].filter(Boolean).length} frame(s) as reference image(s) ` +
      `(${options?.frameDelivery ?? "auto"} → reference)`,
  )

  return {
    imageUrl: undefined,
    endFrameUrl: undefined,
    prompt,
    options: { ...options, referenceImageUrls: [...plan.referenceImageUrls] },
    applied: fitted.applied,
    delivery: plan.delivery,
  }
}
