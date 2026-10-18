import { identityRefsSentence, imageBindingFor } from "./ref-binding.js"

/**
 * WHERE A START / END FRAME GOES WHEN IT SHARES A MODEL'S REFERENCE LIST — the
 * one platform convention (2026-10-18), for every video model whose frames and
 * reference images travel in a single image array (`videoProviderAppendsFrames`
 * in @nodaro/shared):
 *
 *   - the caller's own reference images come FIRST, in their order, so the
 *     caller's image token N (`{image:N}`, `{ref:<id>}`, a typed ordinal)
 *     always means their Nth reference;
 *   - the frames are appended AFTER them (start, then end) and named in the
 *     prompt as the opening / closing frame, in the provider's own syntax;
 *   - at the image cap the frames are KEPT — they are explicit intent — and
 *     trailing caller references are dropped and reported.
 *
 * `bindIdentities` adds the identity sentence the flat-image-list models carry
 * (Gemini Omni, VEO, Grok, HappyHorse: nothing in their payload says which
 * entries are identities, so the prompt says it). The Seedance-family resolver
 * calls this without it — byte for byte what it always emitted.
 */
export interface FrameReferenceSlotsArgs {
  /** Consulted only to skip a duplicate opening-frame sentence. */
  prompt?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  /** The caller's own reference images, in priority order. */
  refImageUrls?: readonly (string | undefined)[]
  /** The provider's image cap — frames and references together. */
  imageCap: number
  /** The provider's reference syntax (`videoProviderReferenceSyntax`). */
  syntax?: "@image_N" | "@image(n)" | "[Image N]"
  bindIdentities?: boolean
}

export interface FrameReferenceSlotsResult {
  /** `[...keptRefs, start?, end?]` — never longer than `imageCap` (bar the frames themselves). */
  imageUrls: string[]
  promptSuffix: string
  /** Trailing caller references dropped to keep the frames. */
  droppedRefImages: number
  /** 1-based seats of the frames in `imageUrls`; 0 when absent. */
  firstFrameOrdinal: number
  lastFrameOrdinal: number
}

export function placeFramesAfterReferences(args: FrameReferenceSlotsArgs): FrameReferenceSlotsResult {
  const refs = (args.refImageUrls ?? []).filter((u): u is string => typeof u === "string" && u.trim().length > 0)
  const frameCount = (args.firstFrameUrl ? 1 : 0) + (args.lastFrameUrl ? 1 : 0)
  const kept = refs.slice(0, Math.max(0, args.imageCap - frameCount))
  const droppedRefImages = refs.length - kept.length

  const imageUrls = [...kept]
  let firstFrameOrdinal = 0
  let lastFrameOrdinal = 0
  if (args.firstFrameUrl) { imageUrls.push(args.firstFrameUrl); firstFrameOrdinal = imageUrls.length }
  if (args.lastFrameUrl) { imageUrls.push(args.lastFrameUrl); lastFrameOrdinal = imageUrls.length }

  const syntax = args.syntax ?? "@image_N"
  const binding = imageBindingFor(syntax)
  // The duplicate-binding check reads the platform's `@image_N` form, which is
  // the only form a caller's prompt can already carry it in.
  const promptBindsStart = syntax === "@image_N" && promptBindsFirstFrame(args.prompt)
  let frameSentence = ""
  if (promptBindsStart && firstFrameOrdinal > 0 && lastFrameOrdinal === 0) {
    // The prompt already binds the first frame at its own (working) position.
  } else if (firstFrameOrdinal > 0 && lastFrameOrdinal > 0) {
    frameSentence = `Use ${binding.ordinal(firstFrameOrdinal)} as the opening (first) frame and ${binding.ordinal(lastFrameOrdinal)} as the closing (last) frame of the video.`
  } else if (firstFrameOrdinal > 0) {
    frameSentence = binding.frame(firstFrameOrdinal, "opening")
  } else if (lastFrameOrdinal > 0) {
    frameSentence = binding.frame(lastFrameOrdinal, "closing")
  }
  const identitySentence = args.bindIdentities && kept.length > 0 && frameCount > 0
    ? identityRefsSentence(1, kept.length, binding.ordinal)
    : ""
  const promptSuffix = [frameSentence, identitySentence].filter(Boolean).join(" ")
  return { imageUrls, promptSuffix, droppedRefImages, firstFrameOrdinal, lastFrameOrdinal }
}

/** True when the prompt ALREADY binds an image as the first/opening frame —
 *  e.g. the gvp overlap transport's colon-position directive ("use @image_1
 *  as the first frame, it is the last keyframe of @video_1"). Field finding
 *  (2026-07-20): the first-frame directive only works adjacent to the extend
 *  colon; a duplicate sentence at the END of the prompt (this resolver's
 *  default position) dilutes it back into coin-flip behavior — so when the
 *  prompt carries its own binding, the suffix is suppressed (the frame image
 *  itself still rides the reference list). */
export function promptBindsFirstFrame(prompt: string | undefined): boolean {
  if (!prompt) return false
  return /@image_\d+\s+as\s+the\s+(first|opening)\s*(\(first\))?\s*frame/i.test(prompt)
}
