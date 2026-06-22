import type { Voice, VoiceClone, VoiceLibraryParams, VoiceLibraryResponse } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Re-export the shared voice types so SDK consumers don't have to add
 * `@nodaro/shared` as a second dependency just to type a `Voice` row, a
 * `VoiceClone`, or a `searchLibrary` call. Single source of truth lives in
 * `@nodaro/shared`.
 */
export type { Voice, SharedVoice, VoiceClone, VoiceLibraryParams, VoiceLibraryResponse } from "@nodaro/shared"

/**
 * Read access to ElevenLabs voices: the premade catalog plus the shared
 * community Voice Library (both public GETs, no body), and the signed-in
 * user's own voice clones (list / create-from-url / delete).
 */
export class VoicesResource {
  constructor(private client: NodaroClient) {}

  /**
   * List the premade ElevenLabs voices (`GET /v1/voices`). Falls back to a
   * curated set server-side when no ElevenLabs API key is configured.
   */
  async list(): Promise<Voice[]> {
    const res = await this.client.request<{ voices: Voice[] }>("GET", "/v1/voices")
    return res.voices
  }

  /**
   * Search the shared/community Voice Library (`GET /v1/voices/library`). All
   * params are optional and forwarded as a querystring; `undefined` / `null` /
   * empty-string values are omitted so the server defaults apply. `hasMore`
   * drives "load more" pagination.
   */
  searchLibrary(params: VoiceLibraryParams = {}): Promise<VoiceLibraryResponse> {
    const query: Record<string, string | number | boolean | undefined> = {}
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") query[k] = v as string | number | boolean
    }
    return this.client.request("GET", "/v1/voices/library", { query })
  }

  /**
   * List the signed-in user's voice clones (`GET /v1/voice-clones`). The route
   * wraps the rows in `{ voiceClones }`; we unwrap to the bare array.
   */
  async listClones(): Promise<VoiceClone[]> {
    const res = await this.client.request<{ voiceClones: VoiceClone[] }>("GET", "/v1/voice-clones")
    return res.voiceClones
  }

  /**
   * Clone a voice from an already-uploaded audio URL
   * (`POST /v1/voice-clones/from-url`). Costs credits. Returns the create
   * subset of `VoiceClone` (`elevenlabsVoiceId` is the id to use at
   * text-to-speech time).
   */
  createClone(input: { name: string; audioUrl: string }): Promise<VoiceClone> {
    return this.client.request<VoiceClone>("POST", "/v1/voice-clones/from-url", { body: input })
  }

  /** Delete one of the user's voice clones (`DELETE /v1/voice-clones/:id`). */
  async deleteClone(id: string): Promise<void> {
    await this.client.request<void>("DELETE", `/v1/voice-clones/${encodeURIComponent(id)}`)
  }

  /**
   * Replace the voice in a recording — or in a whole talking video — with a
   * different voice (`POST /v1/voice-changer`). Pass `audioUrl` to revoice
   * audio→audio, or `videoUrl` to revoice an entire clip (the server demuxes
   * the audio, runs speech-to-speech, and remuxes onto the original video,
   * returning the video plus the new audio track). Exactly one of `audioUrl` /
   * `videoUrl` is required; when both are sent, video wins. `removeBackgroundNoise`
   * off keeps the music/SFX bed under the new voice; on yields a clean voice-only
   * result. Costs credits and runs async — poll `jobs.get(jobId)` for the result
   * (`output_data.videoUrl` + `output_data.audioUrl` in video mode).
   */
  change(input: {
    voiceId: string
    audioUrl?: string
    videoUrl?: string
    stability?: number
    similarityBoost?: number
    /** Style exaggeration (0–1). Default 0; >0 amplifies delivery at the cost of latency/stability. */
    style?: number
    removeBackgroundNoise?: boolean
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-changer", { body: input })
  }

  /**
   * Recast each detected speaker in a multi-speaker recording to a different
   * voice (`POST /v1/voice-recast`). `orderedVoices` maps speaker positions to
   * voices in detection order — speaker 0 → `orderedVoices[0]`, speaker 1 →
   * `orderedVoices[1]`, etc. Speakers beyond the end of `orderedVoices` keep
   * their original voice. Each entry is EITHER a bare voice id (premade name or
   * ElevenLabs UUID) OR a {@link VoiceRecastVoice} object carrying per-voice
   * ElevenLabs speech-to-speech settings (stability / similarityBoost / style /
   * useSpeakerBoost) plus a loudness `volumeMode` (and a manual `volume`).
   *
   * Pass `audioUrl` for audio-only recast or `videoUrl` to recast the audio
   * track of a video clip (the server demuxes, recasts, and remuxes).
   *
   * Voice and music are ALWAYS separated first — ElevenLabs only ever sees the
   * isolated vocal stem, never the music bed. `preserveBackground` (default
   * `true`) only controls whether that music/instrumental stem is mixed back
   * under the new voices; set it `false` for a clean voice-only result.
   * `separationQuality` selects the demucs model used for that split: `"fast"`
   * (default, htdemucs — preserves more of the voice) or `"best"` (htdemucs_ft —
   * finer separation). `removeBackgroundNoise` additionally denoises the result.
   *
   * Cloud-only — costs credits and runs async; poll `jobs.get(jobId)` for the
   * result (`output_data.videoUrl` + `output_data.audioUrl` in video mode).
   */
  recast(input: VoiceRecastInput): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-recast", { body: input })
  }
}

