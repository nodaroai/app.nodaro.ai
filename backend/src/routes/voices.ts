import type { FastifyInstance } from "fastify"
import { config } from "../lib/config.js"

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

const FALLBACK_VOICES: ElevenLabsVoice[] = [
  // Female voices
  { voice_id: "", name: "Alice", preview_url: "", gender: "female", accent: "British", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Aria", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Charlotte", preview_url: "", gender: "female", accent: "English-Swedish", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Domi", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Dorothy", preview_url: "", gender: "female", accent: "British", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Emily", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Freya", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Gigi", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Glinda", preview_url: "", gender: "female", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Grace", preview_url: "", gender: "female", accent: "American-Southern", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Jessica", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Laura", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Lily", preview_url: "", gender: "female", accent: "British", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Matilda", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Mimi", preview_url: "", gender: "female", accent: "English-Swedish", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Nicole", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Rachel", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Sarah", preview_url: "", gender: "female", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Serena", preview_url: "", gender: "female", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },

  // Male voices
  { voice_id: "", name: "Adam", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Antoni", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Arnold", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Bill", preview_url: "", gender: "male", accent: "American", age: "old", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Brian", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Callum", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Charlie", preview_url: "", gender: "male", accent: "Australian", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Chris", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Clyde", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Daniel", preview_url: "", gender: "male", accent: "British", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Dave", preview_url: "", gender: "male", accent: "British-Essex", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Drew", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Eric", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Ethan", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Fin", preview_url: "", gender: "male", accent: "Irish", age: "old", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "George", preview_url: "", gender: "male", accent: "British", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Giovanni", preview_url: "", gender: "male", accent: "English-Italian", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Harry", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "James", preview_url: "", gender: "male", accent: "Australian", age: "old", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Jeremy", preview_url: "", gender: "male", accent: "American-Irish", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Jessie", preview_url: "", gender: "male", accent: "American", age: "old", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Josh", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Joseph", preview_url: "", gender: "male", accent: "British", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Liam", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Michael", preview_url: "", gender: "male", accent: "American", age: "old", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Patrick", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Paul", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Roger", preview_url: "", gender: "male", accent: "American", age: "middle_aged", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Sam", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Thomas", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },
  { voice_id: "", name: "Will", preview_url: "", gender: "male", accent: "American", age: "young", description: "", use_case: "", category: "premade" },

  // Non-binary
  { voice_id: "", name: "River", preview_url: "", gender: "non-binary", accent: "American", age: "young", description: "", use_case: "", category: "premade" },

  // Character voices
  { voice_id: "", name: "Santa Claus", preview_url: "", gender: "male", accent: "American", age: "old", description: "", use_case: "", category: "premade" },
]

// ---------------------------------------------------------------------------
// Fetch from ElevenLabs API
// ---------------------------------------------------------------------------

async function fetchVoicesFromApi(): Promise<ElevenLabsVoice[]> {
  const res = await fetch(
    "https://api.elevenlabs.io/v2/voices?category=premade&page_size=100",
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
    return reply.send({ voices })
  })

  app.get("/v1/voices/library", async (req, reply) => {
    // No API key — return empty gracefully
    if (!config.ELEVENLABS_API_KEY) {
      return reply.send({ voices: [], hasMore: false })
    }

    const query = req.query as Record<string, string | undefined>
    const params: Record<string, string | undefined> = {
      search: query.search,
      gender: query.gender,
      age: query.age,
      accent: query.accent,
      language: query.language,
      category: query.category,
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
        `https://api.elevenlabs.io/v1/shared-voices?${qs.toString()}`,
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
        }>
        has_more?: boolean
      }

      const voices: SharedVoice[] = data.voices.map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        preview_url: v.preview_url ?? "",
        gender: v.gender ?? "",
        accent: v.accent ?? "",
        age: v.age ?? "",
        description: v.description ?? "",
        use_case: v.use_case ?? "",
        category: v.category ?? "",
      }))

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
