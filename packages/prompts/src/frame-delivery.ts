/**
 * HOW A START/END FRAME TRAVELS — one plan, read by both ends.
 *
 * A frame can reach a model two ways: as a real frame, or as a reference image
 * bound in prose as the opening (or closing) frame. Which one is right is
 * measured per model — the Seedance 2.0 family crop-zooms a frame 2% and drifts
 * 11-26% darker within six frames, but holds its look from frame 0 when the same
 * image rides as a reference; every other model measured reproduces the opening
 * frame better as a frame (see `resolveFrameDelivery` in @nodaro/shared).
 *
 * The composition — where the frames sit in the reference list, which sentence
 * binds them, when the switch is refused — lives HERE rather than at the
 * dispatch site, because two places need the same answer:
 *
 *   - `backend/src/lib/video-frame-dispatch.ts` builds the actual request,
 *   - the editor's config panel tells the user which mode their node will run in.
 *
 * When those two disagree the panel lies, which is worse than having no panel
 * text at all. One function, two callers, no drift.
 */
import { VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared/models"
import { resolveFrameDelivery, type FrameDelivery } from "@nodaro/shared/video"
import { REF_BINDING } from "./ref-binding.js"
import { promptBindsFirstFrame } from "./seedance-2-inputs.js"

export interface FrameDeliveryPlanArgs {
  readonly provider: string | undefined
  /** The node's / caller's choice. `auto` (or absent) resolves per model. */
  readonly requested?: FrameDelivery
  /** Whether the model accepts reference images at all. */
  readonly supportsReferenceImages: boolean
  readonly startFrameUrl?: string
  readonly endFrameUrl?: string
  /** The user's OWN reference images, in their existing order. */
  readonly userReferenceUrls?: readonly string[]
  /** Consulted only to avoid a duplicate opening-frame sentence. */
  readonly prompt?: string
}

export interface FrameDeliveryPlan {
  /** What will actually happen — never `auto`. */
  readonly delivery: Exclude<FrameDelivery, "auto">
  /** The full reference list to send. Equals the user's own list under `frame`. */
  readonly referenceImageUrls: readonly string[]
  /** Sentence(s) to append to the prompt. Empty under `frame`. */
  readonly promptSuffix: string
  /** Set when reference delivery was WANTED but refused, so a caller can say why. */
  readonly refusedReason?: "no-reference-support" | "image-cap"
}

/**
 * Resolve delivery and compose the request shape that follows from it.
 *
 * Two refusals, both deliberate:
 *   - a model with no reference-image support keeps frame mode (there is nowhere
 *     for the frame to go);
 *   - a switch that would push past the model's image cap keeps frame mode,
 *     because the alternative is dropping one of the USER's reference images to
 *     make room for ours.
 *
 * The frames are appended AFTER the user's own images so their `@image_N`
 * ordinals never shift, and the opening sentence is skipped when the prompt
 * already binds its own first frame — a second binding at another position
 * dilutes the first back into coin-flip behaviour (field finding 2026-07-20).
 */
export function planFrameDelivery(args: FrameDeliveryPlanArgs): FrameDeliveryPlan {
  const userRefs = (args.userReferenceUrls ?? []).filter(Boolean)
  const requested = args.requested ?? "auto"
  const delivery = resolveFrameDelivery({
    provider: args.provider,
    requested,
    supportsReferenceImages: args.supportsReferenceImages,
  })

  const frames = [args.startFrameUrl, args.endFrameUrl].filter((u): u is string => Boolean(u))

  if (delivery === "frame" || frames.length === 0) {
    return {
      delivery: "frame",
      referenceImageUrls: userRefs,
      promptSuffix: "",
      ...(requested === "reference" && !args.supportsReferenceImages
        ? { refusedReason: "no-reference-support" as const }
        : {}),
    }
  }

  const cap = VIDEO_REF_LIMITS_BY_PROVIDER[args.provider ?? ""]?.images
  if (cap !== undefined && userRefs.length + frames.length > cap) {
    return { delivery: "frame", referenceImageUrls: userRefs, promptSuffix: "", refusedReason: "image-cap" }
  }

  const referenceImageUrls = [...userRefs]
  const sentences: string[] = []
  if (args.startFrameUrl) {
    referenceImageUrls.push(args.startFrameUrl)
    if (!promptBindsFirstFrame(args.prompt)) {
      sentences.push(REF_BINDING.frame(referenceImageUrls.length, "opening"))
    }
  }
  if (args.endFrameUrl) {
    referenceImageUrls.push(args.endFrameUrl)
    sentences.push(REF_BINDING.frame(referenceImageUrls.length, "closing"))
  }

  return { delivery: "reference", referenceImageUrls, promptSuffix: sentences.join(" ") }
}
