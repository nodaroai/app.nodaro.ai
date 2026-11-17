/**
 * Reference audio a model takes in some formats only is converted to MP3
 * before it is sent (decided 2026-11-16: Seedance 2.5 Flash takes WAV or MP3,
 * and any other clip — an M4A from a phone, an AAC, an OGG — is converted
 * rather than refused).
 *
 * The rule is the model's `VIDEO_REF_AUDIO_RULES` row with `convertsTo`: a clip
 * whose format the row lists goes as it came; any other one is downloaded,
 * decoded (the platform's one audio decode, `decodeAudioToPcm`: a file the
 * caller controls is only ever read through its format whitelist) and encoded
 * to MP3 into the running job's scratch folder, emptied when the job ends.
 * Its length was checked before the hold (`lib/ref-audio-probe.ts`: 2-30 s a
 * clip, 30 s together); a converted clip is held to the per-clip range again
 * on its decoded length, since a clip the route could not measure got through.
 *
 * It runs at the provider, where every run that sends reference audio passes
 * (the routes, a workflow run, MCP, the Lip Sync voice line): after the hold.
 * A clip that cannot be fetched, decoded or stored fails the run with a
 * sanitized error, so the job fails and its credits are refunded; it is never
 * sent as it came.
 */
import { join } from "node:path"
import { VIDEO_REF_AUDIO_RULES } from "@nodaro/shared/models"
import { probeMediaFormatAndDuration, downloadFile, createWorkDir, cleanupWorkDir, runFfmpeg } from "../video/ffmpeg-utils.js"
import { audioPeakMemoryMiB } from "../video/ffmpeg-memory-model.js"
import { decodeAudioToPcm, decodedPcmInputArgs } from "../video/decoded-audio-length.js"
import { mp3EncodeArgs } from "../video/mp3-encode.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { createSanitizedError } from "./client.js"
import { atInputStep, urlForLog } from "./input-label.js"

/** The largest reference-audio file fetched for a conversion (the providers document 15 MB a clip). */
const REFERENCE_AUDIO_MAX_SOURCE_BYTES = 100_000_000

/** The longest a converted clip may decode (the rule's 30 s, with room for a container's overhang). */
const REFERENCE_AUDIO_DECODE_CAP_SEC = 60

/** One conversion's encode limit. */
const ENCODE_TIMEOUT_MS = 120_000

/** The bitrate a converted clip is encoded at (the Lip Sync audio's own). */
const MP3_BITRATE = "192k"

/** The ffmpeg arguments that encode the decoded PCM `pcmPath` into the MP3 `output`. */
export function referenceAudioMp3Args(pcmPath: string, output: string): string[] {
  return ["-nostdin", "-v", "error", ...decodedPcmInputArgs(), "-i", pcmPath, ...mp3EncodeArgs({ filters: [], bitrate: MP3_BITRATE }), "-y", output]
}

/** Whether `provider` converts reference audio outside its listed formats. */
export function convertsReferenceAudio(provider: string | undefined): boolean {
  return !!provider && VIDEO_REF_AUDIO_RULES[provider]?.convertsTo === "mp3"
}

/**
 * Whether the clip at `url` is already in one of `formats`, by the probe's
 * `format_name`. A probe that cannot run, or names no format, is treated as
 * not listed: the clip is converted (an extension is never trusted).
 */
async function alreadyListed(url: string, formats: readonly string[]): Promise<boolean> {
  try {
    const probe = await probeMediaFormatAndDuration(url)
    return !!probe.formatNames && probe.formatNames.length > 0 && probe.formatNames.some((f) => formats.includes(f))
  } catch {
    return false
  }
}

/**
 * The URL to send `provider` for the reference audio at `url`: `url` itself
 * when the model takes its format (or the model converts nothing), else an MP3
 * of it in the running job's scratch folder. Throws a sanitized error when the
 * clip cannot be fetched, decoded or stored.
 */
export async function prepareReferenceAudio(url: string, provider: string, inputLabel = "reference audio"): Promise<string> {
  const rule = VIDEO_REF_AUDIO_RULES[provider]
  if (rule?.convertsTo !== "mp3" || !rule.formats) return url
  if (await alreadyListed(url, rule.formats)) return url
  const label = `${provider} ${inputLabel}`
  let workDir: string | undefined
  try {
    workDir = await createWorkDir("ref-audio-convert")
    const inputPath = join(workDir, "input")
    const pcmPath = join(workDir, "decoded.pcm")
    const outputPath = join(workDir, "converted.mp3")
    await atInputStep(label, url, "download", () => downloadFile(url, inputPath, { maxBytes: REFERENCE_AUDIO_MAX_SOURCE_BYTES }))
    await atInputStep(label, url, "encode", async () => {
      const decoded = await decodeAudioToPcm(inputPath, pcmPath, { capSec: REFERENCE_AUDIO_DECODE_CAP_SEC })
      if (!decoded) throw new Error("no audio could be decoded")
      // A clip the route could not measure is held to the rule here: never sent too long or too short.
      if (decoded.overCap) throw new Error(`the audio plays past ${REFERENCE_AUDIO_DECODE_CAP_SEC} s`)
      if (rule.maxSec !== undefined && decoded.seconds > rule.maxSec) throw new Error(`the audio plays ${decoded.seconds.toFixed(1)} s, over the ${rule.maxSec} s limit`)
      if (rule.minSec !== undefined && decoded.seconds < rule.minSec) throw new Error(`the audio plays ${decoded.seconds.toFixed(1)} s, under the ${rule.minSec} s minimum`)
      await runFfmpeg(referenceAudioMp3Args(pcmPath, outputPath), ENCODE_TIMEOUT_MS, { peakMemoryMiB: audioPeakMemoryMiB() })
    })
    const sent = await atInputStep(label, url, "upload", () => uploadJobScratchFile(outputPath, "provider-audio-converted", "mp3", "audio/mpeg"))
    console.log(`[KIE.ai] ${provider}: ${inputLabel} converted to MP3 from ${urlForLog(url)}`)
    return sent
  } catch (err) {
    console.error(`[KIE.ai] ${provider}: ${inputLabel} conversion failed: ${err instanceof Error ? err.message : String(err)}`)
    throw createSanitizedError(`Could not prepare ${inputLabel} for this model`, "Video generation")
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}

/**
 * Every clip of `urls` prepared for `provider` (`prepareReferenceAudio`), each
 * under its own number, in order. A failure fails the run only once every clip
 * has finished, so no conversion outlives the job's scratch folder.
 */
export async function prepareReferenceAudioUrls(provider: string, urls: readonly string[]): Promise<string[]> {
  if (!convertsReferenceAudio(provider) || urls.length === 0) return [...urls]
  const settled = await Promise.allSettled(urls.map((u, i) => prepareReferenceAudio(u, provider, `reference audio #${i + 1}`)))
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
  if (failed) throw failed.reason
  return settled.map((s) => (s as PromiseFulfilledResult<string>).value)
}
