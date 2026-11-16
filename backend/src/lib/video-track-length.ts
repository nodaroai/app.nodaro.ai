import { containerFallbackPricedSec, type MeasuredFileReading } from "@nodaro/render-rules"
import { readProbeSource, scanPacketEnds, type GuardedProbe, type VideoOverlayBaseProbe } from "../providers/video/ffmpeg-utils.js"

/**
 * A clip's PICTURE length, as the steps that charge by the video stream
 * (Topaz and Nodaro Video Upscale, Video Overlay, Combine Videos) measure it,
 * in this order:
 *  1. the video stream's own length (`stream=duration`);
 *  2. its `DURATION` tag — a Matroska / WebM file states no stream duration,
 *     only this tag (an ordinary WebM or MKV upload);
 *  3. the end of its last packet, from the streamed packet scan;
 *     (2 and 3 never past the container's length when it states one: when a
 *     tag or a last packet claims more, the container is the bound we trust —
 *     an upload is quoted at its recorded container length, so a reading past
 *     it would charge above the quote. The container is no promise of what
 *     ffmpeg decodes: a header can understate the file, as with any stated
 *     length);
 *  4. only when all three are unavailable, the CONTAINER's length — a reading
 *     its step prices less its fallback allowance (`containerFallbackPricedSec`,
 *     `CONTAINER_FALLBACK_GRACE_SEC`), since a made clip's sound can carry its
 *     file past its picture.
 */
export interface VideoTrackLength {
  readonly sec: number
  /** `video-stream` for steps 1–3, `container` for the fallback. */
  readonly reading: MeasuredFileReading
}


/** What a header read gave of the video stream and the file. */
export interface VideoTrackHeader {
  /** The video stream's own length (`stream=duration`). */
  readonly streamSec?: number
  /** The video stream's `DURATION` tag. */
  readonly tagSec?: number
  /** The video stream's index, for the packet scan. */
  readonly streamIndex?: number
  /** The file's start time (`format=start_time`), taken off a packet end. */
  readonly startTimeSec?: number
  /** The container's length (`format=duration`). */
  readonly containerSec?: number
}

/** The packet scan's bounds. */
export interface VideoTrackScanOptions {
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/**
 * The picture's length from a header already read, scanning the video
 * stream's packets (`scan`) only when neither the stream's length nor its tag
 * is there. A scan that finds nothing, fails or runs out of time leaves the
 * container's length (the fallback); one stopped by `signal` is thrown as it
 * is. `undefined` when even the container states none (the caller's own
 * refusal).
 */
export async function videoTrackLengthFrom(
  header: VideoTrackHeader,
  scan: (streamIndex: number) => Promise<{ maxPtsEnd?: number; maxDtsEnd?: number }>,
  signal?: AbortSignal,
): Promise<VideoTrackLength | undefined> {
  // A tag or a last packet that claims more than the container: the container is the bound we trust (an upload is
  // quoted at its recorded container length, so a reading past it would charge above the quote).
  const withinContainer = (sec: number): number => (header.containerSec !== undefined ? Math.min(sec, header.containerSec) : sec)
  if (header.streamSec !== undefined) return { sec: header.streamSec, reading: "video-stream" }
  if (header.tagSec !== undefined) return { sec: withinContainer(header.tagSec), reading: "video-stream" }
  if (header.streamIndex !== undefined) {
    try {
      const { maxPtsEnd, maxDtsEnd } = await scan(header.streamIndex)
      const end = maxPtsEnd ?? maxDtsEnd
      const length = end === undefined ? undefined : end - (header.startTimeSec ?? 0)
      if (length !== undefined && length > 0) return { sec: withinContainer(length), reading: "video-stream" }
    } catch (err) {
      if (signal?.aborted || (err as { aborted?: unknown } | null)?.aborted === true) throw err
    }
  }
  return header.containerSec !== undefined ? { sec: header.containerSec, reading: "container" } : undefined
}

/** The packet scan of one stream of `src` (a link or a local path), under the probe guard. */
export function guardedPacketScan(src: string, opts: VideoTrackScanOptions = {}): (streamIndex: number) => Promise<{ maxPtsEnd?: number; maxDtsEnd?: number }> {
  return (streamIndex) =>
    readProbeSource(
      src,
      (input, probe: GuardedProbe) =>
        scanPacketEnds(input, streamIndex, { probe, ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.signal ? { signal: opts.signal } : {}) }),
      opts.signal ? { signal: opts.signal } : {},
    )
}

/** A picture length as its step prices it: the stream's as read, the container fallback less its allowance. */
export function videoTrackPricedSec(length: VideoTrackLength): number {
  return containerFallbackPricedSec(length.sec, length.reading)
}

/** A probed video source (`probeVideoSource`) as the header the track reading takes. */
export function videoTrackHeaderOf(source: {
  readonly durationSeconds: number
  readonly videoDurationSeconds?: number
  readonly videoTagDurationSeconds?: number
  readonly videoStreamIndex?: number
  readonly startTimeSeconds?: number
}): VideoTrackHeader {
  return {
    ...(source.videoDurationSeconds !== undefined ? { streamSec: source.videoDurationSeconds } : {}),
    ...(source.videoTagDurationSeconds !== undefined ? { tagSec: source.videoTagDurationSeconds } : {}),
    ...(source.videoStreamIndex !== undefined ? { streamIndex: source.videoStreamIndex } : {}),
    ...(source.startTimeSeconds !== undefined ? { startTimeSec: source.startTimeSeconds } : {}),
    containerSec: source.durationSeconds,
  }
}

/**
 * The seconds a Video Overlay with a video layer is charged for, from its
 * base's probe (`probeVideoOverlayBase` / `probeVideoOverlayBaseSource`): the
 * picture's length (the stream's, its tag, its packets), else the container's
 * less the fallback's allowance. The one reading the price (`measureVideoOverlayBase`)
 * and the render's check that the run was priced for its base both take, so a
 * WebM / MKV whose sound runs past its picture is held to the units it was
 * charged. `src` is the base the probe read (its link, or the worker's copy).
 */
export async function videoOverlayChargedSec(probe: VideoOverlayBaseProbe, src: string, opts: VideoTrackScanOptions = {}): Promise<number> {
  const track = await videoTrackLengthFrom(
    {
      ...(probe.videoStreamSec !== undefined ? { streamSec: probe.videoStreamSec } : {}),
      ...(probe.videoTagSec !== undefined ? { tagSec: probe.videoTagSec } : {}),
      ...(probe.videoStreamIndex !== undefined ? { streamIndex: probe.videoStreamIndex } : {}),
      ...(probe.formatStartTimeSec !== undefined ? { startTimeSec: probe.formatStartTimeSec } : {}),
      ...(probe.containerSec !== undefined ? { containerSec: probe.containerSec } : {}),
    },
    guardedPacketScan(src, opts),
    opts.signal,
  )
  return track ? videoTrackPricedSec(track) : probe.streamDurationSec
}
