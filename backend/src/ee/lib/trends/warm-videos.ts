/**
 * The videos a published trend version shows, warmed on the CDN as it is
 * published (`warmVideoCopies`), so the first viewer of the trend's card and
 * page does not wait on a cold transform.
 *
 * Exactly what the public catalog serves: the shown original (the source's
 * display copy, or Example 1 on a version that hides its original — the
 * display copy is then never served, so never warmed) and every listed
 * example. The card's cover is one of those (Example 1, else the original).
 */
import { warmVideoCopies } from "../../../lib/warm-video-copies.js"
import { listedExamples, shownOriginal } from "./public-examples.js"
import type { TrendVersionData } from "./types.js"

/** The (address, width) pairs a published version shows, each address once. */
export function trendVersionVideos(data: TrendVersionData): Array<{ videoUrl: string; width: number }> {
  const out = new Map<string, number>()
  const original = shownOriginal(data)
  for (const v of [...(original ? [original] : []), ...listedExamples(data)]) {
    if (typeof v.videoUrl === "string" && !out.has(v.videoUrl)) out.set(v.videoUrl, v.width)
  }
  return [...out].map(([videoUrl, width]) => ({ videoUrl, width }))
}

/** Warm every video {@link trendVersionVideos} lists. Returns at once; never throws. */
export function warmTrendVersionVideos(data: TrendVersionData): void {
  try {
    for (const { videoUrl, width } of trendVersionVideos(data)) warmVideoCopies(videoUrl, width)
  } catch {
    /* never reaches the publish */
  }
}
