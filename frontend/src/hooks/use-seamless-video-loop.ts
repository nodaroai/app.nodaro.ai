"use client"

import { useEffect } from "react"

/**
 * Manual loop driver using requestVideoFrameCallback (rVFC) — works around
 * the well-known native `<video loop>` gap where browsers briefly pause at
 * EOS before seeking back to 0. The pause is short (a few frames) but
 * visible on tightly-cut loops where the seam is meant to be invisible.
 *
 * Strategy:
 *   - Disable the element's native `loop` attribute (caller passes
 *     `loop={false}`); we drive looping manually here.
 *   - On every video frame, check if we're within `seekAheadFrames` of
 *     duration. If so, set `currentTime = 0` and call `play()` again.
 *     The seek is fast enough that no frame is dropped at the seam.
 *
 * Falls back gracefully on browsers without rVFC (Firefox <130). In that
 * case we use the `timeupdate` event which fires every ~250ms — slightly
 * less precise but still better than the native loop pause for most clips.
 *
 * Audio note: codec priming (the few ms of silence aac inserts at the
 * start of every track) shows up as an audible click on every loop. The
 * caller should pass `muted` for visual-only previews; if audio matters,
 * generate the source with `-c:a copy` from a gapless container or with
 * Opus instead of aac.
 */
export function useSeamlessVideoLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  options?: {
    /** How many frames before EOS to perform the seek-back. Default 2 —
     *  enough headroom for the seek to complete without overshoot. */
    seekAheadFrames?: number
    /** Assumed fps for the seek-ahead calculation. Defaults to 30 if
     *  the element doesn't report frame timing. Pass the source fps
     *  when you know it (e.g. 24 for VEO outputs). */
    fps?: number
  },
): void {
  const seekAhead = options?.seekAheadFrames ?? 2
  const assumedFps = options?.fps ?? 30

  useEffect(() => {
    const video = videoRef.current
    if (!video || !enabled) return

    let cancelled = false
    let rafHandle: number | undefined

    // rVFC path: precise per-frame check with mediaTime from the decoder.
    type RvfcCallback = (now: number, metadata: { mediaTime: number; expectedDisplayTime: number }) => void
    type RvfcVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: RvfcCallback) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    const rvfcVideo = video as RvfcVideo
    const supportsRvfc = typeof rvfcVideo.requestVideoFrameCallback === "function"

    const seekBack = () => {
      // Setting currentTime fires `seeked` once the decoder is ready;
      // calling play() unconditionally is safe (no-op if already playing).
      try {
        video.currentTime = 0
        const p = video.play()
        if (p && typeof p.catch === "function") p.catch(() => {})
      } catch {
        /* element disposed during seek — bail */
      }
    }

    if (supportsRvfc && rvfcVideo.requestVideoFrameCallback) {
      const onFrame: RvfcCallback = (_now, metadata) => {
        if (cancelled) return
        const duration = video.duration
        // Skip until duration is known (Infinity for live streams).
        if (Number.isFinite(duration) && duration > 0) {
          const fps = inferFpsFromMetadata(video) ?? assumedFps
          const seekAheadSec = seekAhead / fps
          if (metadata.mediaTime >= duration - seekAheadSec) {
            seekBack()
          }
        }
        rafHandle = rvfcVideo.requestVideoFrameCallback?.(onFrame)
      }
      rafHandle = rvfcVideo.requestVideoFrameCallback(onFrame)
      return () => {
        cancelled = true
        if (rafHandle !== undefined) rvfcVideo.cancelVideoFrameCallback?.(rafHandle)
      }
    }

    // Fallback: poll timeupdate. Less precise (~250ms granularity) but
    // still avoids the native EOS pause in most cases.
    const onTimeUpdate = () => {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0) return
      const fps = inferFpsFromMetadata(video) ?? assumedFps
      const seekAheadSec = seekAhead / fps
      if (video.currentTime >= duration - seekAheadSec) {
        seekBack()
      }
    }
    // `ended` is the absolute backstop — if we missed the seek window
    // (slow timeupdate, paused tab), restart from 0 immediately on EOS.
    const onEnded = () => seekBack()

    video.addEventListener("timeupdate", onTimeUpdate)
    video.addEventListener("ended", onEnded)
    return () => {
      cancelled = true
      video.removeEventListener("timeupdate", onTimeUpdate)
      video.removeEventListener("ended", onEnded)
    }
  }, [videoRef, enabled, seekAhead, assumedFps])
}

/** Try to read `videoFrameRate` (some browsers expose it on the element).
 *  Returns undefined when the value isn't available; caller falls back to
 *  the supplied `assumedFps`. */
function inferFpsFromMetadata(video: HTMLVideoElement): number | undefined {
  // Safari exposes webkitDecodedFrameCount but no fps directly. Chrome's
  // experimental MediaCapabilities API isn't reliable on regular video
  // elements either. Without a stable cross-browser source we accept
  // the caller's assumed fps.
  void video
  return undefined
}
