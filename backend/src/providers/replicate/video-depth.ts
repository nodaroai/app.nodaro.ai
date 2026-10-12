/**
 * Replicate Video Depth — `lucataco/depth-anything-video` (Depth Anything v1,
 * per frame), pinned version. Takes only the video and an encoder; every other
 * lever is dropped here by construction. Its native output is the inferno
 * colormap — the node's `colormap` lever (grayscale | inferno for this
 * provider) is applied afterwards by the worker's ffmpeg pass
 * (`videoDepthNeedsGrayscalePass`), never sent to Replicate.
 */
import { runReplicatePrediction, extractUrl } from "./client.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { VIDEO_DEPTH_KEY_COVERAGE, type VideoDepthParams } from "../video-depth-params.js"

const VERSION = "9143691405afc64c7952499a1e81e3f779535a8916c8da7154a9995f145d5e6d"
const ENCODER = { small: "vits", base: "vitb", large: "vitl" } as const

export async function replicateVideoDepth(
  provider: string,
  videoUrl: string,
  params: VideoDepthParams,
  reconcileOpts?: ReconcileOpts,
): Promise<{ videoUrl: string; cost: number | null }> {
  const { output, cost } = await runReplicatePrediction({
    version: VERSION,
    input: { video: videoUrl, encoder: ENCODER[params.modelSize ?? "large"] },
    label: "[replicate:videoDepth]",
    reconcileOpts,
    costModelKey: provider,
    keyCoverage: VIDEO_DEPTH_KEY_COVERAGE,
  })
  const first = typeof output === "string" ? output : Array.isArray(output) && output.length > 0 ? output[0] : output
  return { videoUrl: extractUrl(first), cost }
}
