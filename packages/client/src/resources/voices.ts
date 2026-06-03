import type { Voice, VoiceLibraryParams, VoiceLibraryResponse } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Re-export the shared voice types so SDK consumers don't have to add
 * `@nodaro/shared` as a second dependency just to type a `Voice` row or a
 * `searchLibrary` call. Single source of truth lives in `@nodaro/shared`.
 */
export type { Voice, SharedVoice, VoiceLibraryParams, VoiceLibraryResponse } from "@nodaro/shared"

/**
 * Read access to ElevenLabs voices: the premade catalog plus the shared
 * community Voice Library. Both routes are public GETs (no body).
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
}
