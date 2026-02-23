import { config } from "../../lib/config.js"

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"

function resolveModel(provider?: string): string {
  if (provider === "elevenlabs-v3") return "eleven_v3"
  if (provider === "elevenlabs-multilingual") return "eleven_multilingual_v2"
  return "eleven_turbo_v2_5"
}

/** Strip [audio tags] from text — v2 models speak them as literal text */
export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]]+\]/g, "").replace(/\s{2,}/g, " ").trim()
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

  const isV3 = provider === "elevenlabs-v3"

  // v3 only supports stability — similarity_boost, style, speed are deprecated
  const voiceSettings: Record<string, number> = {
    stability: options?.stability ?? 0.5,
  }
  if (!isV3) {
    voiceSettings.similarity_boost = options?.similarityBoost ?? 0.75
    voiceSettings.style = options?.style ?? 0
    if (options?.speed != null) {
      voiceSettings.speed = options.speed
    }
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
