/**
 * silence-detect's liveness budget — PURE (imports only the ceiling leaf), the
 * same arrangement as `audio-sync-budget.ts`.
 *
 * The node reads its source through the media proxy, whose source fetch runs
 * under the staged big-media limits (Track 0.19): up to `DOWNLOAD_MAX_MS` for a
 * multi-gigabyte original. Before that, one flat 120 s bounded the fetch and the
 * 90-minute default heartbeat covered the node; now it would not, so it declares
 * the sum of its steps' ceilings, in the order it runs them. A real run on a
 * cached proxy takes seconds.
 */
import {
  DEFAULT_FFMPEG_TIMEOUT_MS,
  DOWNLOAD_MAX_MS,
  DOWNLOAD_TIMEOUT_MS,
  FFPROBE_TIMEOUT_MS,
  MEDIA_PROXY_FFMPEG_TIMEOUT_MS,
} from "../video/ffmpeg-timeouts.js"

/** Its audio proxy on a cache miss (fetch the original under the big-media
 *  ceiling, check it has an audio track, encode), fetch the proxy (flat 120 s —
 *  a 16 kHz mono proxy is small), one `silencedetect` pass (the default ffmpeg
 *  ceiling), one duration probe. */
export const SILENCE_DETECT_BUDGET_MS =
  DOWNLOAD_MAX_MS + FFPROBE_TIMEOUT_MS + MEDIA_PROXY_FFMPEG_TIMEOUT_MS
  + DOWNLOAD_TIMEOUT_MS
  + DEFAULT_FFMPEG_TIMEOUT_MS
  + FFPROBE_TIMEOUT_MS

/** The budget of one silence-detect job; `undefined` (readers keep their
 *  defaults) when the payload names no source. */
export function silenceDetectJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const { audioUrl } = data as { audioUrl?: unknown }
  return typeof audioUrl === "string" && audioUrl.length > 0 ? SILENCE_DETECT_BUDGET_MS : undefined
}
