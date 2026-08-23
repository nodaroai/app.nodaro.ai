import { config } from "../../lib/config.js"
import { requireProviderKey } from "../provider-keys.js"
import { safeFetch } from "../../lib/safe-fetch.js"

/** THE ElevenLabs host. Every module that talks to ElevenLabs imports this
 *  one const — a second local copy silently escapes the override. */
export const ELEVENLABS_BASE_URL = config.ELEVENLABS_BASE_URL

export function getElevenLabsApiKey(): string {
  const apiKey = config.ELEVENLABS_API_KEY
  if (!apiKey) {
    requireProviderKey(apiKey, "ELEVENLABS_API_KEY")
  }
  return apiKey
}

export function getElevenLabsHeaders(): Record<string, string> {
  return {
    "xi-api-key": getElevenLabsApiKey(),
  }
}

export async function fetchAudioFromUrl(url: string): Promise<Buffer> {
  // safeFetch: url is user-supplied (dubbing / voice-changer / forced-alignment
  // audioUrl|videoUrl). safeUrlSchema at the route gates literal private hosts;
  // safeFetch blocks DNS-rebinding to internal/metadata IPs at connect time.
  const response = await safeFetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch audio from URL (${response.status})`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
