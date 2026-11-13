/**
 * The audio a lip-sync model priced by its audio's length is sent — a
 * per-second-rate model (OmniHuman 2.0, decided 2026-11-11) and a model priced
 * by a length bucket (Kling AI Avatar, OmniHuman 1.5, the dubbing models on
 * KIE, Replicate and fal, decided 2026-11-13). PRICE AND SEND THE SAME BYTES:
 * the run was held on a measurement of the caller's URL, and a URL can answer
 * a second fetch with a different file, so the model is never sent the
 * caller's URL. The file is downloaded ONCE here, decoded, held to the price,
 * encoded, measured again and stored as our own copy, and only that copy's
 * URL goes on (one path, `prepareLipSyncAudio`, both kinds):
 *
 *  1. Download under the price check's own rule (`downloadLipSyncAudio`: the
 *     SOURCE byte cap on the stream and on disk, a minimum rate): a file of
 *     the cap or more is refused, whatever its server declared.
 *  2. Decode the DOWNLOADED source into the PCM it will be sent as
 *     (`decodeAudioToPcm` — the price check's own decode, so the same bytes
 *     give the same samples; never the container's declared length) and bill
 *     it with the one function the hold used (`lipSyncHeldSecondsOf`: a rate
 *     model's whole seconds, a bucketed model's bucket). A rate model's audio
 *     past its maximum, or more seconds than the run was held for, is refused
 *     as deterministic — the job fails and is refunded, nothing is sent
 *     upstream — and so is a file the decoder could not read to its end
 *     (`AudioReadStoppedError`, the price check's own refusal).
 *  3. Encode THAT PCM to MP3 — ALWAYS (decided 2026-11-12): the model is only
 *     ever sent a file we made, from exactly the samples the price counted
 *     (decided 2026-11-12: never encoded from the source again — a file that
 *     changes format mid-stream keeps a different number of samples in every
 *     ffmpeg run that resamples it differently). A rate model's audio shorter
 *     than the minimum is padded with silence to exactly the minimum
 *     (`LIP_SYNC_PAD_MARGIN_SEC` is 0) — on the PCM, one shape, so the pad
 *     cannot restart — and billed the minimum. The provider bills whole
 *     seconds rounded up: a clip padded past 4 s was billed 5 (staging,
 *     2026-11-12), while exactly 4.000 s, as WAV and as our MP3, was accepted
 *     and billed 4. A bucketed model's audio is never padded; past its maximum
 *     less `LIP_SYNC_TRIM_MARGIN_SEC` it is trimmed to that (the trim the
 *     KIE lane always made, now on every lane), priced at the maximum's bucket;
 *     held in the bucket below the one it falls in (it runs at most
 *     `LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC` past that bucket's length), it is
 *     cut to exactly that bucket's length.
 *  4. Measure OUR encode the same way: one that plays longer than the run was
 *     held for (the padded minimum aside) is refused, deterministic, and never
 *     sent. And what is sent must be under a rate model's 15 MB (decided
 *     2026-11-11): over it is refused, deterministic.
 *  5. Store the encode in the job's scratch folder and send that URL.
 */
import { join } from "node:path"
import { rm, stat } from "node:fs/promises"
import type { LipSyncAudioRate } from "@nodaro/shared/credits"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import {
  audioReadStoppedMessage,
  downloadLipSyncAudio,
  lipSyncAudioCapSec,
  lipSyncHeldSecondsOf,
  type LipSyncAudioPricing,
  type LipSyncInputRule,
} from "../../lib/lip-sync-inputs.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { cleanupWorkDir, createWorkDir, runFfmpeg } from "../video/ffmpeg-utils.js"
import { audioPeakMemoryMiB } from "../video/ffmpeg-memory-model.js"
import {
  DECODED_AUDIO_RATE_HZ,
  decodeAudioToPcm,
  decodedPcmInputArgs,
  isAudioReadStopped,
  isStoppedLaunch,
  measureDecodedAudio,
  type DecodedAudioLength,
} from "../video/decoded-audio-length.js"

