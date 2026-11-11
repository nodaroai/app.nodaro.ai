// backend/src/providers/video/video-overlay-video-layers.ts
/**
 * Video Overlay — the VIDEO side of the worker: fetching and probing a video
 * layer, and the render's memory reservation. Where the video layers and the
 * base draw (a stack, a base box) is `placeVideoOverlayVideos` in
 * @nodaro/shared, the one placement the canvas preview draws with too. The
 * image side is `video-overlay-images.ts`; `video-overlay.ts` runs both. A
 * video layer is never pre-fitted: its fit is in the ffmpeg graph, at the
 * placed rect.
 *
 * Every refusal is a DeterministicJobError (a pure function of the inputs: one
 * attempt, a refund), labelled like an image layer's and carrying no URL,
 * HTTP status or vendor text. Every probed aspect goes through
 * `clampVideoOverlayAspect` (the placement clamps again, idempotently, and
 * rounds every video rect through `evenVideoOverlayRect`). An image layer's
 * geometry is not touched here.
 */
import {
  VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES,
  clampVideoOverlayAspect,
  videoOverlayLayerLabel,
  type VideoOverlayCanvas,
} from "@nodaro/shared/video"
import { DeterministicJobError, isDeterministicJobError } from "../../lib/deterministic-job-error.js"
import { downloadFile, probeVideoOverlayBase, type VideoOverlayBaseProbe } from "./ffmpeg-utils.js"
import { cameraMegapixelsOf, canvasPeakMemoryMiB } from "./ffmpeg-memory-model.js"
import { ffmpegEffectiveThreads } from "./ffmpeg-threads.js"
import type { VideoOverlayLayerRef } from "./video-overlay-images.js"

const MB = 1024 * 1024

/** A video's DISPLAY aspect (rotation and sample aspect already resolved by the probe), clamped to `VIDEO_OVERLAY_ASPECT_BOUNDS`. */
export function videoOverlayDisplayAspect(probe: Pick<VideoOverlayBaseProbe, "width" | "height" | "sar">): number {
  return clampVideoOverlayAspect((probe.width * probe.sar) / probe.height)
}

/**
 * A video layer's picture/sound offset in its file (its sound's start minus its
 * picture's start, from the probe), for the graph to keep: the two share the
 * file's earlier start as one origin. Nothing when the file has no sound or
 * does not state when its sound starts.
 */
export function videoOverlayAudioOffset(
  probe: Pick<VideoOverlayBaseProbe, "audioCodec" | "audioStartTimeSec" | "startTimeSec">,
): { readonly audioOffsetSec?: number } {
  if (probe.audioCodec === null || probe.audioStartTimeSec === undefined) return {}
  const offset = probe.audioStartTimeSec - probe.startTimeSec
  return Number.isFinite(offset) && offset !== 0 ? { audioOffsetSec: offset } : {}
}

/**
 * Download one layer video under `VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES` and
 * probe it. Over the cap → "video is too large"; any other download failure
 * (a 4xx / 5xx, a safeFetch refusal, DNS, a timeout) → "could not be fetched",
 * as for an image layer. A file with no usable video stream — an image (no
 * duration), audio, HTML, a broken file — → "not a video". A probe that timed
 * out is not the file's fault: rethrown as is, so BullMQ retries. The original
 * error goes to the log only.
 */
export async function fetchVideoOverlayVideoLayer(
  url: string,
  dest: string,
  ref: VideoOverlayLayerRef,
): Promise<{ probe: VideoOverlayBaseProbe; aspect: number }> {
  const label = videoOverlayLayerLabel(ref)
  try {
    await downloadFile(url, dest, { maxBytes: VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    console.warn(`[video-overlay] ${label} video fetch failed: ${raw}`)
    if (raw.startsWith("Download exceeds")) {
      throw new DeterministicJobError(`${label}: video is too large (over ${VIDEO_OVERLAY_MAX_LAYER_VIDEO_BYTES / MB} MB)`, { cause: err })
    }
    throw new DeterministicJobError(`${label}: video could not be fetched`, { cause: err })
  }
  let probe: VideoOverlayBaseProbe
  try {
    probe = await probeVideoOverlayBase(dest)
  } catch (err) {
    if (!isDeterministicJobError(err)) throw err
    throw new DeterministicJobError(`${label}: not a video`, { cause: err })
  }
  return { probe, aspect: videoOverlayDisplayAspect(probe) }
}

/**
 * The render's predicted peak (`ffmpeg-memory-model.ts`) for a run that
 * decodes more than the base: the canvas model at the output canvas, one
 * picture per decoded video plus the placed base's canvas copy, and the video
 * FILES as its inputs, scaled by the largest one's picture size. The image
 * layers are left out, as the default estimate leaves them out of an
 * image-only run: each is a pre-fitted still at its drawn size, not a decoded
 * video. An image-only run reserves nothing here — it keeps the default.
 */
export function videoOverlayPeakMemoryMiB(
  canvas: VideoOverlayCanvas,
  videos: ReadonlyArray<{ readonly width: number; readonly height: number }>,
  placedBase: boolean,
): number {
  const largest = Math.max(...videos.map(cameraMegapixelsOf))
  return canvasPeakMemoryMiB({ width: canvas.w, height: canvas.h }, videos.length + (placedBase ? 1 : 0), ffmpegEffectiveThreads(), {
    inputs: videos.length,
    cameraMegapixels: largest,
  })
}
