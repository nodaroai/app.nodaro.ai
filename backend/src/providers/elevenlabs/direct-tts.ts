import { config } from "../../lib/config.js"

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"

function resolveModel(provider?: string): string {
  if (provider === "elevenlabs-multilingual") return "eleven_multilingual_v2"
  return "eleven_turbo_v2_5"
}

export interface DirectTTSOptions {
  stability?: number
  similarityBoost?: number
  style?: number
  speed?: number
  languageCode?: string
}

export async function directElevenLabsTTS(
  text: string,
  voiceId: string,
  provider?: string,
  options?: DirectTTSOptions,
): Promise<Buffer> {
  const apiKey = config.ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured")
  }

  const voiceSettings: Record<string, number> = {
    stability: options?.stability ?? 0.5,
    similarity_boost: options?.similarityBoost ?? 0.75,
    style: options?.style ?? 0,
  }
  if (options?.speed != null) {
    voiceSettings.speed = options.speed
  }

  const body: Record<string, unknown> = {
    text,
    model_id: resolveModel(provider),
    voice_settings: voiceSettings,
  }
  if (options?.languageCode) {
    body.language_code = options.languageCode
  }

  const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
