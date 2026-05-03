import { config } from "../../lib/config.js"

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"

function resolveModel(provider?: string): string {
  if (provider === "elevenlabs-v3") return "eleven_v3"
  if (provider === "elevenlabs-multilingual") return "eleven_multilingual_v2"
  return "eleven_turbo_v2_5"
}

// 21 ElevenLabs premade voices — name → voice_id. KIE's TTS proxy accepts
// these names directly, so the rest of the codebase passes names around.
// The direct ElevenLabs API (/v1/text-to-speech/{voice_id}) requires UUIDs,
// though, so we resolve names → IDs here before the request fires.
// Without this, v3 jobs (which always use the direct API) 404 because
// "Rachel" isn't a valid voice_id path segment.
const PREMADE_VOICE_IDS: Record<string, string> = {
  Rachel: "21m00Tcm4TlvDq8ikWAM",
  Aria: "9BWtsMINqrJLrRacOk9x",
  Roger: "CwhRBWXzGAHq8TQ4Fs17",
  Sarah: "EXAVITQu4vr4xnSDxMaL",
  Laura: "FGY2WhTYpPnrIDTdsKH5",
  Charlie: "IKne3meq5aSn9XLyUdCD",
  George: "JBFqnCBsd6RMkjVDRZzb",
  Callum: "N2lVS1w4EtoT3dr4eOWO",
  River: "SAz9YHcvj6GT2YYXdXww",
  Liam: "TX3LPaxmHKxFdv7VOQHJ",
  Charlotte: "XB0fDUnXU5powFXDhCwa",
  Alice: "Xb7hH8MSUJpSbSDYk0k2",
  Matilda: "XrExE9yKIg1WjnnlVkGX",
  Will: "bIHbv24MWmeRgasZH58o",
  Jessica: "cgSgspJ2msm6clMCkdW9",
  Eric: "cjVigY5qzO86Huf0OWal",
  Chris: "iP95p4xoKVk53GoZ742B",
  Brian: "nPczCjzI2devNBz1zQrb",
  Daniel: "onwK4e9ZLuTAKqWW03F9",
  Lily: "pFZP5JQG7iQjIQuC4Bku",
  Bill: "pqHfZKP75CvOlQylNhV4",
}

/** Resolve a voice name → ElevenLabs UUID. UUIDs pass through unchanged. */
export function resolveDirectVoiceId(voice: string | undefined): string {
  if (!voice) return PREMADE_VOICE_IDS.Rachel!
  return PREMADE_VOICE_IDS[voice] ?? voice
}

/** Set of all known-good premade UUIDs. Used to distinguish a known
 *  premade pass-through from an unknown UUID we shouldn't trust. */
const KNOWN_PREMADE_UUIDS = new Set(Object.values(PREMADE_VOICE_IDS))

/** Heuristic: ElevenLabs UUIDs are 20 alphanumeric chars. Anything
 *  matching the shape but NOT in our known list is either a custom
 *  voice (might be valid) or LLM hallucination (definitely invalid).
 *  We pass it through but the caller should fall back if it 404s. */
function looksLikeUuid(s: string): boolean {
  return /^[A-Za-z0-9]{20}$/.test(s)
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

  const resolvedVoiceId = resolveDirectVoiceId(voiceId)

  async function attempt(vid: string): Promise<Response> {
    return fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-speech/${vid}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify(body),
    })
  }

  let response = await attempt(resolvedVoiceId)

  // Defensive fallback: LLMs sometimes hallucinate UUIDs that look
  // valid (20-char alphanumeric) but aren't real voices. If we passed
  // an unrecognized UUID-shape and ElevenLabs 404'd with
  // voice_not_found, retry with Rachel (the safe default) so the user
  // gets audio back instead of a hard error. Logged so we can spot
  // hallucinations and update the tool description if needed.
  if (
    response.status === 404 &&
    looksLikeUuid(resolvedVoiceId) &&
    !KNOWN_PREMADE_UUIDS.has(resolvedVoiceId)
  ) {
    const errPreview = await response.clone().text().catch(() => "")
    if (errPreview.includes("voice_not_found")) {
      // eslint-disable-next-line no-console
      console.warn(
        `[elevenlabs] voice_not_found for "${resolvedVoiceId}" (likely ` +
          `LLM hallucination); falling back to Rachel`,
      )
      response = await attempt(PREMADE_VOICE_IDS.Rachel!)
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
