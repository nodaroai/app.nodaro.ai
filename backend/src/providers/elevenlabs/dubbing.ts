import type { ReconcileOpts } from "../provider.interface.js"
import { ELEVENLABS_BASE_URL, getElevenLabsHeaders, fetchMediaFromUrl } from "./client.js"
import { fireOnTaskCreated } from "../../lib/reconcile/fire-on-task-created.js"
import { providerFetch } from "../egress.js"

/**
 * Byte cap for sources this server buffers into memory before re-uploading to
 * ElevenLabs (their own file cap is 1 GB; we stop well short — a 30-minute
 * video at typical web bitrates fits comfortably). `sourceUrl` dubs are exempt:
 * ElevenLabs fetches those itself and the bytes never pass through us.
 */
export const DUBBING_MAX_SOURCE_BYTES = 500 * 1024 * 1024

/**
 * Accepted dubbed-span ceiling (seconds). The platform's recovery envelope is
 * ~90 min (reconcile MAX_ATTEMPTS x cadence; workflow NODE_TIMEOUT); a longer
 * span would exhaust it and refund while ElevenLabs still bills. Enforced at
 * the route for probeable uploads and post-start (against ElevenLabs' own
 * media_metadata) for sourceUrl / probe-failure spans.
 */
export const DUBBING_MAX_DURATION_SEC = 30 * 60

/** Reserve bucket (seconds) when no duration is probeable at the route. */
export const DUBBING_FALLBACK_SECONDS = 120

/** What to dub — exactly one of `url` (media we fetch + attach as a file, with
 *  its REAL mime/extension) or `sourceUrl` (a public link — YouTube/TikTok/direct
 *  — handed to ElevenLabs verbatim as `source_url`; they fetch it, not us). */
export interface DubbingSource {
  url?: string
  sourceUrl?: string
  /** Real content type of `url` (from classifyMediaSource). Default audio/mpeg. */
  mime?: string
  /** Filename extension for the form part, matching `mime`. Default mp3. */
  ext?: string
}

export interface DubbingOptions {
  sourceLang?: string
  /** Expected number of speakers, 1-20; 0 (the API default) = auto-detect. */
  numSpeakers?: number
  watermark?: boolean
  /**
   * Use a similar ElevenLabs Voice Library voice instead of CLONING the
   * original speaker. The clone (the API default) keeps the source speaker's
   * voice + accent in the target language — for "dub to native-sounding
   * English" use-cases that reads as a strange voice/accent, so this is the
   * lever that fixes it. NOTE (API docs): library voices used this way count
   * toward the workspace's custom-voice slots; with no free slots the dub fails.
   */
  disableVoiceCloning?: boolean
  /**
   * Drop background audio from the final dub — per the API docs this improves
   * dub quality when the source is known to be speech-only (speeches,
   * monologues, voiceovers).
   */
  dropBackgroundAudio?: boolean
  /** Dub only this window of the source (seconds). */
  startTime?: number
  endTime?: number
  /** Render the dubbed VIDEO at the source's original resolution (video dubs). */
  highestResolution?: boolean
  /** Apply ElevenLabs' profanity filter to the dubbed speech. */
  useProfanityFilter?: boolean
  /** Experimental upstream lever: steer the dubbed voices toward an accent. */
  targetAccent?: string
}

export interface DubbingStartResult {
  dubbingId: string
  expectedDurationSec: number
}

export interface DubbingStatus {
  dubbing_id: string
  status: string
  target_languages?: string[]
  error?: string
  /** ElevenLabs' own probe of the source — how we learn the mode (audio vs
   *  video) and billable duration for `source_url` dubs we never fetched. */
  media_metadata?: {
    content_type?: string
    duration?: number
  }
}

