import { VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared/models"

import { placeFramesAfterReferences } from "./frame-reference-slots.js"

/**
 * Gemini Omni Video i2v input resolution — the sibling of
 * `resolveSeedance2Inputs` for a model whose multimodal channel is ONE flat
 * `image_urls` list.
 *
 * THE PLATFORM CONVENTION (2026-10-18, `placeFramesAfterReferences`): the
 * caller's identity references come first, so their image token N is their Nth
 * reference, and the start frame is appended after them. Until then the frame
 * led the list, so a caller's `@image_1` landed on the frame.
 *
 * WHY BINDING IS LOAD-BEARING: Gemini Omni receives the start frame and the
 * identity references in the same array, with nothing in the payload marking
 * which is which. A multimodal model treats unbound images as loose context —
 * field finding (recast keyframes run, 2026-08-14): the identity references
 * rode every call and the cast still drifted part to part, because the prompt
 * never said the images WERE identities to keep. So the resolver names the
 * roles in a prompt suffix: the references are identity references, explicitly
 * not frames, and the last image is the opening frame.
 *
 * BUDGETED, NEVER REJECTED, for the list this resolver assembles: KIE's quota
 * is `images + 2×videos ≤ 7`, and `runGeminiOmni` hard-rejects overflow. That
 * reject is right for a caller-assembled list (the user's own images should
 * not silently thin out) and wrong for THIS merge, where the overflow is our
 * own construction — so trailing references are dropped to fit, the start
 * frame always kept (the convention's tie-break), and the drop count is
 * reported for the caller to log.
 *
 * BYTE-IDENTICAL when there is nothing to bind: no references ⇒ no suffix and
 * a single-image list — exactly what every plain gemini-omni i2v call has
 * always sent.
 */

export interface GeminiOmniI2vInputsArgs {
  /** The composed prompt, used only to detect an existing first-frame binding. */
  prompt?: string
  /** The start frame — always kept, appended after the references. */
  firstFrameUrl: string
  /** Identity references, in priority order (trailing ones drop first). */
  refImageUrls?: Array<string | undefined>
  /** A connected source video occupies 2 of the 7 input slots (KIE quota). */
  videoConnected?: boolean
  /** The Omni SKU this run targets — defaults to `gemini-omni-video` for
   *  back-compat. Both SKUs cap at 7 today, so passing it is behaviour-neutral;
   *  it stops the flash path from silently reading the pro model's quota if the
   *  two ever diverge. */
  provider?: string
}

export interface GeminiOmniI2vInputsResult {
  /** `[...keptRefs, firstFrameUrl]` — the `image_urls` payload, quota-fitted. */
  imageUrls: string[]
  /** The role-binding sentences; empty when no reference survived the budget. */
  promptSuffix: string
  /** References dropped to fit the quota — surface in a log, never silently. */
  droppedRefImages: number
}

/** The catalog-declared cap (7) — read PER SKU from the shared limits map so the
 *  wire-contract number has one home; the literal is only the safety net. */
const DEFAULT_GEMINI_OMNI_PROVIDER = "gemini-omni-video"
function geminiOmniInputSlots(provider: string | undefined): number {
  return VIDEO_REF_LIMITS_BY_PROVIDER[provider ?? DEFAULT_GEMINI_OMNI_PROVIDER]?.images ?? 7
}

export function resolveGeminiOmniI2vInputs(args: GeminiOmniI2vInputsArgs): GeminiOmniI2vInputsResult {
  const slots = geminiOmniInputSlots(args.provider) - (args.videoConnected ? 2 : 0)
  const placed = placeFramesAfterReferences({
    prompt: args.prompt,
    firstFrameUrl: args.firstFrameUrl,
    refImageUrls: args.refImageUrls,
    imageCap: Math.max(1, slots),
    bindIdentities: true,
  })
  if (placed.imageUrls.length === 1) {
    return { imageUrls: placed.imageUrls, promptSuffix: "", droppedRefImages: placed.droppedRefImages }
  }
  return { imageUrls: placed.imageUrls, promptSuffix: placed.promptSuffix, droppedRefImages: placed.droppedRefImages }
}
