/**
 * How long a dub source is — the measuring half of the dubbing span rule
 * (lib/dubbing-span.ts holds the pricing half). Read before a run is
 * reserved, by the route's preHandler (`POST /v1/dubbing`) and the workflow
 * run (lib/dubbing-pricing.ts :: stampDubbingDuration).
 *
 * An uploaded file is ffprobed; a link to a post (YouTube, TikTok, Instagram,
 * X, Facebook) goes through the hardened social-post probe, with its cache and
 * its cap on concurrent probes; any other link is ffprobed, behind the same
 * SSRF guard as every probed URL. A source that cannot be read is not an
 * error: the run holds the 30-minute ceiling and settles at delivery.
 */
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { socialPostOf } from "../providers/video/social-post-video.js"
import { probeSocialPostDurationSec } from "../services/workflow-engine/video-analysis-post-probe.js"

export { dubbingBaseCredits, dubbingReservePlan, effectiveDubbedSeconds } from "./dubbing-span.js"

/**
 * How long a dub source is, in whole seconds; undefined when it cannot be
 * read (a failed or blocked probe, a page that is not a media file). Never
 * throws: the caller holds the ceiling instead.
 */
export async function measureDubbingSourceSec(
  source: { readonly mediaUrl?: string; readonly sourceUrl?: string },
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<number | undefined> {
  const link = source.mediaUrl ?? source.sourceUrl
  if (!link) return undefined
  let seconds: number | null
  if (!source.mediaUrl && socialPostOf(link.trim())) {
    seconds = await probeSocialPostDurationSec(link)
  } else {
    try {
      seconds = await probeMediaDuration(link)
    } catch (err) {
      onProbeFailure(err)
      seconds = null
    }
  }
  return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined
}
