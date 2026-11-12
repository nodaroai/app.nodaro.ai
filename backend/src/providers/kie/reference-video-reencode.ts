/**
 * Reference videos a Seedance 2.x run sends are re-encoded first.
 *
 * Measured on staging (2026-11-10/11): a Seedance 2.5 edit whose source clip
 * was a file Seedance itself had produced, sent byte for byte, came back as a
 * near-copy of its input on every run (7 of 7) — the edit was not applied at
 * all. The same footage re-encoded (any plain libx264 encode, MP4 or MOV, with
 * or without sound, at its own length or padded) was edited every time (5 of
 * 5). Cutting only the sound to the picture's length did not help: the
 * picture was still the original bitstream. So no reference video reaches the
 * provider as the file it came in: each one is encoded again, once, right
 * before the task is created, and the copy goes to the running job's scratch
 * folder (`lib/job-scratch.ts`), emptied when the job ends.
 *
 * The copy changes nothing a person can see, nor anything the run is priced
 * from:
 *
 * - every frame is passed through as it is (`-fps_mode passthrough`): same
 *   frame count, same timestamps, same frame rate, same length; no trim, no
 *   scale, no filter (a phone clip's rotation is applied, so it is stored the
 *   way it is shown);
 * - the picture keeps the source's quality (the house rule for a re-encode,
 *   `../video/matched-encode.ts`):
 *   H.264 at the source's own picture bitrate, in two passes (one pass aims
 *   low on a short clip), its pixel format where 8-bit H.264 can hold it
 *   (Seedance's 4:4:4 MOV stays 4:4:4) and its colour tags; a bitrate the
 *   probe cannot read encodes at a visually lossless constant quality;
 * - the sound is copied as it is when the container plays it everywhere
 *   (AAC or MP3 in an MP4; also PCM in a MOV), else encoded to AAC;
 * - a QuickTime source stays a MOV (its PCM sound and 4:4:4 picture are what
 *   that container was chosen for), anything else becomes an MP4;
 * - the copy stays within the provider's size limit a reference video
 *   (`referenceVideoMaxBytes`: 200 MB on Seedance 2.5, 50 MB on the 2.0
 *   family): a source that fits keeps its own bitrate; only one over the limit is encoded at
 *   the bitrate that fits (`SIZE_HEADROOM` below it), and a copy that two
 *   passes land just over the limit is encoded once more at that bitrate.
 *
 * A clip that cannot be fetched, encoded or stored fails the run with a
 * sanitized error (the worker's failure path, which refunds the run). It is
 * never sent as it came: for a clip Seedance produced, that is the near-copy
 * this step exists to prevent, and it would be billed.
 */
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "../video/ffmpeg-utils.js"
import { MATCHED_FALLBACK_CRF, matchedPictureArgs, probeMatched, type MatchedProbe } from "../video/matched-encode.js"
import { reencodePeakMemoryMiB } from "../video/video-file-stages.js"
import { uploadJobScratchFile } from "../../lib/job-scratch.js"
import { createSanitizedError } from "./client.js"
import { atInputStep, urlForLog } from "./input-label.js"

/** The 2.0 family's largest reference video, in bytes (50 MB). */
export const SEEDANCE_2_REF_VIDEO_MAX_BYTES = 50_000_000

/** Seedance 2.5's largest reference video, in bytes (200 MB). */
export const SEEDANCE_2_5_REF_VIDEO_MAX_BYTES = 200_000_000

const REF_VIDEO_MAX_BYTES: Readonly<Record<string, number>> = { "seedance-2-5": SEEDANCE_2_5_REF_VIDEO_MAX_BYTES }

/**
 * The largest reference video `provider` takes, in bytes, as the provider
 * documents it per model. A model not named here is held to the 2.0 family's
 * limit, the smaller one.
 */
export function referenceVideoMaxBytes(provider: string): number {
  return Object.hasOwn(REF_VIDEO_MAX_BYTES, provider) ? REF_VIDEO_MAX_BYTES[provider]! : SEEDANCE_2_REF_VIDEO_MAX_BYTES
}

/** The share of that limit a copy encoded down to fit may fill: the rest is
 *  room for the container and a two-pass encode landing a little over its
 *  target. */
const SIZE_HEADROOM = 0.9

/** The constant quality the picture is encoded at when its bitrate is unknown (visually lossless; `MATCHED_FALLBACK_CRF`). */
export const REFERENCE_VIDEO_FALLBACK_CRF = MATCHED_FALLBACK_CRF

/** What the probe read of the downloaded clip (`MatchedProbe`). Absent = not reported. */
export type ReferenceVideoProbe = MatchedProbe

/** Probe a local file: the matched encode's own (`probeMatched`). Never throws. */
export { probeMatched as probeReferenceVideo }

export type ReferenceVideoContainer = "mp4" | "mov"

const CONTENT_TYPE: Record<ReferenceVideoContainer, string> = { mp4: "video/mp4", mov: "video/quicktime" }

/**
 * The sound codecs copied into each container as they are. ffmpeg would copy
 * more (PCM into an MP4, for one) into files few readers take; any other
 * sound is encoded to AAC.
 */
