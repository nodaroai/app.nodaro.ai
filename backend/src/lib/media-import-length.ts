// @reads-none probes only a local file the caller downloaded; reads no repo file
import { getVideoDuration } from "../providers/video/ffmpeg-utils.js"

/**
 * Media imported into the video editor is limited by LENGTH, not by size
 * (decided 2026-11-17): at most 30 minutes. One number for both lanes that
 * carry a user's own long file into storage — a link to a direct video file
 * (`POST /v1/download-video`, `lib/video-download.ts`) and the browser's
 * large upload straight to storage (`routes/large-upload.ts`).
 *
 * Social-site links are NOT held to it: their downloads are bounded by the
 * section a client asks for, and another product fetches long videos with a
 * section picker.
 */
export const MEDIA_IMPORT_MAX_SEC = 30 * 60

/**
 * The most bytes one imported file may have on those two lanes: 10 GiB. A
 * product ceiling, not a disk-safety one: 30 minutes of 4K60 phone or camera
 * footage at its usual 50–200 Mbit/s is 11–45 GB only at the very top, and a
 * typical long recording is a few GB.
 */
export const MEDIA_IMPORT_MAX_BYTES = 10 * 1024 * 1024 * 1024

/**
 * The highest average bitrate believed of an imported file, by kind
 * (bits per second). A container can declare any duration; a large file that
 * claims to be short (to slip under {@link MEDIA_IMPORT_MAX_SEC}) has an
 * average bitrate no real recording reaches, and is refused for it.
 *
 * - **Video: 2,500 Mbit/s.** Generous: high-quality 4K60 phone or camera
 *   footage is 50–200 Mbit/s (H.264/HEVC), ProRes 422 HQ at 4K60 about
 *   1,770 Mbit/s, ProRes 4444 at 4K30 about 2,000 Mbit/s — all pass.
 * - **Audio: 50 Mbit/s.** Uncompressed 24-bit stereo at 192 kHz is about
 *   9.2 Mbit/s, 32-bit float 8 channels at 192 kHz about 49 Mbit/s.
 *
 * {@link BITRATE_SLACK_BYTES} of each file is not counted, so a very short clip
 * with a large header or embedded cover art is never refused for it.
 */
export const MEDIA_IMPORT_MAX_BITRATE_BPS: Readonly<Record<"video" | "audio", number>> = {
  video: 2_500_000_000,
  audio: 50_000_000,
}

/** Bytes of a file not counted toward its bitrate (headers, cover art, an index). */
export const BITRATE_SLACK_BYTES = 16 * 1024 * 1024

/** The refusal a person sees for a file over {@link MEDIA_IMPORT_MAX_SEC}. */
export const MEDIA_TOO_LONG_MESSAGE =
  "This video is longer than 30 minutes. Media imported into the editor can be at most 30 minutes long — trim it and try again."

/** The refusal for a file over {@link MEDIA_IMPORT_MAX_BYTES}. */
export const MEDIA_TOO_LARGE_MESSAGE =
  "This file is larger than 10 GB, the most a file imported into the editor can be. Export it smaller and try again."

/**
 * The refusal for a file whose length cannot be read. Refused rather than let
 * through: a file ffprobe cannot read a duration from will not play in the
 * editor either, and an unreadable length is exactly what a file over the
 * limit could otherwise hide behind.
 */
export const MEDIA_LENGTH_UNREADABLE_MESSAGE =
  "We couldn't read this file's length, so it can't be imported. Try exporting it again as MP4."

/** The refusal for a file whose size does not fit the length it declares. */
export const MEDIA_BITRATE_IMPLAUSIBLE_MESSAGE =
  "This file is far larger than its stated length allows, so it can't be imported. Try exporting it again as MP4."

export type MediaImportRefusalCode = "media_too_long" | "media_too_large" | "media_unreadable" | "media_bitrate_implausible"

/** An import refusal: `code` is the API code a route answers with. */
export class MediaImportLengthError extends Error {
  constructor(readonly code: MediaImportRefusalCode, message: string) {
    super(message)
    this.name = "MediaImportLengthError"
  }
}

/** Whether a measured duration is over the import limit. */
export function isOverImportLength(durationSec: number): boolean {
  return durationSec > MEDIA_IMPORT_MAX_SEC
}

/** Whether `sizeBytes` over `durationSec` is beyond what a real recording of `kind` reaches. */
export function isBitrateImplausible(sizeBytes: number, durationSec: number, kind: "video" | "audio"): boolean {
  const counted = Math.max(0, sizeBytes - BITRATE_SLACK_BYTES)
  return (counted * 8) / durationSec > MEDIA_IMPORT_MAX_BITRATE_BPS[kind]
}

/** The size ceiling alone: throws for a file over {@link MEDIA_IMPORT_MAX_BYTES}. */
export function assertWithinImportSize(sizeBytes: number): void {
  if (sizeBytes > MEDIA_IMPORT_MAX_BYTES) throw new MediaImportLengthError("media_too_large", MEDIA_TOO_LARGE_MESSAGE)
}

/**
 * Hold a file to the import rules: its size, its measured duration (seconds,
 * or undefined when it could not be read) and the bitrate the two imply.
 * Returns nothing when it fits, throws {@link MediaImportLengthError} otherwise.
 */
export function assertImportableMedia(input: {
  readonly durationSec: number | undefined
  readonly sizeBytes: number
  readonly kind: "video" | "audio"
}): void {
  assertWithinImportSize(input.sizeBytes)
  const { durationSec } = input
  if (durationSec === undefined || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new MediaImportLengthError("media_unreadable", MEDIA_LENGTH_UNREADABLE_MESSAGE)
  }
  if (isOverImportLength(durationSec)) throw new MediaImportLengthError("media_too_long", MEDIA_TOO_LONG_MESSAGE)
  if (isBitrateImplausible(input.sizeBytes, durationSec, input.kind)) {
    throw new MediaImportLengthError("media_bitrate_implausible", MEDIA_BITRATE_IMPLAUSIBLE_MESSAGE)
  }
}

/** Probe a LOCAL video file's container duration and hold it to the import rules. */
export async function assertLocalVideoImportable(path: string, sizeBytes: number): Promise<void> {
  let durationSec: number | undefined
  try {
    durationSec = await getVideoDuration(path)
  } catch {
    durationSec = undefined
  }
  assertImportableMedia({ durationSec, sizeBytes, kind: "video" })
}
