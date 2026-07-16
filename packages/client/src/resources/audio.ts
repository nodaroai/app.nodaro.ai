import type { AudioFxPreset } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Audio primitives — the building blocks Voice Changer Pro composes internally
 * (separation, isolation, effect, mix, level), exposed standalone so a consumer
 * can run any single step or assemble its own pipeline. Each returns a job id to
 * poll (`jobs.get(jobId)`).
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
   * per-track level.
   */
  mix(input: { audioUrls: string[]; trackVolumes?: number[] }): Promise<{ jobId: string }> {
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
}
