/**
 * fal.ai Video Depth — `fal-ai/depth-anything-video` (Video Depth Anything).
 * Flat function called by the `video-depth` worker branch, mirroring
 * `fal/lip-sync.ts`. Only levers the shared `videoDepthLevers` grants reach the
 * wire; `include_raw_depths` is never sent (the node has no npz output).
 *
 * `FAL_VIDEO_DEPTH_CONFIGS` is also consulted by `lib/reconcile/fal.ts` to
 * recover the endpoint of a stuck row from its `input_data.provider`.
 */
import { runFalRequest, extractFalUrl } from "./client.js"
import { falCostUsd } from "./pricing.js"
import type { ReconcileOpts } from "../provider.interface.js"
import { videoDepthLevers } from "@nodaro/shared/media"
import { VIDEO_DEPTH_KEY_COVERAGE, type VideoDepthParams } from "../video-depth-params.js"

export const FAL_VIDEO_DEPTH_CONFIGS: Record<string, { endpoint: string }> = {
  "video-depth-anything": { endpoint: "fal-ai/depth-anything-video" },
}

const FAL_MODEL = { small: "VDA-Small", base: "VDA-Base", large: "VDA-Large" } as const

/**
 * Run a fal video-depth request. Returns the depth video URL plus a raw
 * provider USD cost (anomaly/display only — the credit charge is the reserved
 * duration bucket, never this value).
 */
export async function falVideoDepth(
  provider: string,
  videoUrl: string,
  params: VideoDepthParams,
  reconcileOpts?: ReconcileOpts,
): Promise<{ videoUrl: string; cost: number | null }> {
  const cfg = FAL_VIDEO_DEPTH_CONFIGS[provider]
  if (!cfg) throw new Error(`Unsupported fal video-depth provider: ${provider}`)
  const levers = videoDepthLevers(provider)
  const input: Record<string, unknown> = {
    video_url: videoUrl,
    model: FAL_MODEL[params.modelSize ?? "large"],
    ...(levers.has("colormap") && params.colormap ? { colormap: params.colormap } : {}),
    ...(levers.has("resolution") && params.resolution ? { resolution: params.resolution } : {}),
    ...(levers.has("sideBySide") && params.sideBySide ? { side_by_side: true } : {}),
  }
  const { output } = await runFalRequest({ endpoint: cfg.endpoint, input, label: "[fal:videoDepth]", reconcileOpts, keyCoverage: VIDEO_DEPTH_KEY_COVERAGE })
  return { videoUrl: extractFalUrl(output), cost: falCostUsd(provider, { seconds: params.durationSec ?? 0 }) }
}
