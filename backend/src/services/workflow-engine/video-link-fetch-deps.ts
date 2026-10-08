/**
 * The real downloader behind `fetchVideoLinksForRun` (decided 2026-10-08): the
 * very paths the rest of the platform uses, never a second one.
 *
 *  - the metadata probe is the route's (`ytMetadataProbe`; a failed probe is
 *    "unknown", which the card's rule treats as long);
 *  - the video is the `/v1/download-video` route's download (provider, upload,
 *    poster, ownership row), counted against the per-account cap on running
 *    downloads, which is ONE count across the API and orchestrator processes
 *    (`lib/video-download.ts`, `lib/download-slots.ts`; decided 2026-10-08);
 *  - the sound is the worker's `downloadAudioToR2` (what Suno Cover uses),
 *    under the same cap.
 */
import { ytMetadataProbe } from "../../providers/video/youtube-video.js"
import { downloadVideoForRun, withDownloadSlot } from "../../lib/video-download.js"
import { downloadAudioToR2 } from "../../workers/shared.js"
import type { VideoLinkFetchDeps } from "./video-link-fetch.js"

export const realVideoLinkFetchDeps: VideoLinkFetchDeps = {
  async probe(url) {
    try {
      return await ytMetadataProbe(url)
    } catch (err) {
      console.warn(`[video-link-fetch] probe failed for ${url}: ${err instanceof Error ? err.message : String(err)}`)
      return { durationSec: null, title: null, isLive: false }
    }
  },
  downloadVideo: ({ url, userId, maxHeight, section, signal }) =>
    downloadVideoForRun({ url, userId, maxHeight, section, signal }),
  downloadAudio: (url, { userId, signal }) => withDownloadSlot(userId, () => downloadAudioToR2(url), { signal }),
}
