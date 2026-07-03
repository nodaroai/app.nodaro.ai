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

/**
 * True when the identifier is one of the 21 premade voice names or their
 * UUIDs. Lets callers (e.g. the community snapshot adapter) classify legacy
 * voice records that predate `voiceType` without keeping a second voice list.
 */
export function isKnownPremadeVoiceRef(voice: string): boolean {
  return PREMADE_VOICE_IDS[voice] !== undefined || KNOWN_PREMADE_UUIDS.has(voice)
}

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
  /**
   * Retry with the default premade voice (Rachel) when ElevenLabs reports
   * voice_not_found. ONLY for LLM-originated requests (MCP), where the voice
   * id may be hallucinated and any audio beats a hard error. User-picked
   * voices must fail loudly — silently substituting a different voice is how
   * "the voice sounds wrong" bugs hide.
   */
  allowDefaultVoiceFallback?: boolean
}

// ---------------------------------------------------------------------------
// Stored voice settings (preview fidelity)
// ---------------------------------------------------------------------------
// When the caller doesn't override any slider we OMIT voice_settings so
// ElevenLabs applies the voice's own stored/tuned settings — the ones its
// Voice Library preview was rendered with (confirmed API semantics: settings
// in the request "override stored settings for the given voice ... applied
// only on the given request"). When the caller overrides only SOME sliders we
// merge them over the stored settings; otherwise one tweaked slider would
// silently reset the rest (incl. use_speaker_boost) to generic defaults and
// the output drifts audibly from the preview.

interface StoredVoiceSettings {
  stability?: number
  similarity_boost?: number
  style?: number
  speed?: number
  use_speaker_boost?: boolean
}

const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000
const SETTINGS_CACHE_MAX = 500
const storedSettingsCache = new Map<string, { value: StoredVoiceSettings | null; expiresAt: number }>()

// Metadata GET — short bound, it's just a fidelity lookup (never worth hanging a worker for).
const VOICE_SETTINGS_TIMEOUT_MS = 15_000
// Generous bound: 40,000-char turbo narrations legitimately take minutes to synthesize.
// Too-short would be worse than none — better to let real long-form jobs finish than to
// abort them prematurely. Still finite so a hung connection can't idle a worker slot
// until undici's ~300s implicit bound (this IS that bound, made explicit and attributable).
const TTS_GENERATION_TIMEOUT_MS = 300_000

async function fetchStoredVoiceSettings(voiceId: string, apiKey: string): Promise<StoredVoiceSettings | null> {
  const cached = storedSettingsCache.get(voiceId)
  if (cached && Date.now() < cached.expiresAt) return cached.value
  let value: StoredVoiceSettings | null = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VOICE_SETTINGS_TIMEOUT_MS)
  try {
    const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/${voiceId}/settings`, {
      headers: { "xi-api-key": apiKey },
      signal: controller.signal,
    })
    if (res.ok) value = (await res.json()) as StoredVoiceSettings
  } catch {
    // Network failure OR timeout → fall back to API defaults below; never fail the job
    // over a fidelity lookup.
  } finally {
    clearTimeout(timer)
  }
  if (storedSettingsCache.size >= SETTINGS_CACHE_MAX) storedSettingsCache.clear()
  storedSettingsCache.set(voiceId, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS })
  return value
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
  const resolvedVoiceId = resolveDirectVoiceId(voiceId)

  const body: Record<string, unknown> = {
    text,
    model_id: resolveModel(provider),
  }
  if (options?.languageCode) {
    body.language_code = options.languageCode
  }

  const hasExplicitSettings =
    options?.stability != null || options?.similarityBoost != null ||
    options?.style != null || options?.speed != null

  // No explicit sliders → omit voice_settings entirely so ElevenLabs applies
  // the voice's stored/tuned settings (preview fidelity). With sliders, merge
  // them over the stored settings (API-default fallbacks when unavailable).
  if (hasExplicitSettings) {
    const stored = await fetchStoredVoiceSettings(resolvedVoiceId, apiKey)
    // v3 only supports stability — similarity_boost, style, speed are deprecated
    const voiceSettings: Record<string, number | boolean> = {
      stability: options?.stability ?? stored?.stability ?? 0.5,
    }
    if (!isV3) {
      voiceSettings.similarity_boost = options?.similarityBoost ?? stored?.similarity_boost ?? 0.75
      voiceSettings.style = options?.style ?? stored?.style ?? 0
      voiceSettings.use_speaker_boost = stored?.use_speaker_boost ?? true
      const speed = options?.speed ?? stored?.speed
      if (speed != null) voiceSettings.speed = speed
    }
    body.voice_settings = voiceSettings
  }

  async function attempt(vid: string): Promise<Response> {
    // Hard timeout so a stalled connection can never idle a worker slot until undici's
    // ~300s implicit bound — this makes that bound explicit and attributable. Generous
    // because 40k-char turbo narrations legitimately take minutes to synthesize.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TTS_GENERATION_TIMEOUT_MS)
    try {
      return await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-speech/${vid}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`ElevenLabs TTS timed out after ${TTS_GENERATION_TIMEOUT_MS / 1000}s`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  let response = await attempt(resolvedVoiceId)

  // voice_not_found on an unrecognized UUID-shape id: for LLM-originated
  // requests (MCP — the only callers that opt in) the id may be hallucinated,
  // so retry with Rachel rather than hard-error. Everywhere else the voice
  // was explicitly picked by a user — fail loudly with an actionable message;
  // silently substituting a different voice is how "the voice sounds wrong"
  // bugs hide.
  if (
    response.status === 404 &&
    looksLikeUuid(resolvedVoiceId) &&
    !KNOWN_PREMADE_UUIDS.has(resolvedVoiceId)
  ) {
    const errPreview = await response.clone().text().catch(() => "")
    if (errPreview.includes("voice_not_found")) {
      if (options?.allowDefaultVoiceFallback) {
        // eslint-disable-next-line no-console
        console.warn(
          `[elevenlabs] voice_not_found for "${resolvedVoiceId}" (likely ` +
            `LLM hallucination); falling back to Rachel`,
        )
        response = await attempt(PREMADE_VOICE_IDS.Rachel!)
      } else {
        throw new Error(
          `Voice "${voiceId}" was not found on ElevenLabs — it may have been ` +
            `removed from the Voice Library or deleted from your clones. ` +
            `Pick a different voice and try again.`,
        )
      }
    }
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error")
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
