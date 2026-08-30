import { probeMediaStreams } from "./ffmpeg-utils.js"

export type MediaSlot = "video" | "audio"

export interface ClassifiedMediaSource {
  readonly url: string
  /** The input slot the media arrived through — what the CALLER asked for. */
  readonly slot: MediaSlot
  /** What the media ACTUALLY carries (embedded cover art is not video). */
  readonly hasVideo: boolean
  readonly hasAudio: boolean
  /** false when the probe failed and the slot's word was assumed instead. */
  readonly probed: boolean
}

/**
 * THE MEDIA DECIDES THE MODE, NEVER THE INPUT SLOT.
 *
 * Incident 2026-08-30 (voice-changer-pro): an audio-only M4A uploaded as
 * `.mp4` (served `video/mp4`) was wired into a video input. Every slot-driven
 * layer believed the container; the paid speech-to-speech pass ran, then the
 * remux died at `-map 0:v` — three blind retries, no refund, no output. The
 * stream list is the only honest signal, so a node that has both an audio
 * path and a video path classifies its source HERE, before any paid call, and
 * routes on the result.
 *
 * FAIL OPEN: a probe failure (network blip, exotic container) must never be
 * the reason a valid job is refused — it falls back to the slot's word, i.e.
 * exactly the pre-incident behavior, and says so in the log. Demotion happens
 * only on a CONFIRMED `hasVideo === false`.
 */
export async function classifyMediaSource(url: string, slot: MediaSlot): Promise<ClassifiedMediaSource> {
  try {
    const { hasVideo, hasAudio } = await probeMediaStreams(url)
    return { url, slot, hasVideo, hasAudio, probed: true }
  } catch (err) {
    console.warn(
      `[media-source] stream probe failed for the ${slot} input — assuming the slot is honest: ${err instanceof Error ? err.message : String(err)}`,
    )
    return { url, slot, hasVideo: slot === "video", hasAudio: true, probed: false }
  }
}

/**
 * Video OUTPUT only when the caller asked for video (the video slot) AND the
 * media can deliver it. A video file in the AUDIO slot is a request for
 * audio; an audio-only file in the VIDEO slot is demoted to audio.
 */
export function isVideoMode(source: ClassifiedMediaSource): boolean {
  return source.slot === "video" && source.hasVideo
}