/**
 * How far past the minimum a padded clip runs: none. The provider rounds the
 * audio it is sent up to whole seconds, so any margin bills a fifth second;
 * our MP3 of exactly 4.000 s (its encoder delay marked for removal) is taken
 * and billed as 4 (decided 2026-11-12, from staging and a direct check).
 */
export const LIP_SYNC_PAD_MARGIN_SEC = 0

/**
 * How far under its maximum a bucketed model's audio is trimmed when it plays
 * past that: the margin the KIE lane always trimmed by, so the provider's own
 * reading and rounding never trips its upper limit.
 */
export const LIP_SYNC_TRIM_MARGIN_SEC = 0.5

/**
 * How far our encode may measure past what it is held to — a margin, not
 * audio: the MP3 of the decoded PCM decodes back to exactly the PCM's sample
 * count (and a padded one to exactly its target) on every format tried,
 * including files that change format mid-stream.
 */
export const LIP_SYNC_ENCODE_TOLERANCE_SEC = 0.001

/** The encode every prepared file gets: MP3 at 192 kb/s (300 s of it is ~7.2 MB, far under the cap). */
const MP3_ENCODE = ["-c:a", "libmp3lame", "-b:a", "192k"] as const

/** The one container our encode is read back as. */
const SENT_FORMATS: readonly string[] = ["mp3"]

/** The most an encode may take: at most 300 s of audio is seconds of work. */
const ENCODE_TIMEOUT_MS = 120_000

export interface PreparedLipSyncAudio {
  /** OUR copy's URL — the only audio URL the model is ever sent. */
  readonly url: string
  /** The downloaded audio's decoded length, in seconds (a bucketed model's audio past its maximum: the maximum). */
  readonly measuredSec: number
  /** …in sample frames of the decoded PCM (`DECODED_AUDIO_RATE_HZ`): what the price check counted for the same bytes. */
  readonly measuredSamples: number
  /** The seconds the downloaded audio bills (`lipSyncHeldSecondsOf`), at most what the run was held for. */
  readonly billedSeconds: number
  /** Our encode's decoded length, in seconds — what the model is sent. */
  readonly sentSec: number
  /** …in sample frames: `measuredSamples` exactly, the padded minimum, or the trimmed maximum. */
  readonly sentSamples: number
  /** Whether it was padded to the minimum. */
  readonly padded: boolean
  /** Whether it was trimmed under the maximum (a bucketed model only). */
  readonly trimmed: boolean
}

/**
 * The ffmpeg arguments that encode the decoded PCM `pcmPath` into the MP3
 * `output`, padded to `padToSec` or cut at `trimToSec` when given.
 */
export function lipSyncAudioEncodeArgs(pcmPath: string, output: string, padToSec: number | undefined, trimToSec?: number): string[] {
  return [
    "-nostdin",
    "-v", "error",
    ...decodedPcmInputArgs(),
    "-i", pcmPath,
    ...(padToSec !== undefined ? ["-af", `apad=whole_dur=${padToSec}`] : []),
    ...(trimToSec !== undefined ? ["-t", String(trimToSec)] : []),
    ...MP3_ENCODE,
    "-y",
    output,
  ]
}

const mbOf = (bytes: number) => `${Math.round(bytes / 100_000) / 10} MB`

/**
 * Decode the caller's downloaded file into `pcmPath`: its length, or a
 * refusal. ffmpeg refusing the file — or stopping part-way through it — is the
 * file's doing (deterministic); a launch that was stopped (its time limit) is
 * not, and is thrown as it is.
 */
