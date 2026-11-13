/**
 * Lip-sync models priced by the length of their audio: the server measures the
 * audio itself, refuses what the model cannot take, and prices the run from
 * the measured length — never from a length a client sent. Two kinds
 * (`lipSyncAudioPricingOf`):
 *   - charged per second at a rate (`LIP_SYNC_AUDIO_RATES` in `@nodaro/shared`,
 *     decided 2026-11-11 for OmniHuman 2.0): the image is checked too, and
 *     audio past the model's maximum is refused;
 *   - priced by a length BUCKET (`<provider>:<bucket>s`, `buildLipSyncCreditId`:
 *     Kling AI Avatar, OmniHuman 1.5, the dubbing models — decided 2026-11-13,
 *     after they priced a length the caller sent): audio only, and audio past
 *     the model's maximum is priced at it and trimmed to it, as before.
 * Either way the run is held for `lipSyncBilledSeconds` (the bucket's seconds
 * for a bucketed model), and the charge is the hold.
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
 * And a URL can answer a later fetch with a different file, so the model is
 * never sent the caller's URL: the worker downloads the audio again by the
 * same rule, decodes THOSE bytes with the same decode (so the same file gives
 * the same samples, by construction), refuses a file that bills more than the
 * run was held for (the job fails and is refunded), always encodes that PCM to
 * MP3, measures the encode, and sends our own stored copy
 * (providers/kie/lip-sync-audio.ts — price and send the same bytes; for a
 * bucketed model on every lane, KIE, Replicate and fal alike).
 *
 * Data-driven: a model whose price does not follow its audio's length (a flat
 * or resolution-tiered model, the fixed 8-second Seedance / MiniMax tiers) is
 * never probed, so its run is byte-identical.
 */
import {
  buildLipSyncCreditId,
  getLipSyncMaxAudioSeconds,
  isPerSecondLipSyncProvider,
  LIP_SYNC_DURATION_BUCKETS,
  lipSyncAudioRateOf,
  lipSyncBilledSeconds,
  pickLipSyncBucket,
  type LipSyncAudioRate,
} from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { cleanupWorkDir, createWorkDir, downloadFile, type DownloadLimits } from "../providers/video/ffmpeg-utils.js"
import { isAudioReadStopped, isStoppedLaunch, measureDecodedAudio, type DecodedAudioLength } from "../providers/video/decoded-audio-length.js"
import { probeImageSource } from "./image-source-probe.js"
import { unitRateBaseCredits } from "./credit-base-cost.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS, lipSyncMeasureSlots } from "./lip-sync-download-slots.js"
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

/** The bytes an audio file may have as given: the cap on what is read. */
export interface LipSyncAudioSourceRule {
  readonly audio: { readonly maxSourceBytes: number }
}

/**
 * What a bucketed lip-sync model's audio is read under: the same source byte
 * cap as a per-second-rate model's. It has no cap on what is sent beyond its
 * length — our MP3 of at most its maximum (≈7.2 MB at 300 s).
 */
export const LIP_SYNC_BUCKET_AUDIO_RULE: LipSyncAudioSourceRule = { audio: { maxSourceBytes: LIP_SYNC_AUDIO_SOURCE_MAX_BYTES } }

/**
 * How a lip-sync model's price follows the length of its audio, or undefined
 * for a model priced another way (never probed). `rate`: a per-second-rate
 * model (OmniHuman 2.0). `bucket`: a model priced by a length bucket
 * (`isPerSecondLipSyncProvider` — Kling AI Avatar (Pro), OmniHuman 1.5,
 * HeyGen Lipsync Precision, Sync Lipsync 2 Pro, Sync Lipsync v3, Volcengine),
 * whose audio past `maxSeconds` is priced at it and trimmed to it.
 */
export type LipSyncAudioPricing =
  | { readonly kind: "rate"; readonly rate: LipSyncAudioRate; readonly rule: LipSyncInputRule }
  | { readonly kind: "bucket"; readonly provider: string; readonly maxSeconds: number; readonly rule: LipSyncAudioSourceRule }

export function lipSyncAudioPricingOf(provider: unknown): LipSyncAudioPricing | undefined {
  if (typeof provider !== "string") return undefined
  const rateModel = lipSyncRateModelOf(provider)
  if (rateModel) return { kind: "rate", ...rateModel }
  if (isPerSecondLipSyncProvider(provider)) {
    return { kind: "bucket", provider, maxSeconds: getLipSyncMaxAudioSeconds(provider), rule: LIP_SYNC_BUCKET_AUDIO_RULE }
  }
  return undefined
}

