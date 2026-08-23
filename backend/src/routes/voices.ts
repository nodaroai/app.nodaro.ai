import type { FastifyInstance } from "fastify"
import type { TtsProvider } from "@nodaro/shared"
import { config } from "../lib/config.js"
import { registerVoiceLookup } from "../providers/kie/audio.js"
import { describeLimitedVoices } from "../providers/provider-keys.js"
import { ELEVENLABS_BASE_URL } from "../providers/elevenlabs/client.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

// ---------------------------------------------------------------------------
// In-memory cache (6-hour TTL, stampede-safe)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
let cachedVoices: ElevenLabsVoice[] | null = null
let cacheTimestamp = 0
let inflight: Promise<ElevenLabsVoice[]> | null = null

// ---------------------------------------------------------------------------
// Fallback voices (mirrors frontend TTS_VOICES when no API key)
// ---------------------------------------------------------------------------

// Curated "premade" voice catalog (mirrors frontend/src/lib/tts-voices.ts) —
// all text-to-speech requests route through the direct ElevenLabs API (never
// KIE); voices accepted by name, plus Adam, Bella & Harry via their ElevenLabs
// UUIDs.
//
// Previews + descriptions are baked in (#862): without a key this list IS the
// picker, and a picker you cannot audition is the picker's core function
// missing. The preview files are ElevenLabs' public premade CDN objects
// (storage.googleapis.com/eleven-public-prod) — the API key is needed to LIST
// them, never to PLAY them — so every install gets play + descriptions with no
// key, no credits, no request at render time. Entries marked "retired
// upstream" no longer exist in the ElevenLabs catalog (no preview to offer);
// they stay because stored node data still references them by name, with the
// descriptions the catalog carried for them.
const FALLBACK_VOICES: ElevenLabsVoice[] = [
  // Female voices
  { voice_id: "Alice", name: "Alice", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3", gender: "female", accent: "British", age: "middle_aged", description: "Clear and engaging, friendly woman with a British accent suitable for e-learning.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Aria", name: "Aria", preview_url: "", /* retired upstream */ gender: "female", accent: "American", age: "young", description: "Expressive and sassy, with a youthful energy.", use_case: "social_media", category: "premade" },
  { voice_id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/hpp4J3VqNfWAUOO0d1Us/dab0f5ba-3aa4-48a8-9fad-f138fea1126d.mp3", gender: "female", accent: "American", age: "middle_aged", description: "This voice is warm, bright, and professional, characterized by a Standard American accent and a polished, narrative quality. It features a medium-high pitch with crisp diction and a deliberate, rhythmic pace that makes it highly intelligible and engaging for long-form listening.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Charlotte", name: "Charlotte", preview_url: "", /* retired upstream */ gender: "female", accent: "English-Swedish", age: "young", description: "Smooth, intimate and seductive — built for character work.", use_case: "characters_animation", category: "premade" },
  { voice_id: "Jessica", name: "Jessica", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3", gender: "female", accent: "American", age: "young", description: "Young and popular, this playful American female voice is perfect for trendy content.", use_case: "conversational", category: "premade" },
  { voice_id: "Laura", name: "Laura", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3", gender: "female", accent: "American", age: "young", description: "This young adult female voice delivers sunny enthusiasm with a quirky attitude.", use_case: "social_media", category: "premade" },
  { voice_id: "Lily", name: "Lily", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3", gender: "female", accent: "British", age: "middle_aged", description: "Velvety British female voice delivers news and narrations with warmth and clarity.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Matilda", name: "Matilda", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3", gender: "female", accent: "American", age: "middle_aged", description: "A professional woman with a pleasing alto pitch. Suitable for many use cases.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Rachel", name: "Rachel", preview_url: "", /* retired upstream */ gender: "female", accent: "American", age: "young", description: "Calm, clear and reassuring — the default narrator.", use_case: "narrative_story", category: "premade" },
  { voice_id: "Sarah", name: "Sarah", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3", gender: "female", accent: "American", age: "young", description: "Young adult woman with a confident and warm, mature quality and a reassuring, professional tone.", use_case: "entertainment_tv", category: "premade" },

  // Male voices
  { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3", gender: "male", accent: "American", age: "middle_aged", description: "A bright tenor pitch that immediately cuts through. The delivery is brash and openly confident, speaking with unwavering certainty and a slightly aggressive self-assurance.", use_case: "social_media", category: "premade" },
  { voice_id: "Bill", name: "Bill", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3", gender: "male", accent: "American", age: "old", description: "Friendly and comforting voice ready to narrate your stories.", use_case: "advertisement", category: "premade" },
  { voice_id: "Brian", name: "Brian", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/nPczCjzI2devNBz1zQrb/2dd3e72c-4fd3-42f1-93ea-abc5d4e5aa1d.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Middle-aged man with a resonant and comforting tone. Great for narrations and advertisements.", use_case: "social_media", category: "premade" },
  { voice_id: "Callum", name: "Callum", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/N2lVS1w4EtoT3dr4eOWO/ac833bd8-ffda-4938-9ebc-b0f99ca25481.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Deceptively gravelly, yet unsettling edge.", use_case: "characters_animation", category: "premade" },
  { voice_id: "Charlie", name: "Charlie", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3", gender: "male", accent: "Australian", age: "young", description: "A young Australian male with a confident and energetic voice.", use_case: "conversational", category: "premade" },
  { voice_id: "Chris", name: "Chris", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/3f4bde72-cc48-40dd-829f-57fbf906f4d7.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Natural and real, this down-to-earth voice is great across many use-cases.", use_case: "conversational", category: "premade" },
  { voice_id: "Daniel", name: "Daniel", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/7eee0236-1a72-4b86-b303-5dcadc007ba9.mp3", gender: "male", accent: "British", age: "middle_aged", description: "A strong voice perfect for delivering a professional broadcast or news story.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Eric", name: "Eric", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cjVigY5qzO86Huf0OWal/d098fda0-6456-4030-b3d8-63aa048c9070.mp3", gender: "male", accent: "American", age: "middle_aged", description: "A smooth tenor pitch from a man in his 40s - perfect for agentic use cases.", use_case: "conversational", category: "premade" },
  { voice_id: "George", name: "George", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/JBFqnCBsd6RMkjVDRZzb/e6206d1a-0721-4787-aafb-06a6e705cac5.mp3", gender: "male", accent: "British", age: "middle_aged", description: "Warm resonance that instantly captivates listeners.", use_case: "narrative_story", category: "premade" },
  { voice_id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SOYHLrjzK2X1ezoPC6cr/86d178f6-f4b6-4e0e-85be-3de19f490794.mp3", gender: "male", accent: "American", age: "young", description: "An animated warrior ready to charge forward.", use_case: "characters_animation", category: "premade" },
  { voice_id: "Liam", name: "Liam", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/63148076-6363-42db-aea8-31424308b92c.mp3", gender: "male", accent: "American", age: "young", description: "A young adult with energy and warmth - suitable for reels and shorts.", use_case: "social_media", category: "premade" },
  { voice_id: "Roger", name: "Roger", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Easy going and perfect for casual conversations.", use_case: "conversational", category: "premade" },
  { voice_id: "Will", name: "Will", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3", gender: "male", accent: "American", age: "young", description: "Conversational and laid back.", use_case: "conversational", category: "premade" },

  // Non-binary (ElevenLabs labels the gender "neutral"; the picker buckets it as Other)
  { voice_id: "River", name: "River", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SAz9YHcvj6GT2YYXdXww/e6c95f0b-2227-491a-b3d7-2249240decb7.mp3", gender: "neutral", accent: "American", age: "middle_aged", description: "A relaxed, neutral voice ready for narrations or conversational projects.", use_case: "conversational", category: "premade" },
]

// ---------------------------------------------------------------------------
// Fetch from ElevenLabs API
// ---------------------------------------------------------------------------

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

async function getVoices(): Promise<ElevenLabsVoice[]> {
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

// ---------------------------------------------------------------------------
// Shared voices search cache (5-min TTL, max 200 entries)
// ---------------------------------------------------------------------------

interface SharedVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
  recommendedProvider?: TtsProvider
  verifiedProviders?: TtsProvider[]
}

/**
 * Map a Voice Library entry's verified ElevenLabs models to the TTS
 * providers the voice is actually verified on. v3 is checked FIRST so it
 * wins the `recommendedProvider = verified[0]` pick whenever the voice
 * supports it — v3 is the fully-multilingual default and renders any voice
 * unmodified, so it's strictly preferable to a v2 model when available.
 * Library previews are rendered with the voice's verified models — generating
 * with an unverified model is what makes output drift audibly from the
 * preview. Clients without a provider picker send `verified[0]` back as the
 * text-to-speech `provider` (credits then reserve at the correct per-provider
 * price up front; v3=3cr, turbo=2cr, multilingual=3cr); clients with a picker
 * only snap when the current choice isn't in the set.
 *
 * Exact-substring match on "eleven_v3" so it doesn't accidentally match
 * "eleven_turbo_v2_5" / "eleven_flash_v2_5" / "eleven_multilingual_v2".
 */
export function deriveVerifiedTtsProviders(modelIds: readonly string[]): TtsProvider[] {
  const verified: TtsProvider[] = []
  if (modelIds.some((m) => m.includes("eleven_v3"))) verified.push("elevenlabs-v3")
  if (modelIds.some((m) => m.includes("turbo") || m.includes("flash"))) verified.push("elevenlabs-turbo")
  if (modelIds.some((m) => m.includes("multilingual_v2"))) verified.push("elevenlabs-multilingual")
  return verified
}

interface SharedVoiceCacheEntry {
  data: { voices: SharedVoice[]; hasMore: boolean }
  expiresAt: number
}

const SHARED_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const SHARED_CACHE_MAX = 200
const sharedVoiceCache = new Map<string, SharedVoiceCacheEntry>()

function getSharedCacheKey(params: Record<string, string | undefined>): string {
  return JSON.stringify(params)
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function voicesRoutes(app: FastifyInstance) {
  app.get("/v1/voices", async (_req, reply) => {
    const voices = await getVoices()
    // Keyless: the static list still serves generation (TTS runs through the
    // connection or a later-added key), but say WHY it is limited instead of
    // pretending — the silent fallback read as "the picker is just poor"
    // (#647). no-store so adding the key doesn't leave the notice cached.
    if (!config.ELEVENLABS_API_KEY) {
      reply.header("Cache-Control", "no-store")
      return reply.send({ voices, keyMissing: true, hint: describeLimitedVoices() })
    }
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    return reply.send({ voices })
  })

  app.get("/v1/voices/library", async (req, reply) => {
    // No API key — empty, but SAY so (#647): the bare empty tab read as a
    // broken search rather than a missing key.
    if (!config.ELEVENLABS_API_KEY) {
      return reply.send({ voices: [], hasMore: false, keyMissing: true, hint: describeLimitedVoices() })
    }

    const query = req.query as Record<string, string | undefined>
    const params: Record<string, string | undefined> = {
      search: query.search,
      gender: query.gender,
      age: query.age,
      accent: query.accent,
      language: query.language,
      category: query.category,
      use_cases: query.use_cases,
      descriptives: query.descriptives,
      featured: query.featured,
      sort: query.sort,
      page: query.page || "0",
      page_size: query.page_size || "30",
    }

    // Clamp page_size
    const pageSize = Math.min(Math.max(1, parseInt(params.page_size || "30", 10) || 30), 100)
    params.page_size = String(pageSize)

    // Check cache
    const cacheKey = getSharedCacheKey(params)
    const cached = sharedVoiceCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return reply.send(cached.data)
    }

    try {
      // Build query string for ElevenLabs shared-voices API
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v) qs.set(k, v)
      }

      const res = await fetch(
        `${ELEVENLABS_BASE_URL}/v1/shared-voices?${qs.toString()}`,
        {
          headers: {
            "xi-api-key": config.ELEVENLABS_API_KEY,
            Accept: "application/json",
          },
        },
      )

      if (!res.ok) {
        console.error(`[voices/library] ElevenLabs API error: ${res.status}`)
        return reply.send({ voices: [], hasMore: false })
      }

      const data = (await res.json()) as {
        voices: Array<{
          voice_id: string
          name: string
          preview_url?: string
          gender?: string
          accent?: string
          age?: string
          description?: string
          use_case?: string
          category?: string
          verified_languages?: Array<{ model_id?: string }>
        }>
        has_more?: boolean
      }

      const voices: SharedVoice[] = data.voices.map((v) => {
        const modelIds = (v.verified_languages ?? [])
          .map((l) => l.model_id)
          .filter((m): m is string => typeof m === "string")
        const verifiedProviders = deriveVerifiedTtsProviders(modelIds)
        return {
          voice_id: v.voice_id,
          name: v.name,
          preview_url: v.preview_url ?? "",
          gender: v.gender ?? "",
          accent: v.accent ?? "",
          age: v.age ?? "",
          description: v.description ?? "",
          use_case: v.use_case ?? "",
          category: v.category ?? "",
          ...(verifiedProviders.length > 0
            ? { recommendedProvider: verifiedProviders[0], verifiedProviders }
            : {}),
        }
      })

      const result = { voices, hasMore: data.has_more ?? false }

      // Cache result (clear all on overflow)
      if (sharedVoiceCache.size >= SHARED_CACHE_MAX) {
        sharedVoiceCache.clear()
      }
      sharedVoiceCache.set(cacheKey, { data: result, expiresAt: Date.now() + SHARED_CACHE_TTL_MS })

      return reply.send(result)
    } catch (err) {
      console.error("[voices/library] Failed to fetch shared voices:", (err as Error).message)
      return reply.send({ voices: [], hasMore: false })
    }
  })
}
