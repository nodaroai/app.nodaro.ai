/**
 * Source-matched aspect ratio for video flows that must mirror an input
 * video's shape (extend, continuation, ref-video generation).
 *
 * Strategy: providers with a verified native "match the visual input" token
 * (NATIVE_ADAPTIVE_ASPECT in @nodaro/shared) get that token — no network
 * round-trip, and exact matching even for off-catalog ratios like 4:5.
 * Everyone else falls back to ffprobing the source and snapping to the
 * closest catalog-supported ratio.
 */

import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { NATIVE_ADAPTIVE_ASPECT } from "@nodaro/shared/models"
import { probeVideoSource } from "./ffmpeg-utils.js"

// The ratio math itself lives in the dependency-free `aspect-ratio.ts` so
// provider code can snap a ratio without loading this module's ffmpeg imports.
// Re-exported here to keep the existing import path working.
export { closestAspectRatio } from "./aspect-ratio.js"
import { closestAspectRatio } from "./aspect-ratio.js"

/**
 * Resolve the aspect-ratio token a generation call should pass so its output
 * matches `sourceUrl`'s shape. Native-adaptive providers short-circuit
 * without probing; fallback providers ffprobe the source (a throw here is
 * pre-provider — callers should let it fail the job before any billing).
 */
export async function resolveSourceMatchedAspect(
  generationModel: string,
  sourceUrl: string,
): Promise<string | undefined> {
  const native = NATIVE_ADAPTIVE_ASPECT[generationModel]
  if (native) return native
  const probe = await probeVideoSource(sourceUrl)
  return closestAspectRatio(
    probe.width,
    probe.height,
    MODEL_CATALOG[generationModel]?.aspectRatios ?? [],
  )
}
