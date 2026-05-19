/**
 * Replicate Grounded SAM Provider
 *
 * Uses adirik/grounded-sam — text-prompted segmentation (Grounding DINO +
 * Segment Anything). Given an image and a text prompt describing the subject,
 * returns a binary mask PNG isolating that subject.
 *
 * Input: image (URL) + text_prompt (subject description) + box_threshold
 * Output: array of result URLs — the mask PNG is the last element
 *
 * Called by owner/name (no pinned version hash) so Replicate resolves the
 * latest version; this avoids a hardcoded hash going stale.
 */

import Replicate from "replicate"
import type { ReconcileOpts } from "../provider.interface.js"
import { extractUrl } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"

// TODO: Verify the Grounded SAM model before enabling this feature.
// The model "adirik/grounded-sam" returned 404 during development.
// Alternatives to check: "schananas/grounded_sam" on Replicate.
// Once verified: pin a specific version hash and confirm parameter names
// (image, text_prompt, box_threshold) and output shape (mask = last element).

// TODO: Replace with verified model + version hash before launch
const GROUNDED_SAM_MODEL = "adirik/grounded-sam" as `${string}/${string}`

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
  // entering the poll loop (matches the rest of this provider).
  const prediction = await replicate.predictions.create({
    model: GROUNDED_SAM_MODEL,
    input: {
      image: imageUrl,
      text_prompt: textPrompt,
      box_threshold: boxThreshold,
    },
  })
  await fireOnTaskCreated(reconcileOpts, prediction.id, "[replicate:groundedSam]")
  const completed = await replicate.wait(prediction)
  const output = completed.output

  // Grounded SAM returns an array of output URLs; the mask PNG is the last
  // element (preceding entries are intermediate visualisations).
  const rawMask = Array.isArray(output)
    ? output[output.length - 1]
    : output

  if (rawMask === undefined || rawMask === null) {
    throw new Error("Grounded SAM did not return a valid mask URL")
  }

  const maskUrl = extractUrl(rawMask)

  console.log(`[Replicate:groundedSam] Mask: "${maskUrl}"`)

  return maskUrl
}
