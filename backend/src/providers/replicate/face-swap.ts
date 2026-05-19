/**
 * Replicate Face Swap Provider
 *
 * Uses arabyai-replicate/roop_face_swap — one-shot video face replacement.
 * Input: swap_image (face photo) + target_video (source video)
 * Output: video with face replaced
 */

import type { ReconcileOpts } from "../provider.interface.js"
import { replicate, extractUrl, extractCost } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"

const ROOP_VERSION = "11b6bf0f4e14d808f655e87e5448233cceff10a45f659d71539cafb7163b2e84"

export async function replicateFaceSwap(
  faceImageUrl: string,
  targetVideoUrl: string,
  reconcileOpts?: ReconcileOpts,
): Promise<{ videoUrl: string; cost: number | null }> {
  console.log(`[Replicate:faceSwap] faceImage=${faceImageUrl.slice(0, 60)}...`)
  console.log(`[Replicate:faceSwap] targetVideo=${targetVideoUrl.slice(0, 60)}...`)

  const prediction = await replicate.predictions.create({
    version: ROOP_VERSION,
    input: {
      swap_image: faceImageUrl,
      target_video: targetVideoUrl,
    },
  })
  await fireOnTaskCreated(reconcileOpts, prediction.id, "[replicate:faceSwap]")
  const completed = await replicate.wait(prediction)
  const output = completed.output

  const videoUrl = extractUrl(
    typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output,
  )
  const cost = extractCost(completed.metrics as Record<string, unknown> | undefined)

  console.log(`[Replicate:faceSwap] Output: "${videoUrl}"`)
  console.log(`[Replicate:faceSwap] Cost: $${cost?.toFixed(6) ?? "N/A"}`)

  return { videoUrl, cost }
}