/**
 * One entry in {@link VoiceRecastInput.orderedVoices}. Either a bare voice id
 * (premade name like `"Rachel"` or an ElevenLabs UUID for a custom clone), or
 * an object pinning per-voice speech-to-speech settings and the recast's
 * loudness behaviour for that speaker.
 */
export type VoiceRecastVoice =
  | string
  | {
      /** Target voice — premade name (`"Rachel"`, `"Aria"`, …) or an ElevenLabs UUID for a custom clone. */
      voiceId: string
      /** ElevenLabs stability (0–1). Higher = steadier, lower = more expressive. */
      stability?: number
      /** ElevenLabs similarity boost (0–1) — how closely the output hugs the target voice's timbre. */
      similarityBoost?: number
      /** Style exaggeration (0–1). Default 0; >0 amplifies delivery at the cost of latency / stability. */
      style?: number
      /** ElevenLabs speaker boost — sharpens fidelity to the target speaker. */
      useSpeakerBoost?: boolean
      /**
       * Loudness handling for this recast voice. `"match"` (default) matches the
       * original speaker's loudness; `"normalize"` applies EBU R128 loudnorm;
       * `"manual"` uses `volume` as a percentage.
       */
      volumeMode?: "match" | "normalize" | "manual"
      /** Manual output volume as a percentage (0–200). Consulted only when `volumeMode === "manual"`. */
      volume?: number
    }

/** Input for {@link VoicesResource.recast}. */
export interface VoiceRecastInput {
  /** URL of an audio file to recast (audio → audio). Exactly one of `audioUrl` / `videoUrl` is required. */
  audioUrl?: string
  /** URL of a video file to recast (the audio track is recast and remuxed). Exactly one of `audioUrl` / `videoUrl` is required. */
  videoUrl?: string
  /**
   * Voices in speaker-detection order. Speaker N is mapped to `orderedVoices[N]`;
   * speakers beyond the array keep their original voice. Each entry is a bare
   * voice id OR a {@link VoiceRecastVoice} object with per-voice settings.
   */
  orderedVoices: Array<VoiceRecastVoice>
  /** Model to use for speech-to-speech. Defaults to the server-configured default when omitted. */
  model?: string
  /**
   * Mix the separated music / SFX stem back under the recast voices. Default
   * `true`. The voice is ALWAYS split out before recasting regardless of this
   * flag — `false` simply drops the music for a clean voice-only result.
   */
  preserveBackground?: boolean
  /**
   * Demucs model used to split voice from music. `"fast"` (default, htdemucs —
   * preserves more of the voice) or `"best"` (htdemucs_ft — finer separation).
   */
  separationQuality?: "fast" | "best"
  /** Strip background noise for a clean voice-only result. */
  removeBackgroundNoise?: boolean
}
