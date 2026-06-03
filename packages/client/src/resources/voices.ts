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
    removeBackgroundNoise?: boolean
  }): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/voice-changer", { body: input })
  }
}
