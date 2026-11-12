/**
 * The audio a per-second-rate lip-sync model is sent (OmniHuman 2.0,
 * decided 2026-11-11). PRICE AND SEND THE SAME BYTES: the run was held on a
 * measurement of the caller's URL, and a URL can answer a second fetch with a
 * different file, so the model is never sent the caller's URL. The file is
 * downloaded ONCE here, decoded, held to the price, encoded, measured again
 * and stored as our own copy, and only that copy's URL goes on:
 *
 *  1. Download under the price check's own rule (`downloadLipSyncAudio`: the
 *     SOURCE byte cap on the stream and on disk, a minimum rate): a file of
 *     the cap or more is refused, whatever its server declared.
 *  2. Decode the DOWNLOADED source into the PCM it will be sent as
 *     (`decodeAudioToPcm` — the price check's own decode, so the same bytes
 *     give the same samples; never the container's declared length) and bill
 *     it with the one function the hold used (`lipSyncBilledSeconds`). Past the
 *     maximum, or more seconds than the run was held for, is refused as
 *     deterministic — the job fails and is refunded, nothing is sent upstream —
 *     and so is a file the decoder could not read to its end
 *     (`AudioReadStoppedError`, the price check's own refusal).
 *  3. Encode THAT PCM to MP3 — ALWAYS (decided 2026-11-12): the model is only
 *     ever sent a file we made, from exactly the samples the price counted
 *     (decided 2026-11-12: never encoded from the source again — a file that
 *     changes format mid-stream keeps a different number of samples in every
 *     ffmpeg run that resamples it differently). Audio shorter than the minimum
 *     is padded with silence to a hair PAST it (`LIP_SYNC_PAD_MARGIN_SEC`) —
 *     on the PCM, one shape, so the pad cannot restart — billed the minimum
 *     all the same.
 *  4. Measure OUR encode the same way: one that plays longer than the run was
 *     held for (the padded minimum aside) is refused, deterministic, and never
 *     sent. And what is sent must be under the model's 15 MB (decided
 *     2026-11-11): over it is refused, deterministic.
 *  5. Store the encode in the job's scratch folder and send that URL.
 */
import { join } from "node:path"
import { rm, stat } from "node:fs/promises"
import { lipSyncBilledSeconds, type LipSyncAudioRate } from "@nodaro/shared/credits"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { audioReadStoppedMessage, downloadLipSyncAudio, type LipSyncInputRule } from "../../lib/lip-sync-inputs.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { cleanupWorkDir, createWorkDir, runFfmpeg } from "../video/ffmpeg-utils.js"
import { audioPeakMemoryMiB } from "../video/ffmpeg-memory-model.js"
import {
  decodeAudioToPcm,
  decodedPcmInputArgs,
  isAudioReadStopped,
  isStoppedLaunch,
  measureDecodedAudio,
  type DecodedAudioLength,
} from "../video/decoded-audio-length.js"

/** How far past the minimum a padded clip runs: an MP3 frame is ~26 ms, so this keeps a whole margin of frames. */
export const LIP_SYNC_PAD_MARGIN_SEC = 0.1

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
  /** The downloaded audio's decoded length, in seconds. */
  readonly measuredSec: number
  /** …in sample frames of the decoded PCM (`DECODED_AUDIO_RATE_HZ`): what the price check counted for the same bytes. */
  readonly measuredSamples: number
  /** The whole seconds of the downloaded audio (`lipSyncBilledSeconds`), at most what the run was held for. */
  readonly billedSeconds: number
  /** Our encode's decoded length, in seconds — what the model is sent. */
  readonly sentSec: number
  /** …in sample frames: `measuredSamples` exactly, or the padded minimum. */
  readonly sentSamples: number
  /** Whether it was padded to the minimum. */
  readonly padded: boolean
}

