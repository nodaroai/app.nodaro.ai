import { promptBindsFirstFrame } from "./seedance-2-inputs.js"
import { identityRefsSentence, REF_BINDING } from "./video-reference-resolver.js"

/**
 * VEO 3.x i2v input resolution — the mutually-exclusive sibling of
 * `resolveGeminiOmniI2vInputs`. VEO's API carries ONE `imageUrls` array
 * (≤3) whose meaning flips with `generationType`: plain i2v reads it as
 * [first(, last)] frames; REFERENCE_2_VIDEO reads every entry as a
 * reference ingredient. Frames and identities cannot ride separate
 * channels, so an anchored call that must carry identity references moves
 * to REFERENCE_2_VIDEO with the anchor in seat 1, bound in prose as the
 * opening frame (requested, not pixel-guaranteed — the accepted trade,
 * same as seedance-2's reference mode).
 *
 * REFERENCES WIN THE SEATS (the 2026-08-14 standing rule: refs are a must,
 * frames additional): the end anchor is dropped in reference mode rather
 * than spending one of three seats on a closing guess. The caller logs it.
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
  /** The `imageUrls` payload: frames in plain mode, [anchor, ...refs] in
   *  reference mode — never more than VEO's 3-ingredient cap. */
  imageUrls: string[]
  /** Present (REFERENCE_2_VIDEO) exactly when references ride. */
  generationType?: "REFERENCE_2_VIDEO"
  promptSuffix: string
  droppedRefImages: number
  /** True when an end anchor was surrendered to reference mode. */
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
  const kept = refs.slice(0, VEO_INGREDIENT_SLOTS - 1)
  const droppedRefImages = refs.length - kept.length
  const frameSentence = promptBindsFirstFrame(args.prompt) ? "" : REF_BINDING.frame(1, "opening")
  return {
    imageUrls: [args.firstFrameUrl, ...kept],
    generationType: "REFERENCE_2_VIDEO",
    promptSuffix: [frameSentence, identityRefsSentence(2, kept.length + 1)].filter(Boolean).join(" "),
    droppedRefImages,
    droppedEndFrame: Boolean(args.endFrameUrl),
  }
}
