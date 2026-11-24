/**
 * The server's measurement of an audio-to-video run's driving clip (catalog
 * `drivingAudio`, LTX 2.5 Fast — decided 2026-11-23), before anything is held:
 * the clip is downloaded under the provider's size limit (50 MB), decoded
 * (the decoded length, never a length a header states: `measureAudio`, the
 * reader Lip Sync prices by) from one of the containers the endpoint takes
 * (MP3, WAV, M4A/MP4, AAC, OGG, FLAC), and priced by the shared rule
 * (`drivingAudioRun`). A length the caller sends is never read.
 *
 * One rule for every place such a run starts: the two video routes' preHandler
 * (a 400 before the credit guard) and the workflow run (a coded refusal before
 * the jobs row's reservation). Input validation, not a credit feature: it runs
 * in every edition.
 */
import { drivingAudioMaxSec, drivingAudioOf, drivingAudioRun, drivingAudioTooLongMessage, type DrivingAudioRun } from "@nodaro/shared/credits"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CLIP_PRICE_GRACE_SEC } from "@nodaro/shared/media"
import { measureAudio } from "./lip-sync-inputs.js"
import { LIP_SYNC_MEASURE_SLOT_WAIT_MS, LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS } from "./lip-sync-download-slots.js"
import { safeUrlSchema } from "./url-validator.js"

/** The most bytes the endpoint takes for its audio (its schema: up to 50 MB). */
export const DRIVING_AUDIO_MAX_BYTES = 50_000_000

/**
 * The containers the endpoint takes (MP3 / WAV / M4A / AAC / OGG / FLAC), as
 * ffmpeg's demuxers name them: `mov` reads M4A — and MP4 / MOV video too, so
 * the file is also required to carry no picture (`audioOnly`): a video file
 * wired as audio is refused at measurement. Anything else is refused before
 * the hold rather than sent and refused by the provider.
 */
export const DRIVING_AUDIO_FORMATS: readonly string[] = ["mp3", "wav", "mov", "aac", "ogg", "flac"]

export type DrivingAudioMeasure =
  | (Extract<DrivingAudioRun, { ok: true }> & { readonly audioSec: number })
  | { readonly ok: false; readonly code: string; readonly message: string }

/** Measure `audioUrl` and price the run that `provider` makes from it at this resolution and frame rate. */
export async function measureDrivingAudio(args: {
  provider: string
  audioUrl: unknown
  resolution?: unknown
  fps?: unknown
  userId?: string
  /** How long to wait for a measuring slot: a request's 30 s by default; a workflow run waits longer, as Lip Sync's does. */
  slotWaitMs?: number
}): Promise<DrivingAudioMeasure> {
  const label = MODEL_CATALOG[args.provider]?.label ?? args.provider
  const spec = drivingAudioOf(args.provider)
  if (!spec) return { ok: false, code: "validation_error", message: `${label} does not make a video from an audio clip.` }
  if (typeof args.audioUrl !== "string" || !safeUrlSchema.safeParse(args.audioUrl).success) {
    return { ok: false, code: "validation_error", message: `${label}: the audio clip must be an http(s) link that does not point to localhost or a private network.` }
  }
  // Decode one grace past the longest the run can take, so a hair over is still measured (and held at the maximum).
  const capSec = drivingAudioMaxSec(args.provider, { resolution: args.resolution, fps: args.fps }) + CLIP_PRICE_GRACE_SEC
  const reading = await measureAudio(
    args.audioUrl,
    capSec,
    { audio: { maxSourceBytes: DRIVING_AUDIO_MAX_BYTES } },
    args.userId,
    args.slotWaitMs ?? LIP_SYNC_MEASURE_SLOT_WAIT_MS,
    DRIVING_AUDIO_FORMATS,
    { audioOnly: true },
  )
  switch (reading.kind) {
    case "busy":
      return { ok: false, code: "audio_busy", message: `${label}: too many audio files are being measured right now. Nothing was charged; try again in a moment.` }
    case "stopped":
      return { ok: false, code: "audio_measure_stopped", message: `${label}: measuring the audio took too long on our side and was stopped. Nothing was charged; try again in a moment.` }
    case "has_video":
      return { ok: false, code: "audio_has_video", message: `${label} takes an audio file; this one is a video. Wire its audio (an MP3, WAV, M4A, AAC, OGG or FLAC file) instead. Nothing was charged.` }
    case "too_large":
      return { ok: false, code: "audio_too_large", message: `${label} takes an audio file of up to 50 MB; this one is larger. Nothing was charged.` }
    case "unreadable":
      return {
        ok: false,
        code: "audio_unreadable",
        message:
          reading.why === "slow" || reading.why === "download"
            ? `${label} could not download the audio clip. Use a link that serves the file directly. Nothing was charged.`
            : `${label} could not read the audio clip to its end. Use an MP3, WAV, M4A, AAC, OGG or FLAC file with an audio track. Nothing was charged.`,
      }
    case "measured": {
      if (reading.length.overCap) {
        // The decode stopped past the longest the run takes: longer than the limit, at a length it never read.
        return { ok: false, code: "audio_too_long", message: drivingAudioTooLongMessage({ provider: args.provider, resolution: args.resolution, fps: args.fps }) }
      }
      const audioSec = reading.length.seconds
      const run = drivingAudioRun({ provider: args.provider, resolution: args.resolution, fps: args.fps, audioSec })
      return run.ok ? { ...run, audioSec } : run
    }
  }
}

