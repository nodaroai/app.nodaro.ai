/**
 * Lip-sync models charged per second of their audio at a rate
 * (`LIP_SYNC_AUDIO_RATES` in `@nodaro/shared`, decided 2026-11-11 for
 * OmniHuman 2.0): the server measures the audio and the image itself, refuses
 * what the model cannot take, and prices the run from the measured length —
 * never from a length a client sent.
 *
 * One rule for every place such a run starts, before anything is held:
 *   - the route's preHandler (`POST /v1/lip-sync`, which MCP's `lip_sync`
 *     calls) → a 400 before the credit guard;
 *   - the workflow run (`stampLipSyncInputs`, node-executor) → a coded
 *     refusal before the jobs row's reservation.
 * Input validation, not a credit feature: it runs in every edition, so it
 * lives here, in core.
 *
 * The length is the DECODED length (decided 2026-11-12): the audio is always
 * downloaded — under the byte cap, at a minimum rate — and its first audio
 * track is decoded into the one PCM shape it is sent in, whose sample frames
 * are counted (`measureDecodedAudio`). What a file declares is never read: a
 * header can claim 31 seconds for a file that plays 290. Only the containers
 * the lane takes are read (`CALLER_AUDIO_FORMATS`), from the local copy only,
 * and a file the decoder cannot read to its end is refused, never priced on
 * the part before the point where reading stopped (`AudioReadStoppedError`).
 *
 * And a URL can answer a later fetch with a different file, so the provider
 * never sends the caller's URL on: it downloads the audio again by the same
 * rule, decodes THOSE bytes with the same decode (so the same file gives the
 * same samples, by construction), refuses a file that bills more than the run
 * was held for (the job fails and is refunded), always encodes that PCM to
 * MP3, measures the encode, and sends our own stored copy
 * (providers/kie/lip-sync-audio.ts — price and send the same bytes).
 *
 * Data-driven: a model without a rule here is never probed, so every other
 * lip-sync model's run is byte-identical.
 */
import { lipSyncAudioRateOf, lipSyncBilledSeconds, type LipSyncAudioRate } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { cleanupWorkDir, createWorkDir, downloadFile, type DownloadLimits } from "../providers/video/ffmpeg-utils.js"
import { isAudioReadStopped, measureDecodedAudio, type DecodedAudioLength } from "../providers/video/decoded-audio-length.js"
import { probeImageSource } from "./image-source-probe.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, lipSyncMeasureSlots } from "./lip-sync-download-slots.js"
import { safeUrlSchema } from "./url-validator.js"

/**
 * The most bytes an audio file given to a per-second-rate lip-sync model may
 * have AS GIVEN (decided 2026-11-11): the hard cap on the bytes read whenever
 * the file is downloaded — by the price check and by the provider. What is
 * SENT is held to the model's own `audio.maxBytes`, after conversion.
 */
export const LIP_SYNC_AUDIO_SOURCE_MAX_BYTES = 100_000_000

/**
 * The limits every download of such an audio file runs under (decided
 * 2026-11-12) — the price check's and the provider's: the URL is the caller's,
 * so a drip-fed or stalled transfer is stopped rather than holding a download
 * slot. 15 s for the response (and the grace before the rate applies), then at
 * least 256 KiB in every 10 s window; a known size gets its size at 256 KiB/s;
 * 2 minutes at most; and the source byte cap.
 */
export const LIP_SYNC_AUDIO_DOWNLOAD_LIMITS: DownloadLimits = Object.freeze({
  responseMs: 15_000,
  windowMs: 10_000,
  minBytesPerWindow: 256 * 1024,
  floorBytesPerSec: 256 * 1024,
  maxMs: 120_000,
  maxBytes: LIP_SYNC_AUDIO_SOURCE_MAX_BYTES,
})

/** What a per-second-rate lip-sync model accepts, beyond the length window its rate states. */
export interface LipSyncInputRule {
  readonly audio: {
    /**
     * The file SENT must be smaller than this — after conversion (decided
     * 2026-11-11). Every source is converted to MP3, ~7.2 MB at most at these lengths.
     */
    readonly maxBytes: number
    /** The file as given must be smaller than this (`LIP_SYNC_AUDIO_SOURCE_MAX_BYTES`): the cap on the bytes read. */
    readonly maxSourceBytes: number
  }
  readonly image: {
    /** The file must be smaller than this. */
    readonly maxBytes: number
    /** Each side, in pixels, inclusive. */
    readonly minSide: number
    readonly maxSide: number
    /** Width ÷ height, inclusive. */
    readonly minRatio: number
    readonly maxRatio: number
  }
}