/** The ffmpeg arguments that encode the decoded PCM `pcmPath` into the MP3 `output`, padded to `padToSec` when given. */
export function lipSyncAudioEncodeArgs(pcmPath: string, output: string, padToSec: number | undefined): string[] {
  return [
    "-nostdin",
    "-v", "error",
    ...decodedPcmInputArgs(),
    "-i", pcmPath,
    ...(padToSec !== undefined ? ["-af", `apad=whole_dur=${padToSec}`] : []),
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
async function decodeSource(path: string, pcmPath: string, rate: LipSyncAudioRate, label: string): Promise<DecodedAudioLength> {
  let length: DecodedAudioLength | undefined
  try {
    length = await decodeAudioToPcm(path, pcmPath, { capSec: rate.maxSeconds })
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
 * audio for a per-second-rate model (see the module doc). `heldBilledSeconds`
 * is what the run was priced at (`lipSyncBilledSeconds` of the route's or the
 * workflow run's measurement, carried on the job). Refusals that depend only on
 * the file are `DeterministicJobError`s: the job fails and is refunded now.
 */
export async function prepareRateLipSyncAudio(
  audioUrl: string,
  rate: LipSyncAudioRate,
  rule: LipSyncInputRule,
  label: string,
  heldBilledSeconds: number | undefined,
): Promise<PreparedLipSyncAudio> {
  if (heldBilledSeconds === undefined || !Number.isInteger(heldBilledSeconds) || heldBilledSeconds <= 0) {
    throw new DeterministicJobError(`${label}: this run was not priced from its audio, so it was not sent. Run it again.`)
  }
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("lip-sync-audio")
    const inputPath = join(workDir, "input")
    if ((await downloadLipSyncAudio(audioUrl, inputPath, rule)) === "too_large") {
      throw new DeterministicJobError(`${label} takes an audio file under ${mbOf(rule.audio.maxSourceBytes)}; this one is larger. Nothing is charged.`)
    }

    const pcmPath = join(workDir, "decoded.pcm")
    const source = await decodeSource(inputPath, pcmPath, rate, label)
    const changed = (now: string) =>
      new DeterministicJobError(
        `${label}: the audio changed between the price check and the run — it is now ${now}, ` +
          `and the run was priced for ${heldBilledSeconds} seconds. Nothing is charged; run it again to price this audio.`,
      )
    if (source.overCap) throw changed(`over ${rate.maxSeconds} seconds`)
    const measuredSec = source.seconds
    const billedSeconds = lipSyncBilledSeconds(rate, measuredSec)
    if (measuredSec > rate.maxSeconds || billedSeconds > heldBilledSeconds) throw changed(`${Number(measuredSec.toFixed(2))} seconds`)

    // Always our own MP3, from exactly the samples the price counted; padded past the minimum when shorter.
    const pad = measuredSec < rate.minSeconds
    const padToSec = pad ? rate.minSeconds + LIP_SYNC_PAD_MARGIN_SEC : undefined
    const sendPath = join(workDir, "prepared.mp3")
    await runFfmpeg(lipSyncAudioEncodeArgs(pcmPath, sendPath, padToSec), ENCODE_TIMEOUT_MS, { peakMemoryMiB: audioPeakMemoryMiB() })
    // The source and its PCM are done with: only our MP3 is read from here on.
    await Promise.all([rm(pcmPath, { force: true }), rm(inputPath, { force: true })])

    // What we send must play no longer than what was held: the held seconds,
    // or the padded minimum. Our own file, so a failure to measure it is ours (not deterministic).
    const sent = await measureDecodedAudio(sendPath, { capSec: rate.maxSeconds + 1, formats: SENT_FORMATS })
    if (!sent) throw new Error(`${label}: the prepared audio could not be measured`)
    const sendLimitSec = Math.max(heldBilledSeconds, padToSec ?? 0)
    if (sent.overCap || sent.seconds > sendLimitSec + LIP_SYNC_ENCODE_TOLERANCE_SEC) {
      throw new DeterministicJobError(
        `${label}: prepared for the model, the audio plays ${sent.overCap ? `over ${rate.maxSeconds + 1}` : Number(sent.seconds.toFixed(3))} seconds, ` +
          `longer than the ${heldBilledSeconds} seconds this run was priced for, so it was not sent. Nothing is charged.`,
      )
    }
    if (pad && sent.seconds < rate.minSeconds) {
      throw new Error(`${label}: padding the audio to ${rate.minSeconds} seconds failed (it measures ${sent.seconds} seconds)`)
    }
    const { size } = await stat(sendPath)
    if (size >= rule.audio.maxBytes) {
      throw new DeterministicJobError(
        `${label}: the audio is too long or too large to send — even as MP3 it is ${mbOf(size)}, and the model takes under ${mbOf(rule.audio.maxBytes)}. Nothing is charged.`,
      )
    }
    // A provider input: the running job's scratch folder, emptied when the job ends.
    const url = await uploadJobScratchFile(sendPath, "lip-sync-prepared", "mp3", "audio/mpeg")
    console.log(
      `[KIE.ai] ${label} audio stored (${measuredSec.toFixed(3)}s decoded, billed ${billedSeconds}s of ${heldBilledSeconds}s held; ` +
        `sent ${sent.seconds.toFixed(3)}s as MP3${pad ? ", padded" : ""})`,
    )
    return {
      url,
      measuredSec,
      measuredSamples: source.samples,
      billedSeconds,
      sentSec: sent.seconds,
      sentSamples: sent.samples,
      padded: pad,
    }
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}