/**
 * The workflow run's half: a payload the payload builder marked
 * (`drivingAudioPending`) is measured by the same rule and stamped with the
 * run it prices — the length sent, the resolution, the measured and billed
 * seconds — and its price row; or the refusal, for the executor to throw
 * before the reservation. A payload not marked is returned as it is.
 */
export async function stampDrivingAudioRun(
  payload: Record<string, unknown>,
  modelIdentifier: string,
  userId: string | undefined,
): Promise<
  | {
      readonly ok: true
      readonly payload: Record<string, unknown>
      readonly modelIdentifier: string
      /** The measured run, when the payload was an audio-to-video run: what the free-credit check judges. */
      readonly measured?: Extract<DrivingAudioMeasure, { ok: true }>
    }
  | { readonly ok: false; readonly code: string; readonly message: string }
> {
  if (payload.drivingAudioPending !== true) return { ok: true, payload, modelIdentifier }
  const { drivingAudioPending: _pending, ...rest } = payload
  const provider = String(payload.provider)
  const audioUrls = Array.isArray(payload.referenceAudioUrls) ? payload.referenceAudioUrls : []
  if (audioUrls.length > 1) {
    return { ok: false, code: "validation_error", message: `${MODEL_CATALOG[provider]?.label ?? provider} makes a video from one audio clip; ${audioUrls.length} are wired. Wire one. Nothing was charged.` }
  }
  // A workflow run waits for a measuring slot as long as Lip Sync's run does, so parallel nodes queue rather than fail busy.
  const measured = await measureDrivingAudio({ provider, audioUrl: audioUrls[0], resolution: payload.resolution, fps: payload.fps, userId, slotWaitMs: LIP_SYNC_RUN_MEASURE_SLOT_WAIT_MS })
  if (!measured.ok) return measured
  return {
    ok: true,
    payload: {
      ...rest,
      duration: measured.sentSec,
      resolution: measured.resolution,
      audioToVideo: true,
      drivingAudioSec: measured.audioSec,
      drivingAudioBilledSec: measured.billedSec,
    },
    modelIdentifier: measured.creditId,
    measured,
  }
}

/**
 * What a video run reports as adjusted: an audio-to-video run reads neither the
 * body's length nor its ratio, so a move of either is not reported. The one
 * filter both video routes and `POST /v1/quote` apply.
 */
export function adjustmentsForRun<A extends { readonly field: string }>(adjustments: readonly A[], drivingAudio: unknown): A[] {
  return drivingAudio ? adjustments.filter((a) => a.field !== "duration" && a.field !== "aspectRatio") : [...adjustments]
}

/**
 * The free-credit request of an audio-to-video run, built ONLY from the
 * server's own measurement (the route's `req.drivingAudio`, the workflow
 * run's stamp) — never read off a request body or a payload, so a client
 * cannot claim an audio-driven run it is not.
 */
export function drivingAudioFreeVideoRequest(provider: string, measured: { readonly billedSec: number; readonly resolution: string }): {
  provider: string
  duration: number
  resolution: string
  videoSize: null
  audioDriven: true
} {
  return { provider, duration: measured.billedSec, resolution: measured.resolution, videoSize: null, audioDriven: true }
}

/**
 * The HTTP status a refusal of the driving clip answers with — one mapper for
 * every route that reads one (Generate Video's two, Lip Sync's): busy is a 429
 * (try again in a moment), a stopped reading a 503 (ours), the rest the
 * request's own (400).
 */
export function drivingAudioRefusalStatus(code: string): number {
  if (code === "audio_busy") return 429
  if (code === "audio_measure_stopped") return 503
  return 400
}