/** The longest audio a model's price check decodes: past it the audio is too long (a rate model) or priced at it (a bucketed one). */
export function lipSyncAudioCapSec(pricing: LipSyncAudioPricing): number {
  return pricing.kind === "rate" ? pricing.rate.maxSeconds : pricing.maxSeconds
}

/**
 * How far past a bucket's length a bucketed model's measured audio may run and
 * still be held in that bucket (decided 2026-11-13). Decoders disagree by a few
 * hundredths of a second at the end of a file: the production-pinned ffmpeg
 * decodes an exactly 15.000 s AAC/M4A file as 15.019 s (it keeps part of the
 * encoder's priming frame). Without this, such a file would be charged the
 * NEXT bucket. The copy sent is cut to exactly the bucket's length
 * (providers/kie/lip-sync-audio.ts), so what is sent is still what was priced.
 */
export const LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC = 0.05

/**
 * The bucket audio of `sec` seconds is held in: the bucket it falls in
 * (`pickLipSyncBucket`), or the bucket below when it runs at most
 * {@link LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC} past that bucket's length.
 */
function bucketWithEdgeTolerance(sec: number): number {
  const bucket = pickLipSyncBucket(sec)
  const below = LIP_SYNC_DURATION_BUCKETS.filter((b) => b < bucket).at(-1)
  // A hair of slack for the float the sample count divides into (15.05 s is 15 + 0.0500000000000007).
  return below !== undefined && sec - below <= LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC + 1e-9 ? below : bucket
}

/**
 * The seconds a run is held and charged for, from its audio's decoded length —
 * THE one rule the price check (route, workflow run) and the worker read.
 * A rate model: the whole seconds (`lipSyncBilledSeconds`); undefined past its
 * maximum (refused). A bucketed model: the bucket the length falls in (the
 * length at most the maximum; within {@link LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC}
 * past a bucket's length, that bucket), audio past the maximum priced at it.
 */
export function lipSyncHeldSecondsOf(pricing: LipSyncAudioPricing, length: DecodedAudioLength): number | undefined {
  if (pricing.kind === "rate") {
    if (length.overCap || length.seconds > pricing.rate.maxSeconds) return undefined
    return lipSyncBilledSeconds(pricing.rate, length.seconds)
  }
  if (length.overCap) return pickLipSyncBucket(pricing.maxSeconds)
  return bucketWithEdgeTolerance(Math.min(length.seconds, pricing.maxSeconds))
}

/**
 * The price row a run held for `heldSeconds` reserves: a rate model's
 * one-second row (the seconds multiply it), a bucketed model's bucket row
 * (`<provider>:<bucket>s`).
 */
