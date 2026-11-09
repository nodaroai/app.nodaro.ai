/**
 * The premade ElevenLabs voice catalog as the provider lists it today: what
 * `GET /v1/voices` serves (before the voice lock's filter), and what the lock's
 * resolver (`lib/voice-gender.ts`) reads to know a premade voice the static
 * catalog (`lib/premade-voices.ts`) does not carry. One copy for both, so the
 * picker never offers a premade voice the lock then cannot place.
 *
 * In-memory, 6-hour TTL, stampede-safe. No API key, or a failed fetch: the
 * static catalog.
 */
import { config } from "./config.js"
import { registerVoiceLookup } from "../providers/kie/audio.js"
import { ELEVENLABS_BASE_URL } from "../providers/elevenlabs/client.js"
import { FALLBACK_VOICES, type ElevenLabsVoice } from "./premade-voices.js"

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
let cachedVoices: readonly ElevenLabsVoice[] | null = null
let cacheTimestamp = 0
let inflight: Promise<readonly ElevenLabsVoice[]> | null = null

async function fetchVoicesFromApi(): Promise<ElevenLabsVoice[]> {
  const res = await fetch(
    `${ELEVENLABS_BASE_URL}/v2/voices?category=premade&page_size=100`,
    {
      headers: {
        "xi-api-key": config.ELEVENLABS_API_KEY,
        Accept: "application/json",
      },
    },
  )

  if (!res.ok) {
    throw new Error(`ElevenLabs API error: ${res.status}`)
  }

  const data = (await res.json()) as {
    voices: Array<{
      voice_id: string
      name: string
      preview_url: string
      labels?: Record<string, string>
      description?: string
      use_case?: string
      category?: string
    }>
  }

  return data.voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    preview_url: v.preview_url ?? "",
    gender: v.labels?.gender ?? "",
    accent: v.labels?.accent ?? "",
    age: v.labels?.age ?? "",
    description: v.labels?.description ?? v.description ?? "",
    use_case: v.labels?.use_case ?? v.use_case ?? "",
    category: v.category ?? "premade",
  }))
}

export async function getPremadeVoices(): Promise<readonly ElevenLabsVoice[]> {
  // No API key — return static fallback
  if (!config.ELEVENLABS_API_KEY) {
    registerVoiceLookup(FALLBACK_VOICES)
    return FALLBACK_VOICES
  }

  const now = Date.now()

  // Return cached if still valid
  if (cachedVoices && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedVoices
  }

  // Stampede protection
  if (inflight) return inflight

  inflight = fetchVoicesFromApi()
    .then((voices) => {
      cachedVoices = voices
      cacheTimestamp = Date.now()
      // Populate KIE voice UUID→name lookup so TTS can resolve IDs
      registerVoiceLookup(voices)
      return voices
    })
    .catch((err) => {
      console.error("[voices] ElevenLabs API failed, using fallback:", err.message)
      return FALLBACK_VOICES
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