async function decodeSource(path: string, pcmPath: string, capSec: number, label: string): Promise<DecodedAudioLength> {
  let length: DecodedAudioLength | undefined
  try {
    length = await decodeAudioToPcm(path, pcmPath, { capSec })
  } catch (err) {
    if (isStoppedLaunch(err)) throw err
    if (isAudioReadStopped(err)) throw new DeterministicJobError(`${audioReadStoppedMessage(label)} Nothing is charged.`, { cause: err })
    throw new DeterministicJobError(`${label} could not decode the audio. Nothing is charged.`, { cause: err })
  }
  if (!length) throw new DeterministicJobError(`${label} could not decode the audio. Nothing is charged.`)
  return length
}

/**
 * Download, measure, hold to the price, encode, measure again and store the
 * audio for a model priced by its audio's length (see the module doc) — THE
 * one path, for a per-second-rate model and a bucketed one alike.
 * `heldBilledSeconds` is what the run was held for (`lipSyncHeldSecondsOf` of
 * the route's or the workflow run's measurement, carried on the job as
 * `lipSyncBilledSeconds`). Refusals that depend only on the file are
 * `DeterministicJobError`s: the job fails and is refunded now.
 */
export async function prepareLipSyncAudio(
  audioUrl: string,
  pricing: LipSyncAudioPricing,
  label: string,
  heldBilledSeconds: number | undefined,
): Promise<PreparedLipSyncAudio> {
  if (heldBilledSeconds === undefined || !Number.isInteger(heldBilledSeconds) || heldBilledSeconds <= 0) {
    throw new DeterministicJobError(`${label}: this run was not priced from its audio, so it was not sent. Run it again.`)
  }
  const capSec = lipSyncAudioCapSec(pricing)
  const { rule } = pricing
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("lip-sync-audio")
    const inputPath = join(workDir, "input")
    if ((await downloadLipSyncAudio(audioUrl, inputPath, rule)) === "too_large") {
      throw new DeterministicJobError(`${label} takes an audio file under ${mbOf(rule.audio.maxSourceBytes)}; this one is larger. Nothing is charged.`)
    }

    const pcmPath = join(workDir, "decoded.pcm")
    const source = await decodeSource(inputPath, pcmPath, capSec, label)
    const changed = (now: string) =>
      new DeterministicJobError(
        `${label}: the audio changed between the price check and the run — it is now ${now}, ` +
          `and the run was priced for ${heldBilledSeconds} seconds. Nothing is charged; run it again to price this audio.`,
      )
    // A rate model takes nothing past its maximum; a bucketed model's longer audio is priced at it and trimmed.
    if (source.overCap && pricing.kind === "rate") throw changed(`over ${capSec} seconds`)
    const billedSeconds = lipSyncHeldSecondsOf(pricing, source)
    const measuredSec = source.overCap ? capSec : source.seconds
    if (billedSeconds === undefined || billedSeconds > heldBilledSeconds) {
      throw changed(source.overCap ? `over ${capSec} seconds` : `${Number(measuredSec.toFixed(2))} seconds`)
    }

    // Always our own MP3, from exactly the samples the price counted: a rate
    // model's padded past its minimum when shorter, a bucketed model's cut
    // under its maximum when it plays past that.
    const shape = sendShape(pricing, source, billedSeconds)
    const sendPath = join(workDir, "prepared.mp3")
    await runFfmpeg(lipSyncAudioEncodeArgs(pcmPath, sendPath, shape.padToSec, shape.trimToSec), ENCODE_TIMEOUT_MS, { peakMemoryMiB: audioPeakMemoryMiB() })
    // The source and its PCM are done with: only our MP3 is read from here on.
    await Promise.all([rm(pcmPath, { force: true }), rm(inputPath, { force: true })])

    // What we send must play no longer than what was held: the held seconds,
    // or the padded minimum. Our own file, so a failure to measure it is ours (not deterministic).
    const sent = await measureDecodedAudio(sendPath, { capSec: capSec + 1, formats: SENT_FORMATS })
    if (!sent) throw new Error(`${label}: the prepared audio could not be measured`)
    const sendLimitSec = Math.max(heldBilledSeconds, shape.padToSec ?? 0)
    if (sent.overCap || sent.seconds > sendLimitSec + LIP_SYNC_ENCODE_TOLERANCE_SEC) {
      throw new DeterministicJobError(
        `${label}: prepared for the model, the audio plays ${sent.overCap ? `over ${capSec + 1}` : Number(sent.seconds.toFixed(3))} seconds, ` +
          `longer than the ${heldBilledSeconds} seconds this run was priced for, so it was not sent. Nothing is charged.`,
      )
    }
    if (shape.padToSec !== undefined && sent.seconds < shape.padToSec - LIP_SYNC_PAD_MARGIN_SEC) {
      throw new Error(`${label}: padding the audio to ${shape.padToSec - LIP_SYNC_PAD_MARGIN_SEC} seconds failed (it measures ${sent.seconds} seconds)`)
    }
    const sentMaxBytes = pricing.kind === "rate" ? pricing.rule.audio.maxBytes : undefined
    const { size } = await stat(sendPath)
    if (sentMaxBytes !== undefined && size >= sentMaxBytes) {
      throw new DeterministicJobError(
        `${label}: the audio is too long or too large to send — even as MP3 it is ${mbOf(size)}, and the model takes under ${mbOf(sentMaxBytes)}. Nothing is charged.`,
      )
    }
    // A provider input: the running job's scratch folder, emptied when the job ends.
    const url = await uploadJobScratchFile(sendPath, "lip-sync-prepared", "mp3", "audio/mpeg")
    const padded = shape.padToSec !== undefined
    const trimmed = shape.trimToSec !== undefined
    console.log(
      `[${pricing.kind === "rate" ? "KIE.ai" : "lip-sync"}] ${label} audio stored (${source.overCap ? `over ${capSec}` : measuredSec.toFixed(3)}s decoded, ` +
        `billed ${billedSeconds}s of ${heldBilledSeconds}s held; sent ${sent.seconds.toFixed(3)}s as MP3${padded ? ", padded" : ""}${trimmed ? ", trimmed" : ""})`,
    )
    return {
      url,
      measuredSec,
      measuredSamples: source.overCap ? Math.round(capSec * DECODED_AUDIO_RATE_HZ) : source.samples,
      billedSeconds,
      sentSec: sent.seconds,
      sentSamples: sent.samples,
      padded,
      trimmed,
    }
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}

