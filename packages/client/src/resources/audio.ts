import type { AudioFxPreset, TranscribeProvider, Transcript } from "@nodaro/shared"
export type { TranscribeProvider } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * One word of a {@link AudioResource.transcribe} result — caption-shaped, in
 * MILLISECONDS, and structurally the `captions[]` entry `media.addCaptions()`
 * takes, so a word list can be passed straight through. `speaker` is present
 * only on a diarized `elevenlabs-stt` run.
 */
export interface TranscribeWord {
  text: string
  startMs: number
  endMs: number
  timestampMs?: number | null
  confidence?: number | null
  speaker?: string
}

/**
 * A completed transcribe job's `output_data` (read it off `jobs.get(jobId)`).
 *
 * Mind the units: `words` and `json.words` are in MILLISECONDS, while the
 * top-level `segments` are in SECONDS (the raw per-utterance ranges) — present
 * only on the legacy lanes; `elevenlabs-stt` returns none, so read `words`.
 */
export interface TranscribeJobOutput {
  /** The full transcript as one string. */
  text: string
  /** Detected (or requested) language code. */
  language?: string
  /** Per-word timings, ms — present on the word-level lanes. */
  words?: TranscribeWord[]
  /** The normalized {@link Transcript} (ms), the shape `edit.*` consumes. */
  json?: Transcript
  /** Per-utterance ranges in SECONDS — not ms, unlike everything above. */
  segments?: Array<{ start: number; end: number; text: string }>
}

/**
 * Audio primitives — the building blocks Voice Changer Pro composes internally
 * (separation, isolation, effect, mix, level) plus speech-to-text, exposed
 * standalone so a consumer can run any single step or assemble its own
 * pipeline. Each returns a job id to poll (`jobs.get(jobId)`).
 */
export class AudioResource {
  constructor(private client: NodaroClient) {}

  /**
   * Separate an audio track into stems (`POST /v1/audio-separation`, Demucs).
   * `mode` `"vocal_instrumental"` (default) splits voice from music/SFX;
   * `"stems"` returns the full drums/bass/other/… breakdown. `quality`
   * `auto` (default) / `fast` / `best`.
   */
  separate(input: { audioUrl: string; mode?: "vocal_instrumental" | "stems"; quality?: "auto" | "fast" | "best" }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/audio-separation", { body: input })
  }

  /** Isolate the primary voice and strip background noise (`POST /v1/audio-isolation`, ElevenLabs). */
  isolate(input: { audioUrl: string }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/audio-isolation", { body: input })
  }

  /**
   * Apply a reverb / echo / telephone / megaphone effect to an audio track
   * (`POST /v1/audio-fx`) — the same presets VCP's `voiceFx` uses, standalone.
   * `mix` (0–100) is the reverb wet/dry; `delayMs` + `decay` drive `echo`/`custom`;
   * `eqLow`/`eqHigh` (dB) shape telephone/megaphone.
   */
  applyFx(input: {
    audioUrl: string
    preset?: AudioFxPreset
    mix?: number
    delayMs?: number
    decay?: number
    eqLow?: number
    eqHigh?: number
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/audio-fx", { body: input })
  }

  /**
   * Layer multiple audio tracks into one (`POST /v1/mix-audio`). `audioUrls`
   * (2–20) are summed; optional `trackVolumes` (0–200% each, positionally) set
   * per-track level. `duck` puts a music bed under speech: every track EXCEPT
   * `duck.under` (the 0-based index of the voice track) dips while that track
   * is loud and rises back in its pauses (sidechain compression). `amount`
   * (0–100, default 75) is how hard; `thresholdDb` (-60–0, default -30),
   * `ratio` (1–20, overrides `amount`), `attackMs` (1–2000, default 20) and
   * `releaseMs` (10–9000, default 500) are optional fine controls. A ducked mix
   * sums its tracks rather than averaging them, so the voice keeps its level;
   * the price is the same with or without a duck.
   */
  mix(input: {
    audioUrls: string[]
    trackVolumes?: number[]
    duck?: {
      under: number
      amount?: number
      thresholdDb?: number
      ratio?: number
      attackMs?: number
      releaseMs?: number
    }
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/mix-audio", { body: input })
  }

  /**
   * Adjust an audio (or a video's audio) level (`POST /v1/adjust-volume`):
   * `volume` % (default 100), `normalize` to loudnorm, and `fadeIn`/`fadeOut`
   * seconds. Provide `audioUrl` or `videoUrl`.
   */
  adjustVolume(input: {
    audioUrl?: string
    videoUrl?: string
    volume?: number
    normalize?: boolean
    fadeIn?: number
    fadeOut?: number
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/adjust-volume", { body: input })
  }

  /**
   * Concatenate audio segments end-to-end (`POST /v1/combine-audio`). Each
   * segment is a `url` with an optional `[startTime, endTime]` sub-range.
   */
  combine(input: { segments: Array<{ url: string; startTime?: number; endTime?: number }> }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/combine-audio", { body: input })
  }

  /**
   * Transcribe an audio (or video) track to text (`POST /v1/transcribe`).
   *
   * Three engines are accepted. `elevenlabs-stt` (Scribe) is always word-level,
   * flag or not, and is the only lane that honours `diarize` (who spoke) and
   * `tagAudioEvents` (laughter, applause, …); `incredibly-fast-whisper` returns
   * word timings when you ask for them. `whisper` returns NO word timings at
   * all — named explicitly or reached by OMITTING `provider`, which still falls
   * back to it — so asking it for them (`wordTimestamps: true`) is rejected with
   * a `400 validation_error` at ingress, before any credit is spent. A kinetic
   * caption render therefore has to name one of the other two.
   *
   * Poll `jobs.get(jobId)`; the finished job's `output_data` is a
   * {@link TranscribeJobOutput}: `text` (the whole transcript), `words`
   * (caption-shaped, in MILLISECONDS), `json` (the normalized
   * {@link Transcript}, also ms) — and a top-level `segments` array that is in
   * SECONDS, not ms.
   *
   * `words` is the caption source for a kinetic burn-in: hand it to
   * `media.addCaptions()` as `captions` with `autoTranscribe: false` and the
   * render uses those exact words (correct the `text` of an entry in between
   * and the fix is what burns in).
   */
  transcribe(input: {
    audioUrl: string
    provider?: TranscribeProvider
    language?: string
    diarize?: boolean
    tagAudioEvents?: boolean
    wordTimestamps?: boolean
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/transcribe", { body: input })
  }
}
