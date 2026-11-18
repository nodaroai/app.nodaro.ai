/**
 * Replicate Face Swap Provider
 *
 * Uses arabyai-replicate/roop_face_swap — one-shot video face replacement.
 * Input: swap_image (face photo) + target_video (source video)
 * Output: video with face replaced
 */

import type { ReconcileOpts } from "../provider.interface.js"
import { extractUrl, runReplicatePrediction } from "./client.js"

const ROOP_VERSION = "11b6bf0f4e14d808f655e87e5448233cceff10a45f659d71539cafb7163b2e84"

/**
 * The model's key in `REPLICATE_MODEL_USD_PER_SEC`: the prediction's GPU
 * seconds at its hardware's rate are what Replicate billed, recorded as the
 * job's `provider_cost`. Recorded only: the run commits its reservation.
 * The worker and the Replicate reconcile lane both price with it.
 */
export const FACE_SWAP_COST_MODEL_KEY = "roop-face-swap"

export async function replicateFaceSwap(
  faceImageUrl: string,
  targetVideoUrl: string,
  reconcileOpts?: ReconcileOpts,
): Promise<{ videoUrl: string; cost: number | null }> {
  console.log(`[Replicate:faceSwap] faceImage=${faceImageUrl.slice(0, 60)}...`)
  console.log(`[Replicate:faceSwap] targetVideo=${targetVideoUrl.slice(0, 60)}...`)

  const { output, cost } = await runReplicatePrediction({
    version: ROOP_VERSION,
    input: {
      swap_image: faceImageUrl,
      target_video: targetVideoUrl,
    },
    label: "[replicate:faceSwap]",
    reconcileOpts,
    costModelKey: FACE_SWAP_COST_MODEL_KEY,
  })

  const videoUrl = extractUrl(
    typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output,
  )

  console.log(`[Replicate:faceSwap] Output: "${videoUrl}"`)
  console.log(`[Replicate:faceSwap] Cost: $${cost?.toFixed(6) ?? "N/A"}`)

  return { videoUrl, cost }
}
