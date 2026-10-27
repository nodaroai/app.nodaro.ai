import { probeMediaDuration } from "../../providers/video/ffmpeg-utils.js"
import type { ChargedPriceTable, EstimateNode } from "./credits.js"

/**
 * The probed lengths of the uploaded clips a server workflow estimate prices
 * by length (the run estimate, the published-app listing). An upload is the one
 * clip whose file the estimate knows before the run — the run sends it as it
 * is — so its length is read from the file, once per URL per
 * {@link CLIP_LENGTH_TTL_MS} (a listing re-prices without re-probing), as the
 * run's own reservation measures it. Each node that prices by such a clip
 * names the uploads it reads (Seedance reference clips, the Video Depth
 * source); a clip not probed here is priced at the node's worst case.
 */

/** How long a probed length is reused. A URL names its file; the TTL bounds memory, not staleness. */
const CLIP_LENGTH_TTL_MS = 30 * 60_000
const CLIP_LENGTH_CACHE_MAX = 2_000
const clipLengths = new Map<string, { sec: number; at: number }>()

/** Tests only: forget every probed length. */
export function __forgetUploadClipLengths(): void {
  clipLengths.clear()
}

/** The clip a source hands the run unchanged — an upload's file — else undefined. */
export function knownClipUrl(source: EstimateNode | undefined): string | undefined {
  if (source?.type !== "upload-video") return undefined
  const url = (source.data as { url?: unknown } | undefined)?.url
  return typeof url === "string" && url.trim() !== "" ? url.trim() : undefined
}

/**
 * A probed upload's length in seconds from `prices`, or undefined when the
 * source is no upload, was not probed, or could not be read (NaN) — the node's
 * worst case then stands.
 */
export function uploadClipSec(prices: ChargedPriceTable, source: EstimateNode | undefined): number | undefined {
  const url = knownClipUrl(source)
  const sec = url === undefined ? undefined : prices.uploadClipSec?.get(url)
  return sec !== undefined && Number.isFinite(sec) && sec > 0 ? sec : undefined
}

/** One URL's probed length (NaN = unreadable, which every quote counts as the worst case), cached. */
async function clipLengthSec(url: string): Promise<number> {
  const hit = clipLengths.get(url)
  if (hit && Date.now() - hit.at < CLIP_LENGTH_TTL_MS) return hit.sec
  const sec = await probeMediaDuration(url).catch(() => Number.NaN)
  if (clipLengths.size >= CLIP_LENGTH_CACHE_MAX) clipLengths.delete(clipLengths.keys().next().value as string)
  clipLengths.set(url, { sec, at: Date.now() })
  return sec
}

/**
 * `prices` with the lengths of `sources` (the upload nodes the estimate's
 * length-priced nodes read), except those in `replaceable` (an app's or
 * component's media inputs — the app user's file replaces them, so they stay
 * the worst case). Probes run in parallel and are cached per URL.
 */
export async function withUploadClipLengths(
  prices: ChargedPriceTable,
  sources: Iterable<EstimateNode | undefined>,
  replaceable?: ReadonlySet<string>,
): Promise<ChargedPriceTable> {
  const urls = new Set<string>()
  for (const source of sources) {
    const url = source?.id && replaceable?.has(source.id) ? undefined : knownClipUrl(source)
    if (url) urls.add(url)
  }
  if (urls.size === 0) return prices
  const lengths = await Promise.all([...urls].map(async (url) => [url, await clipLengthSec(url)] as const))
  return {
    base: (identifier) => prices.base(identifier),
    charge: (identifier, baseCredits) => prices.charge(identifier, baseCredits),
    editPlanPerMinute: prices.editPlanPerMinute,
    uploadClipSec: new Map(lengths),
  }
}