export async function startDubbing(
  source: DubbingSource,
  targetLang: string,
  options?: DubbingOptions,
  reconcileOpts?: ReconcileOpts,
): Promise<DubbingStartResult> {
  const headers = getElevenLabsHeaders()

  const formData = new FormData()
  if (source.url) {
    const mediaBuffer = await fetchMediaFromUrl(source.url, DUBBING_MAX_SOURCE_BYTES)
    // REAL mime + extension (audio/mpeg + .mp3 only as the legacy default) —
    // the old audio.mp3-for-everything upload made ElevenLabs treat every
    // video as an audio file, which is why video-in used to yield audio-out.
    const mime = source.mime ?? "audio/mpeg"
    const ext = source.ext ?? "mp3"
    const blob = new Blob([mediaBuffer as BlobPart], { type: mime })
    formData.append("file", blob, `input.${ext}`)
  } else if (source.sourceUrl) {
    formData.append("source_url", source.sourceUrl)
  } else {
    throw new Error("startDubbing requires a media url or a sourceUrl")
  }
  formData.append("target_lang", targetLang)

  if (options?.sourceLang) {
    formData.append("source_lang", options.sourceLang)
  }
  if (options?.numSpeakers != null) {
    formData.append("num_speakers", String(options.numSpeakers))
  }
  if (options?.watermark != null) {
    formData.append("watermark", String(options.watermark))
  }
  if (options?.disableVoiceCloning != null) {
    formData.append("disable_voice_cloning", String(options.disableVoiceCloning))
  }
  if (options?.dropBackgroundAudio != null) {
    formData.append("drop_background_audio", String(options.dropBackgroundAudio))
  }
  if (options?.startTime != null) {
    formData.append("start_time", String(options.startTime))
  }
  if (options?.endTime != null) {
    formData.append("end_time", String(options.endTime))
  }
  if (options?.highestResolution != null) {
    formData.append("highest_resolution", String(options.highestResolution))
  }
  if (options?.useProfanityFilter != null) {
    formData.append("use_profanity_filter", String(options.useProfanityFilter))
  }
  if (options?.targetAccent) {
    formData.append("target_accent", options.targetAccent)
  }

  const response = await providerFetch(
    // Single-purpose funnel → default OUR key inside (caller passes no meta).
    { provider: "elevenlabs", operation: "dubbing.start", modelKey: reconcileOpts?.modelKey ?? "elevenlabs-dubbing", body: undefined, dimensions: reconcileOpts?.dimensions ?? {} },
    `${ELEVENLABS_BASE_URL}/v1/dubbing`,
    {
      method: "POST",
      headers,
      body: formData,
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing start failed (${response.status}): ${errorText}`)
  }

  const result = (await response.json()) as { dubbing_id: string; expected_duration_sec: number }
  await fireOnTaskCreated(reconcileOpts, result.dubbing_id, "[elevenlabs/dubbing]")
  return {
    dubbingId: result.dubbing_id,
    expectedDurationSec: result.expected_duration_sec,
  }
}

export async function pollDubbingStatus(dubbingId: string): Promise<DubbingStatus> {
  const headers = getElevenLabsHeaders()

  const response = await providerFetch(
    { provider: "elevenlabs", operation: "dubbing.status", modelKey: null, body: undefined, dimensions: {} },
    `${ELEVENLABS_BASE_URL}/v1/dubbing/${dubbingId}`,
    {
      method: "GET",
      headers,
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing status check failed (${response.status}): ${errorText}`)
  }

  return (await response.json()) as DubbingStatus
}

/**
 * Download the finished dub. The SAME endpoint serves both modes — for an
 * audio dub it returns the dubbed audio, for a video dub the dubbed VIDEO —
 * `videoMode` only shapes the Accept header and the caller's file handling.
 */
export async function downloadDubbedMedia(dubbingId: string, langCode: string, videoMode = false): Promise<Buffer> {
  const headers = getElevenLabsHeaders()

  const response = await providerFetch(
    { provider: "elevenlabs", operation: "dubbing.audio", modelKey: null, body: undefined, dimensions: {} },
    `${ELEVENLABS_BASE_URL}/v1/dubbing/${dubbingId}/audio/${langCode}`,
    {
      method: "GET",
      headers: {
        ...headers,
        Accept: videoMode ? "video/mp4" : "audio/mpeg",
      },
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs Dubbing download failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Poll dubbing status until complete or timeout. Returns the final status.
 *
 * `throwOnTimeout: false` returns the LAST in-flight status instead of
 * throwing when the budget runs out — for the worker's park-to-reconcile
 * policy, where a timeout is a normal handoff (the job is still dubbing and
 * the reconcile lane will deliver it), never a fail+refund while ElevenLabs
 * is still working and will still bill.
 */
export async function waitForDubbing(
  dubbingId: string,
  onProgress?: (status: string) => void,
  maxWaitMs = 600_000,
  intervalMs = 10_000,
  opts?: { throwOnTimeout?: boolean },
): Promise<DubbingStatus> {
  const start = Date.now()

  let last: DubbingStatus | undefined
  while (Date.now() - start < maxWaitMs) {
    const status = await pollDubbingStatus(dubbingId)
    last = status
    onProgress?.(status.status)

    if (status.status === "dubbed") return status
    if (status.status === "failed") {
      throw new Error(`Dubbing failed: ${status.error ?? "Unknown error"}`)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  if (opts?.throwOnTimeout === false && last) return last
  throw new Error(`Dubbing timed out after ${maxWaitMs / 1000}s`)
}