export function lipSyncHeldCreditId(pricing: LipSyncAudioPricing, heldSeconds: number): string {
  return pricing.kind === "rate" ? pricing.rate.rateId : buildLipSyncCreditId(pricing.provider, heldSeconds)
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
 * Download a measured lip-sync model's audio to `dest` under its limits
 * (`LIP_SYNC_AUDIO_DOWNLOAD_LIMITS`, the source byte cap): `"too_large"` for a
 * file of the cap or more — counted on the stream, and checked again on disk,
 * since a fetch of our own bucket's file can fall back to a read the stream
 * cap does not cover. Any other failure (unreachable, too slow) rejects.
 */
export async function downloadLipSyncAudio(url: string, dest: string, rule: LipSyncAudioSourceRule): Promise<"ok" | "too_large"> {
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
      /** The audio's decoded length, in seconds — what the run is billed on (a bucketed model's: at most its maximum). */
      readonly audioSec: number
      /** The whole seconds the run is held and charged for (`lipSyncHeldSecondsOf`: a bucketed model's bucket). */
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
  /** The measurement itself was stopped (its time limit): the server's failure, not the file's — retry. */
  | "lip_sync_audio_measure_stopped"

const MB = 1_000_000
const mb = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`

type AudioReading =
  | { readonly kind: "measured"; readonly length: DecodedAudioLength }
  | { readonly kind: "busy" }
  /** The decode (or its probe of the file's stated length) was stopped by its own time limit: not the file's fault. */
  | { readonly kind: "stopped" }
  | { readonly kind: "too_large" }
  /** `cut_short`: the decoder stopped part-way through the file (`AudioReadStoppedError`). */
  | { readonly kind: "unreadable"; readonly why: "download" | "slow" | "decode" | "cut_short" }

/**
 * The audio's decoded length: the file is downloaded under its limits
 * (`downloadLipSyncAudio`) and decoded into the PCM it would be sent as, whose
 * samples are counted (`measureDecodedAudio` — the worker's own decode,
 * stopped once past `capSec`, the model's maximum). The download takes one of
 * this process's slots (`lipSyncMeasureSlots`: per user and in all); none free
 * after `slotWaitMs` reads as `busy`. The slot is released on every way out.
 */
async function measureAudio(audioUrl: string, capSec: number, rule: LipSyncAudioSourceRule, userId: string | undefined, slotWaitMs: number): Promise<AudioReading> {
  if (!(await lipSyncMeasureSlots.acquire(userId, { waitMs: slotWaitMs }))) return { kind: "busy" }
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
      length = await measureDecodedAudio(path, { capSec })
    } catch (err) {
      if (isStoppedLaunch(err)) return { kind: "stopped" }
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
  rule: LipSyncAudioSourceRule,
  audio: Exclude<AudioReading, { kind: "measured" }>,
): Extract<LipSyncInputCheck, { ok: false }> {
  switch (audio.kind) {
    case "busy":
      return {
        ok: false,
        code: "lip_sync_audio_busy",
        message: `${label}: too many audio files are being measured right now. Nothing is charged; try again in a moment.`,
      }
    case "stopped":
      return {
        ok: false,
        code: "lip_sync_audio_measure_stopped",
        message: `${label}: measuring the audio took too long on our side and was stopped. Nothing is charged; try again in a moment.`,
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

/** The name a refusal gives the model: its catalog label. */
export function lipSyncModelLabel(provider: string): string {
  return MODEL_CATALOG[provider]?.label ?? provider
}

/** A link the price check may fetch: http(s) and public (`safeUrlSchema`). Undefined when it may. */
function unsafeLinkRefusal(label: string, field: string, url: string): Extract<LipSyncInputCheck, { ok: false }> | undefined {
  return safeUrlSchema.safeParse(url).success
    ? undefined
    : { ok: false, code: "validation_error", message: `${label}: ${field} must be an http(s) link that does not point to localhost or a private network.` }
}

/**
 * Measure and check a run's audio — and, for a per-second-rate model, its
 * image — against its model's limits. Only for a model priced by the length of
 * its audio (`lipSyncAudioPricingOf`); undefined for every other model, which
 * is never probed. Never throws: a probe that fails is a refusal ("could not
 * be read"), because the run cannot be priced without it. Every link it
 * fetches must be http(s) and public (`safeUrlSchema`) before anything is
 * fetched.
 */
export async function checkLipSyncInputs(args: {
  readonly provider: unknown
  readonly audioUrl: unknown
  readonly imageUrl: unknown
  /** Whose run it is: the price check's download slots count per user. */
  readonly userId?: string
  /** How long to wait for a measuring slot: a request's {@link LIP_SYNC_MEASURE_SLOT_WAIT_MS} by default. */
  readonly slotWaitMs?: number
}): Promise<LipSyncInputCheck | undefined> {
  const pricing = lipSyncAudioPricingOf(args.provider)
  if (!pricing) return undefined
  const label = lipSyncModelLabel(String(args.provider))
  return pricing.kind === "rate" ? checkRateModelInputs(pricing, label, args) : checkBucketModelAudio(pricing, label, args)
}

/** A per-second-rate model (OmniHuman 2.0): its image and its audio, refused past its maximum. */
async function checkRateModelInputs(
  pricing: Extract<LipSyncAudioPricing, { kind: "rate" }>,
  label: string,
  args: { readonly audioUrl: unknown; readonly imageUrl: unknown; readonly userId?: string; readonly slotWaitMs?: number },
): Promise<LipSyncInputCheck> {
  const { rate, rule } = pricing

  if (typeof args.imageUrl !== "string" || args.imageUrl.length === 0) {
    return { ok: false, code: "lip_sync_image_required", message: `${label} animates one portrait image: connect an image (imageUrl).` }
  }
  if (typeof args.audioUrl !== "string" || args.audioUrl.length === 0) {
    return { ok: false, code: "audio_unreadable", message: `${label} needs an audio track (audioUrl).` }
  }
  for (const [field, url] of [["imageUrl", args.imageUrl], ["audioUrl", args.audioUrl]] as const) {
    const unsafe = unsafeLinkRefusal(label, field, url)
    if (unsafe) return unsafe
  }
  const imageUrl = args.imageUrl
  const audioUrl = args.audioUrl

  const [image, audio] = await Promise.all([
    imageRefusal(label, rule, imageUrl),
    measureAudio(audioUrl, rate.maxSeconds, rule, args.userId, args.slotWaitMs ?? LIP_SYNC_MEASURE_SLOT_WAIT_MS),
  ])
  if (image) return image
  if (audio.kind !== "measured") return audioRefusal(label, rule, audio)

  const { length } = audio
  const billedSeconds = lipSyncHeldSecondsOf(pricing, length)
  if (length.overCap || billedSeconds === undefined) {
    return {
      ok: false,
      code: "audio_too_long",
      message: length.overCap
        ? `${label} takes up to ${rate.maxSeconds} seconds of audio; this audio is longer. Trim it first.`
        : `${label} takes up to ${rate.maxSeconds} seconds of audio; this audio is ${Number(length.seconds.toFixed(2))} seconds. Trim it first.`,
    }
  }
  return { ok: true, audioSec: length.seconds, billedSeconds }
}

/**
 * A bucketed model (Kling AI Avatar, OmniHuman 1.5, the dubbing models): its
 * audio only — its face input, an image or a video, is the provider's to
 * check, as before. Audio past its maximum is not refused: it is priced at the
 * maximum's bucket and trimmed to it (`audioSec` is then the maximum).
 */
async function checkBucketModelAudio(
  pricing: Extract<LipSyncAudioPricing, { kind: "bucket" }>,
  label: string,
  args: { readonly audioUrl: unknown; readonly userId?: string; readonly slotWaitMs?: number },
): Promise<LipSyncInputCheck> {
  if (typeof args.audioUrl !== "string" || args.audioUrl.length === 0) {
    return { ok: false, code: "audio_unreadable", message: `${label} needs an audio track (audioUrl).` }
  }
  const unsafe = unsafeLinkRefusal(label, "audioUrl", args.audioUrl)
  if (unsafe) return unsafe

  const audio = await measureAudio(args.audioUrl, pricing.maxSeconds, pricing.rule, args.userId, args.slotWaitMs ?? LIP_SYNC_MEASURE_SLOT_WAIT_MS)
  if (audio.kind !== "measured") return audioRefusal(label, pricing.rule, audio)
  const { length } = audio
  return {
    ok: true,
    audioSec: length.overCap ? pricing.maxSeconds : Math.min(length.seconds, pricing.maxSeconds),
    billedSeconds: lipSyncHeldSecondsOf(pricing, length)!,
  }
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
 * model priced by its audio's length, measure the payload's audio (and a
 * per-second-rate model's image), refuse what the route refuses, and stamp the
 * measured length (`audioDurationSec`, replacing any length the node carried —
 * a browser's reading, maybe of an older clip) and the seconds the run is held
 * and charged for (`lipSyncBilledSeconds`). Run it BEFORE input_data is
 * written: the worker reads the row. A held-seconds value the payload already
 * carried is dropped for EVERY lip-sync job first — only this stamp may set
 * it. Undefined for every other job.
 */
export async function stampLipSyncInputs(
  jobName: string,
  payload: Record<string, unknown>,
  userId?: string,
): Promise<{ readonly code: string; readonly message: string } | undefined> {
  if (jobName !== "lip-sync") return undefined
  delete payload.lipSyncBilledSeconds
  if (!lipSyncAudioPricingOf(payload.provider)) return undefined
  // A run waits longer for a measuring slot than a request: a level or a list fans out many nodes at once.
  const checked = await checkLipSyncInputs({
    provider: payload.provider,
    audioUrl: payload.audioUrl,
    imageUrl: payload.imageUrl,
    userId,
    slotWaitMs: LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS,
  })
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

/**
 * The price row a stamped lip-sync job on a BUCKETED model reserves
 * (`<provider>:<bucket>s`, from the seconds `stampLipSyncInputs` held) — the
 * row the route's guard reserves for the same audio. Undefined for every other
 * job (a per-second-rate model reserves its one-second row × the seconds,
 * `computeLipSyncRateCreditOverride`). A bucketed run that reached here
 * unmeasured is refused, never held on a guess: its charge is its hold.
 */
export function lipSyncBucketReserveId(jobName: string, payload: Record<string, unknown>): string | undefined {
  if (jobName !== "lip-sync") return undefined
  const pricing = lipSyncAudioPricingOf(payload.provider)
  if (pricing?.kind !== "bucket") return undefined
  const held = stampedLipSyncBilledSeconds(payload)
  if (held === undefined) throw new Error("lip-sync: a run priced by its audio's length reached its reservation without its measured audio")
  return lipSyncHeldCreditId(pricing, held)
}
