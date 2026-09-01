import { VIDEO_REF_LIMITS_BY_PROVIDER } from "@nodaro/shared"

import { promptBindsFirstFrame } from "./seedance-2-inputs.js"
import { identityRefsSentence, REF_BINDING } from "./video-reference-resolver.js"

/**
 * Gemini Omni Video i2v input resolution — the sibling of
 * `resolveSeedance2Inputs` for a model whose multimodal channel is ONE flat
 * `image_urls` list.
 *
 * WHY BINDING IS LOAD-BEARING: Gemini Omni receives the start frame and the
 * identity references in the same array, with nothing in the payload marking
 * which is which. A multimodal model treats unbound images as loose context —
 * field finding (recast keyframes run, 2026-08-14): the identity references
 * rode every call and the cast still drifted part to part, because the prompt
 * never said the images WERE identities to keep. So the resolver names the
 * roles in a prompt suffix, through the same `REF_BINDING` swap-point every
 * other video binding uses: image 1 is the opening frame; the rest are
 * identity references, explicitly not frames.
 *
 * BUDGETED, NEVER REJECTED, for the list this resolver assembles: KIE's quota
 * is `images + 2×videos ≤ 7`, and `runGeminiOmni` hard-rejects overflow. That
 * reject is right for a caller-assembled list (the user's own images should
 * not silently thin out) and wrong for THIS merge, where the overflow is our
 * own construction — so trailing references are dropped to fit, the start
 * frame always kept, mirroring `resolveSeedance2Inputs`' drop-trailing
 * convention, and the drop count is reported for the caller to log.
 *
 * BYTE-IDENTICAL when there is nothing to bind: no references ⇒ no suffix and
 * a single-image list — exactly what every plain gemini-omni i2v call has
 * always sent.
 */

export interface GeminiOmniI2vInputsArgs {
  /** The composed prompt, used only to detect an existing first-frame binding. */
  prompt?: string
  /** The start frame — always kept, always first in the list. */
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
  /** `[firstFrameUrl, ...keptRefs]` — the `image_urls` payload, quota-fitted. */
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
  const refs = (args.refImageUrls ?? []).filter((u): u is string => typeof u === "string" && u.length > 0)
  const slots = geminiOmniInputSlots(args.provider) - (args.videoConnected ? 2 : 0)
  const refSlots = Math.max(0, slots - 1)
  const kept = refs.slice(0, refSlots)
  const droppedRefImages = refs.length - kept.length
  const imageUrls = [args.firstFrameUrl, ...kept]
  if (kept.length === 0) return { imageUrls, promptSuffix: "", droppedRefImages }

  // The opening-frame sentence is suppressed when the prompt already binds it
  // at its own (working) position — same field-finding rule as seedance-2: a
  // duplicate directive at the end dilutes the one that works.
  const frameSentence = promptBindsFirstFrame(args.prompt) ? "" : REF_BINDING.frame(1, "opening")
  const promptSuffix = [frameSentence, identityRefsSentence(2, kept.length + 1)].filter(Boolean).join(" ")
  return { imageUrls, promptSuffix, droppedRefImages }
}