const COPIED_AUDIO: Record<ReferenceVideoContainer, ReadonlySet<string>> = {
  mp4: new Set(["aac", "mp3"]),
  mov: new Set(["aac", "mp3", "pcm_s16le", "pcm_s16be", "pcm_s24le", "pcm_s24be"]),
}

/**
 * How the copy carries the sound: copied when `container` plays the codec
 * everywhere (`COPIED_AUDIO`), else AAC. A sound the probe did not name is
 * tried as a copy; a copy the container refuses is then encoded to AAC.
 */
export function referenceVideoAudio(probe: ReferenceVideoProbe, container: ReferenceVideoContainer): "copy" | "aac" {
  if (!probe.audioCodec) return "copy"
  return COPIED_AUDIO[container].has(probe.audioCodec) ? "copy" : "aac"
}

/** The copy's container: MOV for a QuickTime source (the probe's brand, else a `.mov` address), MP4 otherwise. */
export function referenceVideoContainer(probe: ReferenceVideoProbe, url: string): ReferenceVideoContainer {
  if (probe.quickTime !== undefined) return probe.quickTime ? "mov" : "mp4"
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    /* not a URL: read it as a path */
  }
  return path.toLowerCase().endsWith(".mov") ? "mov" : "mp4"
}

/**
 * The picture bitrate a copy is encoded down to when it would not fit the
 * provider's size limit (`maxBytes`, `referenceVideoMaxBytes`): the limit,
 * less `SIZE_HEADROOM` and the sound. Undefined when the clip's length is
 * unknown.
 */
export function referenceVideoMaxBitRate(probe: ReferenceVideoProbe, maxBytes: number): number | undefined {
  if (!probe.durationSec || probe.durationSec <= 0) return undefined
  const rate = Math.floor((maxBytes * 8 * SIZE_HEADROOM) / probe.durationSec - (probe.audioBitRate ?? 0))
  return rate > 0 ? rate : undefined
}

/**
 * The picture bitrate the copy is encoded at: the source's own whenever the
 * source fits the provider's size limit `maxBytes` (or its length is
 * unknown), else the bitrate that fits (`referenceVideoMaxBitRate`).
 * Undefined when the source's is unknown (constant quality).
 */
export function referenceVideoTargetBitRate(probe: ReferenceVideoProbe, maxBytes: number): number | undefined {
  const source = probe.videoBitRate && probe.videoBitRate > 0 ? Math.round(probe.videoBitRate) : undefined
  if (!source) return undefined
  if (!probe.durationSec || probe.durationSec <= 0) return source
  const sourceBytes = ((source + (probe.audioBitRate ?? 0)) * probe.durationSec) / 8
  if (sourceBytes <= maxBytes) return source
  const max = referenceVideoMaxBitRate(probe, maxBytes)
  return max !== undefined ? Math.min(source, max) : source
}

/**
 * The picture encode shared by both passes (`pass` only with a known bitrate):
 * the source's quality (`matchedPictureArgs`), at the bitrate that fits the
 * provider's size limit `maxBytes` (`referenceVideoTargetBitRate`), the
 * constant-quality fallback capped to it (`referenceVideoMaxBitRate`). Also
 * the picture of a chained extend's cut (`lib/seedance-extend-mov-chain.ts`).
 */
export function referenceVideoPictureArgs(probe: ReferenceVideoProbe, maxBytes: number, pass?: { n: 1 | 2; log: string }): string[] {
  return matchedPictureArgs(probe, {
    targetBitRate: referenceVideoTargetBitRate(probe, maxBytes),
    maxBitRate: referenceVideoMaxBitRate(probe, maxBytes),
    pass,
  })
}

/**
 * The ffmpeg arguments that write the copy of `input` to `output`: the first
 * picture and the first sound track only (chapters, data tracks and metadata
 * dropped), the picture re-encoded (`referenceVideoPictureArgs`), the sound copied or, with
 * `audio: "aac"`, encoded to AAC. `maxBytes`: the provider's size limit
 * (`referenceVideoMaxBytes`). `passLog`: the second of two passes, which reads
 * the first pass's measurements (`reencodeFirstPassArgs`).
 */
