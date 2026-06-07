import { config } from "../../lib/config.js"
import { safeFetch } from "../../lib/safe-fetch.js"

export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"

export function getElevenLabsApiKey(): string {
  const apiKey = config.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured")
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