/**
 * The limits of each per-second-rate lip-sync model, from its provider's
 * schema. OmniHuman 2.0 (KIE `omnihuman-2-0`, read 2026-11-11): one image
 * (jpeg, png, webp, bmp, tiff, gif, heic, heif; under 30 MB; width ÷ height
 * 0.4 to 2.5; each side 300 to 6,000 px) and one audio (wav or mp3; under
 * 15 MB; 4 to 300 seconds — the window is the rate's own). We take any audio
 * ffmpeg decodes, up to a larger source (`maxSourceBytes`), and send our MP3.
 */
export const LIP_SYNC_INPUT_RULES: Readonly<Record<string, LipSyncInputRule>> = {
  "omnihuman-2-0": {
    audio: { maxBytes: 15_000_000, maxSourceBytes: LIP_SYNC_AUDIO_SOURCE_MAX_BYTES },
    image: { maxBytes: 30_000_000, minSide: 300, maxSide: 6000, minRatio: 0.4, maxRatio: 2.5 },
  },
}

/** A per-second-rate lip-sync model's rate and input rule, or undefined for every other model. */
export function lipSyncRateModelOf(provider: unknown): { readonly rate: LipSyncAudioRate; readonly rule: LipSyncInputRule } | undefined {
  const rate = lipSyncAudioRateOf(provider)
  if (!rate || typeof provider !== "string") return undefined
  const rule = Object.prototype.hasOwnProperty.call(LIP_SYNC_INPUT_RULES, provider) ? LIP_SYNC_INPUT_RULES[provider] : undefined
  return rule ? { rate, rule } : undefined
}

/** `downloadFile`'s refusal of a body past its `maxBytes`. */
function isByteCapRefusal(err: unknown): boolean {
  return err instanceof Error && /^Download exceeds /.test(err.message)
}

/** `downloadFile`'s stop of a transfer past one of its limits (too slow, too long). */
export function isDownloadTimeout(err: unknown): boolean {
  return err instanceof Error && /^Download timeout: /.test(err.message)
}

/**
 * Download a per-second-rate model's audio to `dest` under its limits
 * (`LIP_SYNC_AUDIO_DOWNLOAD_LIMITS`, the source byte cap): `"too_large"` for a
 * file of the cap or more — counted on the stream, and checked again on disk,
 * since a fetch of our own bucket's file can fall back to a read the stream
 * cap does not cover. Any other failure (unreachable, too slow) rejects.
 */
export async function downloadLipSyncAudio(url: string, dest: string, rule: LipSyncInputRule): Promise<"ok" | "too_large"> {
  try {
    // `maxBytes` is the most a downloaded file may be: one byte under the cap.
    await downloadFile(url, dest, { limits: LIP_SYNC_AUDIO_DOWNLOAD_LIMITS, maxBytes: rule.audio.maxSourceBytes - 1 })
  } catch (err) {
    if (isByteCapRefusal(err)) return "too_large"
    throw err
  }
  const { size } = await stat(dest)
  return size >= rule.audio.maxSourceBytes ? "too_large" : "ok"
}

/** The measured inputs of a run, or why it is refused. */
export type LipSyncInputCheck =
  | {
      readonly ok: true
      /** The audio's decoded length, in seconds — what the run is billed on. */
      readonly audioSec: number
      /** The whole seconds the run is charged (`lipSyncBilledSeconds`). */
      readonly billedSeconds: number
    }
  | { readonly ok: false; readonly code: LipSyncRefusalCode; readonly message: string }

export type LipSyncRefusalCode =
  | "validation_error"
  | "lip_sync_image_required"
  | "image_unreadable"
  | "image_too_large"
  | "image_out_of_bounds"
  | "audio_unreadable"
  | "audio_too_long"
  | "audio_too_large"
  | "lip_sync_audio_busy"

