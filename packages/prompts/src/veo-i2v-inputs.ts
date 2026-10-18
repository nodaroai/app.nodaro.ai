import { placeFramesAfterReferences } from "./frame-reference-slots.js"

/**
 * VEO 3.x i2v input resolution — the mutually-exclusive sibling of
 * `resolveGeminiOmniI2vInputs`. VEO's API carries ONE `imageUrls` array
 * (≤3) whose meaning flips with `generationType`: plain i2v reads it as
 * [first(, last)] frames; REFERENCE_2_VIDEO reads every entry as a
 * reference ingredient. Frames and identities cannot ride separate
 * channels, so an anchored call that must carry identity references moves
 * to REFERENCE_2_VIDEO with the frames bound in prose (requested, not
 * pixel-guaranteed — the accepted trade, same as seedance-2's reference mode).
 *
 * THE PLATFORM CONVENTION (2026-10-18, `placeFramesAfterReferences`): the
 * caller's references take the first seats, so their image token N is their
 * Nth reference; the start frame — and the end frame, VEO takes one — follow
 * them, bound as the opening / closing frame. At the 3-ingredient cap the
 * frames are kept (explicit intent) and trailing references drop, reported.
 * (Until then the anchor took seat 1 and an end frame was surrendered.)
 *
 * BYTE-IDENTICAL with no references: plain frame mode, frames kept, no
 * generationType, no suffix — exactly what every veo i2v call has always
 * sent.
 */

export interface VeoI2vInputsArgs {
  /** Used only to detect an existing first-frame binding (seedance rule). */
  prompt?: string
  firstFrameUrl: string
  endFrameUrl?: string
  refImageUrls?: Array<string | undefined>
}

export interface VeoI2vInputsResult {
  /** The `imageUrls` payload: frames in plain mode, [...refs, start, end?] in
   *  reference mode — never more than VEO's 3-ingredient cap. */
  imageUrls: string[]
  /** Present (REFERENCE_2_VIDEO) exactly when references ride. */
  generationType?: "REFERENCE_2_VIDEO"
  promptSuffix: string
  droppedRefImages: number
  /** Always false since the frames-after-references convention: an end frame
   *  is kept in reference mode. Kept for callers that log it. */
  droppedEndFrame: boolean
}

/** VEO's ingredient cap — the adapter's REFERENCE_2_VIDEO path has always
 *  sliced to 3 (kie/video.ts), mirrored in VIDEO_REF_LIMITS_BY_PROVIDER. */
const VEO_INGREDIENT_SLOTS = 3

export function resolveVeoI2vInputs(args: VeoI2vInputsArgs): VeoI2vInputsResult {
  const refs = (args.refImageUrls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0)
  if (refs.length === 0) {
    return {
      imageUrls: args.endFrameUrl ? [args.firstFrameUrl, args.endFrameUrl] : [args.firstFrameUrl],
      promptSuffix: "",
      droppedRefImages: 0,
      droppedEndFrame: false,
    }
  }
  const placed = placeFramesAfterReferences({
    prompt: args.prompt,
    firstFrameUrl: args.firstFrameUrl,
    lastFrameUrl: args.endFrameUrl,
    refImageUrls: refs,
    imageCap: VEO_INGREDIENT_SLOTS,
    bindIdentities: true,
  })
  return {
    imageUrls: placed.imageUrls,
    generationType: "REFERENCE_2_VIDEO",
    promptSuffix: placed.promptSuffix,
    droppedRefImages: placed.droppedRefImages,
    droppedEndFrame: false,
  }
}
