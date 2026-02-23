import { config } from "../../lib/config.js"

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
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch audio from URL (${response.status})`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
