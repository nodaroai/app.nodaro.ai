import { ELEVENLABS_BASE_URL, getElevenLabsHeaders } from "./client.js"

/**
 * ElevenLabs Scribe speech-to-text, called DIRECTLY — the sibling of the other
 * `direct-*` providers here, and the last KIE-wrapped ElevenLabs model to move
 * over.
 *
 * WHY: `elevenlabs-stt` used to run through KIE, which wraps this very same
 * Scribe model behind a job queue. That queue is the failure: it stalls
 * ("[500] The upstream API service timed out and no results were returned") and
 * has hung for ~15 min on a stuck task. voice-changer-pro's diarizer already
 * abandoned that path for direct Scribe after exactly that incident and measures
 * ~1-2s on real clips; the public `/v1/transcribe` route never got the same fix,
 * so speaker detection inherited the flakiness. This closes that gap so both
 * callers hit the same, direct API.
 *
 * `source_url` lets Scribe fetch the audio itself, so we never re-download and
 * re-upload the file. A hard timeout aborts a stalled request rather than
 * letting it hang a worker.
 */

/** One transcribed word. `speaker` is populated only when `diarize` is on. */
export interface DirectSttWord {
  text: string
  /** Seconds from the start of the audio. */
  start: number
  end: number
  /** Provider speaker label (e.g. `speaker_0`); `""` when not diarized. */
  speaker: string
}

export interface DirectSttResult {
  text: string
  language: string
  words: DirectSttWord[]
}

export interface DirectSttOptions {
  /** Label each speaker — required for the speaker-detection flow. */
  diarize?: boolean
  /** BCP-47 code; omit (or "auto") to let Scribe detect. */
  languageCode?: string
  /** Annotate non-speech events like [laughter]. */
  tagAudioEvents?: boolean
  /** Hard abort so a stalled request can never hang the worker. */
  timeoutMs?: number
}

/** Scribe v1 was removed upstream 2026-07-09. */
const SCRIBE_MODEL = "scribe_v2"
const DEFAULT_TIMEOUT_MS = 120_000

export async function directSpeechToText(
  audioUrl: string,
  options?: DirectSttOptions,
): Promise<DirectSttResult> {
  const form = new FormData()
  form.append("model_id", SCRIBE_MODEL)
  form.append("source_url", audioUrl)
  if (options?.diarize != null) form.append("diarize", String(options.diarize))
  if (options?.tagAudioEvents != null) {
    form.append("tag_audio_events", String(options.tagAudioEvents))
  }
  if (options?.languageCode && options.languageCode !== "auto") {
    form.append("language_code", options.languageCode)
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    // getElevenLabsHeaders() is xi-api-key only — deliberately NO Content-Type,
    // so fetch sets the multipart boundary for the FormData body.
    response = await fetch(`${ELEVENLABS_BASE_URL}/v1/speech-to-text`, {
      method: "POST",
      headers: getElevenLabsHeaders(),
      body: form,
      signal: controller.signal,
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`ElevenLabs Scribe STT timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(
      `ElevenLabs Scribe STT failed (${response.status}): ${errorText}`,
    )
  }

  const raw = (await response.json()) as {
    text?: string
    language_code?: string
    words?: Array<Record<string, unknown>>
  }

  // Scribe emits `spacing` entries between words — keep only real words, and only
  // those carrying usable timings.
  const words: DirectSttWord[] = (Array.isArray(raw.words) ? raw.words : [])
    .filter(
      (w) =>
        w.type === "word" &&
        typeof w.start === "number" &&
        typeof w.end === "number",
    )
    .map((w) => ({
      text: String(w.text ?? ""),
      start: w.start as number,
      end: w.end as number,
      speaker: String(w.speaker_id ?? ""),
    }))

  return {
    text: raw.text ?? "",
    language: raw.language_code ?? "unknown",
    words,
  }
}
