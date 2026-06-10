/**
 * Replicate Grounded SAM Provider
 *
 * Uses schananas/grounded_sam — text-prompted segmentation (Grounding DINO +
 * Segment Anything). Given an image and a text prompt describing the subject,
 * returns a binary mask PNG/JPG isolating that subject (white = subject).
 *
 * Model + version are PINNED (see GROUNDED_SAM_MODEL / GROUNDED_SAM_VERSION)
 * so the result is reproducible — the repo rule (replicate/CLAUDE.md) forbids
 * floating owner/name references in production.
 *
 * Input:  image (URL) + mask_prompt (subject description) + adjustment_factor
 *         (mask erosion/dilation; -ve erodes, +ve dilates)
 * Output: array of result URLs. This model emits FOUR images in a fixed order:
 *           [0] annotated_picture_mask.*      (visualisation)
 *           [1] neg_annotated_picture_mask.*  (negative-prompt visualisation)
 *           [2] mask.*                        (white = subject — the one we want)
 *           [3] inverted_mask.*               (white = background — INVERTED)
 *         We select the element named `mask.<ext>` (NOT the last element, which
 *         is the inverted mask). See pickMaskFromOutput.
 */

import Replicate from "replicate"
import type { ReconcileOpts } from "../provider.interface.js"
import { extractUrl } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"

// Verified 2026-06-09 against Replicate (GET model API): version exists, input
// params (image / mask_prompt / adjustment_factor) and the 4-element output
// order confirmed; the `mask.*` element is a white-on-black subject mask
// (mean brightness 23, ~9% white), `inverted_mask.*` is its inverse.
export const GROUNDED_SAM_MODEL = "schananas/grounded_sam" as `${string}/${string}`
export const GROUNDED_SAM_VERSION =
  "ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c"

/** A URL basename of exactly `mask.<ext>` (NOT `inverted_mask`, NOT `*annotated*`). */
const PLAIN_MASK_BASENAME = /(?:^|\/)mask\.[a-z0-9]+(?:\?|$)/i

/**
 * Extract the subject mask URL from this model's output.
 *
 * Polarity contract: the returned mask is WHITE = subject = the region to edit,
 * which matches the painter / inpaint-composite convention (white = edit). The
 * model also returns an `inverted_mask.*` (white = background) as the LAST array
 * element — we deliberately do NOT pick that one. If you swap the underlying
 * model, RE-CHECK polarity here (a swapped model may instead emit an alpha matte
 * or an inverted mask that would need normalising before use).
 *
 * Throws a clear Error if no usable mask URL is present.
 */
export function pickMaskFromOutput(output: unknown): string {
  // Single URL (string or FileOutput) → use it directly.
  if (!Array.isArray(output)) {
    if (output === undefined || output === null) {
      throw new Error("Grounded SAM returned no output (expected a mask URL)")
    }
    return extractUrl(output)
  }

  if (output.length === 0) {
    throw new Error("Grounded SAM returned an empty output array (no mask)")
  }

  const urls = output.map((item) => extractUrl(item))

  // Prefer the element literally named `mask.<ext>` — this model emits both a
  // `mask.*` (white = subject) and an `inverted_mask.*` (white = background, the
  // LAST element). Matching the exact basename avoids picking the inverted one.
  const plainMask = urls.find((u) => PLAIN_MASK_BASENAME.test(u))
  if (plainMask) {
    return plainMask
  }

  // Fallback if the model's filename convention ever changes: skip anything that
  // is obviously a visualisation or the inverted mask, otherwise take the last.
  const nonViz = urls.filter(
    (u) => !/inverted/i.test(u) && !/annotated/i.test(u),
  )
  const fallback = (nonViz.length ? nonViz : urls)[
    (nonViz.length ? nonViz : urls).length - 1
  ]
  if (!fallback) {
    throw new Error("Grounded SAM did not return a valid mask URL")
  }
  return fallback
}

export async function runGroundedSam(
  imageUrl: string,
  textPrompt: string,
  boxThreshold: number,
  apiToken: string,
  reconcileOpts?: ReconcileOpts,
): Promise<string> {
  console.log(`[Replicate:groundedSam] image=${imageUrl.slice(0, 60)}...`)
  console.log(`[Replicate:groundedSam] prompt="${textPrompt}" boxThreshold=${boxThreshold}`)

  const replicate = new Replicate({ auth: apiToken })

  // Decomposed from `replicate.run(...)` into `predictions.create` +
  // `replicate.wait` so we can fire onTaskCreated with prediction.id before
  // entering the poll loop (matches the rest of this provider). The version is
  // PINNED (never floating owner/name) per replicate/CLAUDE.md.
  //
  // NOTE: schananas/grounded_sam takes `mask_prompt` (the subject text) and has
  // NO box_threshold lever; `boxThreshold` is kept in the signature for the
  // generate-mask caller but is not a model input for this model.
  const prediction = await replicate.predictions.create({
    version: GROUNDED_SAM_VERSION,
    input: {
      image: imageUrl,
      mask_prompt: textPrompt,
      adjustment_factor: 0,
    },
  })
  await fireOnTaskCreated(reconcileOpts, prediction.id, "[replicate:groundedSam]")
  const completed = await replicate.wait(prediction)

  // White = subject = region to edit (painter convention). See pickMaskFromOutput.
  const maskUrl = pickMaskFromOutput(completed.output)

  console.log(`[Replicate:groundedSam] Mask: "${maskUrl}"`)

  return maskUrl
}