/**
 * How the copy sent plays against what was measured: a rate model's audio
 * under its minimum padded to exactly it. A bucketed model's audio past its
 * maximum less `LIP_SYNC_TRIM_MARGIN_SEC` cut at that; audio held in the bucket
 * below the one it falls in (at most `LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC` past
 * that bucket's length) cut to exactly that bucket's `billedSeconds`, so what
 * is sent is what was priced. Otherwise as measured.
 */
function sendShape(pricing: LipSyncAudioPricing, source: DecodedAudioLength, billedSeconds: number): { readonly padToSec?: number; readonly trimToSec?: number } {
  if (pricing.kind === "rate") {
    return !source.overCap && source.seconds < pricing.rate.minSeconds ? { padToSec: pricing.rate.minSeconds + LIP_SYNC_PAD_MARGIN_SEC } : {}
  }
  const underMax = pricing.maxSeconds - LIP_SYNC_TRIM_MARGIN_SEC
  if (source.overCap || source.seconds > underMax) return { trimToSec: underMax }
  return source.seconds > billedSeconds ? { trimToSec: billedSeconds } : {}
}

/**
 * A per-second-rate model's audio (OmniHuman 2.0): `prepareLipSyncAudio` on
 * its rate and input rule.
 */
export function prepareRateLipSyncAudio(
  audioUrl: string,
  rate: LipSyncAudioRate,
  rule: LipSyncInputRule,
  label: string,
  heldBilledSeconds: number | undefined,
): Promise<PreparedLipSyncAudio> {
  return prepareLipSyncAudio(audioUrl, { kind: "rate", rate, rule }, label, heldBilledSeconds)
}
