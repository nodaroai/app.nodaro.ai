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
 *
 * Both run under the import gate with the rights the fetch was handed
 * (`VideoLinkFetchRights`: the node's confirmation and the fetch's request id):
 * the gate reads BEFORE the slot wait, as every lane does, so a refused import
 * never holds a slot; the engine reads again and spends the confirmation once
 * the slot is held.
 */
import { ytMetadataProbe } from "../../providers/video/youtube-video.js"
import { downloadVideoForRun, withDownloadSlot } from "../../lib/video-download.js"
import { downloadAudioToR2 } from "../../workers/download-audio.js"
import { requireImportAllowed, type ImportRights } from "../../lib/import-gate.js"
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
  downloadVideo: ({ url, userId, maxHeight, section, signal, confirmationId, requestId }) =>
    downloadVideoForRun({ url, userId, maxHeight, section, signal, rightsConfirmationId: confirmationId ?? null, requestId: requestId ?? null }),
  downloadAudio: async (url, { userId, signal, confirmationId, requestId }) => {
    const rights: ImportRights = { userId, confirmationId: confirmationId ?? null, lane: "run", requestId: requestId ?? null }
    await requireImportAllowed(url, rights)
    return withDownloadSlot(userId, () => downloadAudioToR2(url, rights), { signal })
  },
}
