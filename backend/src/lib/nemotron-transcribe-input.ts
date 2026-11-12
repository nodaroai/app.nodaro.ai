import { NEMOTRON_TRANSCRIBE_ID, NEMOTRON_TRANSCRIBE_PRICING, nemotronTranscribeCreditId, nemotronTranscribeQuoteCreditId } from "@nodaro/shared/credits"
import { assertSafeProbeSource, probeMediaDurationAndSize } from "../providers/video/ffmpeg-utils.js"
import { isAllowedSocialVideoUrl, safeUrlSchema } from "./url-validator.js"

/**
 * Nemotron 3.5 Transcribe: how long (and how large) the file is, and so which
 * per-minute id a run HOLDS (`nemotron-3-5-transcribe:<N>m`). The run is then
 * CHARGED for the minutes KIE reports it decoded (`lib/nemotron-transcribe-settle.ts`,
 * decided 2026-11-12): a header can misstate a file's length (a VBR MP3 without a
 * Xing header) and a host can serve ffprobe and KIE different files, so the
 * measurement sizes the hold and KIE's own length is what is paid.
 *
 * One rule for every place a run starts — the route's preHandler
 * (`POST /v1/transcribe`) and the workflow run (node-executor) — so the same
 * file is held the same wherever it runs, and refused the same way BEFORE
 * anything is held:
 *  - anything but an https link to a public host (`safeUrlSchema`, then https):
 *    raw workflow JSON reaches here without the route's Zod, and ffprobe's
 *    guard (`assertSafeProbeSource`) reads a string without a scheme as a LOCAL
 *    path, so a workflow could otherwise make the server probe its own files
 *    (Video Depth's rule, `lib/video-depth-input.ts`);
 *  - a link that SSRF guard blocks (`assertSafeProbeSource`, run on its own
 *    first: a public-looking host resolving to a private address, a link two
 *    URL parsers read differently, a host that does not resolve) — refused, not
 *    held: only a probe that fails on a link the guard passed holds 60 minutes;
 *  - a link to a video's PAGE on a social platform (its sound would only exist
 *    after the hold);
 *  - a file over KIE's 60 minutes, or over its 200 MB when the source says its
 *    size (a source that does not is left to KIE, whose refusal is refunded).
 * A file whose length cannot be read at all (a browser-recorded WebM written as
 * a stream, a fragmented MP4, a source ffprobe cannot open) is NOT refused: it
 * is held at the 60-minute price, the most a run can be charged, and settles at
 * KIE's length like any other.
 */
export type NemotronTranscribeInput =
  | {
      readonly ok: true
      /** The measured length; absent when the file's length could not be read (held at 60 minutes). */
      readonly durationSec?: number
      readonly sizeBytes?: number
      /** The id the run holds: the started minutes of the measured length, else the 60-minute id. */
      readonly creditId: string
    }
  | {
      readonly ok: false
      readonly code:
        | "invalid_media_url"
        | "media_duration_exceeds_limit"
        | "media_size_exceeds_limit"
        | "media_page_link_unsupported"
      readonly message: string
    }

/** An https link to a public host — the only kind of file this engine measures and sends. */
export function isNemotronMediaUrl(url: string): boolean {
  if (!safeUrlSchema.safeParse(url).success) return false
  try {
    return new URL(url).protocol === "https:"
  } catch {
    return false
  }
}

export async function measureNemotronTranscribeInput(
  mediaUrl: string,
  onProbeFailure: (err: unknown) => void = () => {},
): Promise<NemotronTranscribeInput> {
  if (!isNemotronMediaUrl(mediaUrl)) {
    return {
      ok: false,
      code: "invalid_media_url",
      message: "Nemotron 3.5 Transcribe takes an https link to an audio or video file on a public host.",
    }
  }
  if (isAllowedSocialVideoUrl(mediaUrl)) {
    return {
      ok: false,
      code: "media_page_link_unsupported",
      message:
        "Nemotron 3.5 Transcribe is priced by the file's length, measured before it runs, so it takes a link to an " +
        "audio or video file, not to a video's page. Bring the sound in first (a Video URL node), or pick another engine.",
    }
  }
  try {
    await assertSafeProbeSource(mediaUrl)
  } catch {
    return {
      ok: false,
      code: "invalid_media_url",
      message: "Nemotron 3.5 Transcribe takes an https link to an audio or video file on a public host.",
    }
  }
  let probed: { durationSec?: number; sizeBytes?: number }
  try {
    probed = await probeMediaDurationAndSize(mediaUrl)
  } catch (err) {
    onProbeFailure(err)
    probed = {}
  }
  if (probed.durationSec !== undefined && probed.durationSec > NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC) {
    return {
      ok: false,
      code: "media_duration_exceeds_limit",
      message:
        `The audio is ${Math.ceil(probed.durationSec)} seconds long. Nemotron 3.5 Transcribe accepts up to ` +
        `${NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC} seconds (60 minutes): split it and transcribe the parts.`,
    }
  }
  if (probed.sizeBytes !== undefined && probed.sizeBytes > NEMOTRON_TRANSCRIBE_PRICING.MAX_BYTES) {
    return {
      ok: false,
      code: "media_size_exceeds_limit",
      message:
        `The file is ${Math.ceil(probed.sizeBytes / (1024 * 1024))} MB. Nemotron 3.5 Transcribe accepts files up to 200 MB.`,
    }
  }
  return {
    ok: true,
    ...(probed.durationSec !== undefined ? { durationSec: probed.durationSec } : {}),
    ...(probed.sizeBytes !== undefined ? { sizeBytes: probed.sizeBytes } : {}),
    // An unread length holds the 60-minute id: the most any run can be charged.
    creditId:
      probed.durationSec !== undefined ? nemotronTranscribeCreditId(probed.durationSec) : nemotronTranscribeQuoteCreditId(undefined),
  }
}

/** Whether a transcribe payload runs on Nemotron 3.5 Transcribe (the one length-priced engine). */
export function isNemotronTranscribe(jobName: string, payload: Record<string, unknown>): boolean {
  return jobName === "transcribe" && payload.provider === NEMOTRON_TRANSCRIBE_ID
}

/**
 * The workflow run's twin of the route's preHandler: measures a Nemotron
 * transcribe payload's file and stamps `bucketKey` (the id the run holds, see
 * `nemotronTranscribeReserveId`) and, when the length was read,
 * `duration_seconds`. The caller must run it BEFORE writing input_data. Returns
 * the route's refusal for a file it would refuse; undefined otherwise, and for
 * any other job (or engine), whose payload is left untouched.
 */
export async function stampNemotronTranscribeInput(
  jobName: string,
  payload: Record<string, unknown>,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (!isNemotronTranscribe(jobName, payload)) return undefined
  const audioUrl = typeof payload.audioUrl === "string" ? payload.audioUrl : ""
  const measured = await measureNemotronTranscribeInput(audioUrl, (err) => {
    console.warn("[node-executor] transcribe (nemotron): ffprobe could not read the length; holding 60 minutes:", err)
  })
  if (!measured.ok) return { code: measured.code, message: measured.message }
  if (measured.durationSec !== undefined) payload.duration_seconds = measured.durationSec
  payload.bucketKey = measured.creditId
  return undefined
}

/** The id a stamped Nemotron transcribe payload reserves; undefined for any other job or engine. */
export function nemotronTranscribeReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  return isNemotronTranscribe(jobName, payload) && typeof payload.bucketKey === "string" ? payload.bucketKey : undefined
}