const MB = 1_000_000
const mb = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`

type AudioReading =
  | { readonly kind: "measured"; readonly length: DecodedAudioLength }
  | { readonly kind: "busy" }
  | { readonly kind: "too_large" }
  /** `cut_short`: the decoder stopped part-way through the file (`AudioReadStoppedError`). */
  | { readonly kind: "unreadable"; readonly why: "download" | "slow" | "decode" | "cut_short" }

/**
 * The audio's decoded length: the file is downloaded under its limits
 * (`downloadLipSyncAudio`) and decoded into the PCM it would be sent as, whose
 * samples are counted (`measureDecodedAudio` — the worker's own decode,
 * stopped once past the rate's maximum). The download takes one of this
 * process's slots (`lipSyncMeasureSlots`: per user and in all); none free after
 * a short wait reads as `busy`. The slot is released on every way out.
 */
async function measureAudio(audioUrl: string, rate: LipSyncAudioRate, rule: LipSyncInputRule, userId: string | undefined): Promise<AudioReading> {
  if (!(await lipSyncMeasureSlots.acquire(userId, { waitMs: LIP_SYNC_MEASURE_SLOT_WAIT_MS }))) return { kind: "busy" }
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("lip-sync-measure")
    const path = join(workDir, "input")
    try {
      if ((await downloadLipSyncAudio(audioUrl, path, rule)) === "too_large") return { kind: "too_large" }
    } catch (err) {
      return { kind: "unreadable", why: isDownloadTimeout(err) ? "slow" : "download" }
    }
    let length: DecodedAudioLength | undefined
    try {
      length = await measureDecodedAudio(path, { capSec: rate.maxSeconds })
    } catch (err) {
      return { kind: "unreadable", why: isAudioReadStopped(err) ? "cut_short" : "decode" }
    }
    return length ? { kind: "measured", length } : { kind: "unreadable", why: "decode" }
  } catch {
    return { kind: "unreadable", why: "download" }
  } finally {
    if (workDir) await cleanupWorkDir(workDir).catch(() => {})
    lipSyncMeasureSlots.release(userId)
  }
}

/** The image half of the check. Undefined when the image is fine. */
async function imageRefusal(label: string, rule: LipSyncInputRule, imageUrl: string): Promise<Extract<LipSyncInputCheck, { ok: false }> | undefined> {
  const probe = await probeImageSource(imageUrl)
  const { image } = rule
  if (!probe.size || probe.sizeBytes === undefined) {
    return {
      ok: false,
      code: "image_unreadable",
      message: `${label} could not read the portrait image's ${probe.size ? "file size" : "dimensions"}. Use a JPEG, PNG or WebP image from a link that answers directly.`,
    }
  }
  if (probe.sizeBytes >= image.maxBytes) {
    return {
      ok: false,
      code: "image_too_large",
      message: `${label} takes an image under ${mb(image.maxBytes)}; this one is ${mb(probe.sizeBytes)}.`,
    }
  }
  const { width, height } = probe.size
  const ratio = width / height
  if (
    width < image.minSide || height < image.minSide || width > image.maxSide || height > image.maxSide ||
    ratio < image.minRatio || ratio > image.maxRatio
  ) {
    return {
      ok: false,
      code: "image_out_of_bounds",
      message:
        `${label} takes an image ${image.minSide} to ${image.maxSide} pixels on each side, with a width ÷ height ` +
        `between ${image.minRatio} and ${image.maxRatio}; this one is ${width}×${height}.`,
    }
  }
  return undefined
}

/**
 * The refusal of a file the decoder could not read to its end (decided
 * 2026-11-12) — the price check's and the worker's: it decodes clearly
 * shorter than the length it states, or reading stopped part-way. Priced, it
 * would be priced on, and sent as, only the part that decoded.
 */
export function audioReadStoppedMessage(label: string): string {
  return (
    `${label} could not read the audio to its end: part of the file does not decode ` +
    `(it may be damaged or incomplete, or joined from parts in different formats). ` +
    `Re-export the audio as one complete, continuous file.`
  )
}

/** Why an audio reading that measured nothing refuses the run. */
function audioRefusal(
  label: string,
  rule: LipSyncInputRule,
  audio: Exclude<AudioReading, { kind: "measured" }>,
): Extract<LipSyncInputCheck, { ok: false }> {
  switch (audio.kind) {
    case "busy":
      return {
        ok: false,
        code: "lip_sync_audio_busy",
        message: `${label}: too many audio files are being measured right now. Nothing is charged; try again in a moment.`,
      }
    case "too_large":
      return { ok: false, code: "audio_too_large", message: `${label} takes an audio file under ${mb(rule.audio.maxSourceBytes)}; this one is larger.` }
    case "unreadable":
      return {
        ok: false,
        code: "audio_unreadable",
        message:
          audio.why === "slow"
            ? `${label} could not download the audio: the link answered too slowly. Use a link that serves the file directly.`
            : audio.why === "download"
              ? `${label} could not download the audio. Use a link that answers directly.`
              : audio.why === "cut_short"
                ? audioReadStoppedMessage(label)
                : `${label} could not decode the audio. Use a common audio file (MP3, WAV, AIFF, M4A, AAC, Ogg, FLAC, WebM or WMA) with an audio track.`,
      }
  }
}

