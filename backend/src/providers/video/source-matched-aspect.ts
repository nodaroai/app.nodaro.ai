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

import { MODEL_CATALOG, NATIVE_ADAPTIVE_ASPECT } from "@nodaro/shared"
import { probeVideoSource } from "./ffmpeg-utils.js"

/**
 * Pick the aspect-ratio token closest to the source's real shape from the
 * provider's supported candidates. Non-ratio candidates (e.g. VEO's "Auto")
 * are skipped. Compared in log space so e.g. 16:9 and 9:16 are symmetric.
 */
export function closestAspectRatio(
  width: number,
  height: number,
  candidates: readonly string[],
): string | undefined {
  if (!width || !height) return undefined
  const target = Math.log(width / height)
  let best: string | undefined
  let bestDist = Infinity
  for (const candidate of candidates) {
    const [w, h] = candidate.split(":").map(Number)
    if (!w || !h) continue
    const dist = Math.abs(Math.log(w / h) - target)
    if (dist < bestDist) {
      bestDist = dist
      best = candidate
    }
  }
  return best
}

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