export function reencodeReferenceVideoArgs(
  input: string,
  output: string,
  probe: ReferenceVideoProbe,
  maxBytes: number,
  audio: "copy" | "aac",
  passLog?: string,
): string[] {
  return [
    "-y", "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-map_metadata", "-1", "-map_chapters", "-1",
    ...referenceVideoPictureArgs(probe, maxBytes, passLog ? { n: 2, log: passLog } : undefined),
    ...(audio === "copy" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"]),
    "-movflags", "+faststart",
    output,
  ]
}

/** The first of the two passes: the picture only, measured into `passLog`, nothing written. */
export function reencodeFirstPassArgs(input: string, probe: ReferenceVideoProbe, maxBytes: number, passLog: string): string[] {
  return [
    "-y", "-i", input,
    "-map", "0:v:0", "-an",
    ...referenceVideoPictureArgs(probe, maxBytes, { n: 1, log: passLog }),
    "-f", "null", "-",
  ]
}

/**
 * The copy failures the AAC encode cures: the container cannot hold the
 * sound (stream #1: the picture is #0) as it is — the MP4 muxer's wording,
 * and the MOV muxer's for a sound it leaves to MP4. Anything else is not
 * retried.
 */
function isAudioCopyRefused(e: unknown): boolean {
  return e instanceof Error && /Could not find tag for codec \S+ in stream #1\b|\bonly supported in MP4\b/.test(e.message)
}

/**
 * The URL to send `provider` (the model id, which also names the run in the
 * log) for `videoUrl`: a re-encoded copy of it in the running job's scratch
 * folder, within that model's size limit (`referenceVideoMaxBytes`). Throws a
 * sanitized error (the run fails and is refunded) when the clip cannot be
 * fetched, encoded or stored; never returns `videoUrl` itself.
 */
export async function reencodeReferenceVideo(
  videoUrl: string,
  provider: string,
  /** Which input this is ("reference video #1"), for the log lines and the error. */
  inputLabel = "reference video",
): Promise<string> {
  let workDir: string | undefined
  // Each step under the input's name: a failure logs which input and step (input-label.ts).
  const label = `${provider} ${inputLabel}`
  const maxBytes = referenceVideoMaxBytes(provider)
  try {
    workDir = await createWorkDir("ref-video-reencode")
    const inputPath = join(workDir, "input")
    await atInputStep(label, videoUrl, "download", () => downloadFile(videoUrl, inputPath))
    const probe = await probeMatched(inputPath)
    const container = referenceVideoContainer(probe, videoUrl)
    const outputPath = join(workDir, `reencoded.${container}`)
    // Admitted like every ffmpeg, at the clip's own size (unknown = assumed 4K).
    const launch = {
      peakMemoryMiB: reencodePeakMemoryMiB(probe.width && probe.height ? { width: probe.width, height: probe.height } : undefined),
    }
    const rate = referenceVideoTargetBitRate(probe, maxBytes)
    const passLog = rate ? join(workDir, "pass") : undefined
    await atInputStep(label, videoUrl, "encode", async () => {
      if (passLog) await runFfmpeg(reencodeFirstPassArgs(inputPath, probe, maxBytes, passLog), undefined, launch)
      let audio = referenceVideoAudio(probe, container)
      const writeCopy = async (at: ReferenceVideoProbe) => {
        try {
          await runFfmpeg(reencodeReferenceVideoArgs(inputPath, outputPath, at, maxBytes, audio, passLog), undefined, launch)
        } catch (e) {
          if (audio !== "copy" || !isAudioCopyRefused(e)) throw e
          audio = "aac"
          await runFfmpeg(reencodeReferenceVideoArgs(inputPath, outputPath, at, maxBytes, audio, passLog), undefined, launch)
        }
      }
      await writeCopy(probe)
      // A source that fits keeps its own bitrate; two passes can land a little
      // over it. Only then is the second pass run again, at the bitrate that
      // fits (the first pass's measurements still apply).
      const fit = referenceVideoMaxBitRate(probe, maxBytes)
      if (rate && fit !== undefined && rate > fit && (await stat(outputPath)).size > maxBytes) {
        console.warn(`[KIE.ai] ${provider}: ${inputLabel} came out over ${maxBytes} bytes at ${rate} b/s; encoding it again at ${fit} b/s`)
        await writeCopy({ ...probe, videoBitRate: fit })
      }
    })
    // A provider input: the running job's scratch folder, emptied when the job ends.
    const url = await atInputStep(label, videoUrl, "upload", () =>
      uploadJobScratchFile(outputPath, "provider-reencoded", container, CONTENT_TYPE[container]))
    console.log(
      `[KIE.ai] ${provider}: ${inputLabel} re-encoded (${container}, ${rate ? `${rate} b/s, two passes` : `crf ${REFERENCE_VIDEO_FALLBACK_CRF}`}) from ${urlForLog(videoUrl)}`,
    )
    return url
  } catch (err) {
    console.error(`[KIE.ai] ${provider}: ${inputLabel} re-encode failed: ${err instanceof Error ? err.message : String(err)}`)
    throw createSanitizedError(`Could not prepare ${inputLabel} for this model`, "Video generation")
  } finally {
    if (workDir) await cleanupWorkDir(workDir)
  }
}

/**
 * Every clip of `urls` re-encoded for `provider` (`reencodeReferenceVideo`),
 * each under its own number, in order. A failure fails the run only once
 * every clip has finished: an encode or upload still running after the run
 * failed would outlive the job and its scratch folder. The first failure (in
 * order) is the one thrown.
 */
export async function reencodeReferenceVideos(urls: readonly string[], provider: string): Promise<string[]> {
  const settled = await Promise.allSettled(urls.map((u, i) => reencodeReferenceVideo(u, provider, `reference video #${i + 1}`)))
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === "rejected")
  if (failed) throw failed.reason
  return settled.map((s) => (s as PromiseFulfilledResult<string>).value)
}