/**
 * Measure and check a run's audio and image against its model's limits. Only
 * for a per-second-rate model (`lipSyncRateModelOf`); undefined for every
 * other model, which is never probed. Never throws: a probe that fails is a
 * refusal ("could not be read"), because the run cannot be priced without it.
 * Both links must be http(s) and public (`safeUrlSchema`) before anything is
 * fetched.
 */
export async function checkLipSyncInputs(args: {
  readonly provider: unknown
  readonly audioUrl: unknown
  readonly imageUrl: unknown
  /** Whose run it is: the price check's download slots count per user. */
  readonly userId?: string
}): Promise<LipSyncInputCheck | undefined> {
  const model = lipSyncRateModelOf(args.provider)
  if (!model) return undefined
  const { rate, rule } = model
  const label = MODEL_CATALOG[String(args.provider)]?.label ?? String(args.provider)

  if (typeof args.imageUrl !== "string" || args.imageUrl.length === 0) {
    return { ok: false, code: "lip_sync_image_required", message: `${label} animates one portrait image: connect an image (imageUrl).` }
  }
  if (typeof args.audioUrl !== "string" || args.audioUrl.length === 0) {
    return { ok: false, code: "audio_unreadable", message: `${label} needs an audio track (audioUrl).` }
  }
  for (const [field, url] of [["imageUrl", args.imageUrl], ["audioUrl", args.audioUrl]] as const) {
    if (!safeUrlSchema.safeParse(url).success) {
      return { ok: false, code: "validation_error", message: `${label}: ${field} must be an http(s) link that does not point to localhost or a private network.` }
    }
  }
  const imageUrl = args.imageUrl
  const audioUrl = args.audioUrl

  const [image, audio] = await Promise.all([
    imageRefusal(label, rule, imageUrl),
    measureAudio(audioUrl, rate, rule, args.userId),
  ])
  if (image) return image
  if (audio.kind !== "measured") return audioRefusal(label, rule, audio)

  const { length } = audio
  if (length.overCap || length.seconds > rate.maxSeconds) {
    return {
      ok: false,
      code: "audio_too_long",
      message: length.overCap
        ? `${label} takes up to ${rate.maxSeconds} seconds of audio; this audio is longer. Trim it first.`
        : `${label} takes up to ${rate.maxSeconds} seconds of audio; this audio is ${Number(length.seconds.toFixed(2))} seconds. Trim it first.`,
    }
  }
  return { ok: true, audioSec: length.seconds, billedSeconds: lipSyncBilledSeconds(rate, length.seconds) }
}

/**
 * The BASE (pre-markup) credits a per-second-rate run of `billedSeconds` is
 * charged: the rate's row × the seconds, rounded up once
 * (`unitRateBaseCredits`, the composition its quote `<rate>:<N>u` reads too).
 */
export function lipSyncRateBaseCredits(rate: LipSyncAudioRate, billedSeconds: number): Promise<number> {
  return unitRateBaseCredits(rate.rateId, billedSeconds)
}

/**
 * The workflow run's twin of the route's preHandler: for a lip-sync job on a
 * per-second-rate model, measure the payload's audio and image, refuse what the
 * route refuses, and stamp the measured length (`audioDurationSec`, replacing
 * any length the node carried) and the seconds the run is charged
 * (`lipSyncBilledSeconds`). Run it BEFORE input_data is written: the worker
 * reads the row. A held-seconds value the payload already carried is dropped
 * for EVERY lip-sync job first — only this stamp may set it. Undefined for
 * every other job.
 */
export async function stampLipSyncInputs(
  jobName: string,
  payload: Record<string, unknown>,
  userId?: string,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "lip-sync") return undefined
  delete payload.lipSyncBilledSeconds
  if (!lipSyncRateModelOf(payload.provider)) return undefined
  const checked = await checkLipSyncInputs({ provider: payload.provider, audioUrl: payload.audioUrl, imageUrl: payload.imageUrl, userId })
  if (!checked) return undefined
  if (!checked.ok) return { code: checked.code, message: checked.message }
  payload.audioDurationSec = checked.audioSec
  payload.lipSyncBilledSeconds = checked.billedSeconds
  return undefined
}

/** The billed seconds a payload was stamped with, or undefined. */
export function stampedLipSyncBilledSeconds(payload: Record<string, unknown>): number | undefined {
  const s = payload.lipSyncBilledSeconds
  return typeof s === "number" && Number.isInteger(s) && s > 0 ? s : undefined
}
