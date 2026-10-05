import type { FastifyInstance } from "fastify"
import type { TtsProvider } from "@nodaro/shared"
import { config } from "../lib/config.js"
import { registerVoiceLookup } from "../providers/kie/audio.js"
import { describeLimitedVoices } from "../providers/provider-keys.js"
import { ELEVENLABS_BASE_URL } from "../providers/elevenlabs/client.js"
import { FALLBACK_VOICES, type ElevenLabsVoice } from "../lib/premade-voices.js"
import { filterVoicesByAllowedGender, clampLibraryGender } from "../lib/voice-policy.js"
import { isModelDenied } from "../lib/surface-deny.js"

// ---------------------------------------------------------------------------
// In-memory cache (6-hour TTL, stampede-safe)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
let cachedVoices: readonly ElevenLabsVoice[] | null = null
let cacheTimestamp = 0
let inflight: Promise<readonly ElevenLabsVoice[]> | null = null

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

async function getVoices(): Promise<readonly ElevenLabsVoice[]> {
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

/** The v4 family: `eleven_v4` and its variants (`eleven_v4_…`) — not an id that merely starts with those characters. */
const V4_FAMILY = /^eleven_v4(_|$)/

/**
 * Map a Voice Library entry's verified ElevenLabs models to the TTS
 * providers the voice is actually verified on. v4 is checked FIRST so it
 * wins the `recommendedProvider = verified[0]` pick whenever the voice is
 * verified for the base model `eleven_v4` (decided 2026-10-05: library voices
 * recommend v4 first); v3 comes next — it renders any voice unmodified, so
 * it's preferable to a v2 model when available.
 * Only the exact id `eleven_v4` counts: the `eleven_v4_…` variants
 * (`eleven_v4_turbo`, …) are not providers of ours.
 * Library previews are rendered with the voice's verified models — generating
 * with an unverified model is what makes output drift audibly from the
 * preview. This stays pure: the route drops the models the deployment does not
 * offer afterwards (`withAvailableProviders`), before the recommendation is
 * picked. Clients without a provider picker send `verified[0]` back as the
 * text-to-speech `provider` (credits then reserve at that provider's price up
 * front); clients with a picker only snap when the current choice isn't in
 * the set.
 *
 * Matching is by model id, and a v4 id is never mistaken for a v2 one: the
 * library now lists `eleven_v4_turbo` (and `_hq`, `_exp`, …) beside the v2 ids,
 * and a bare "turbo" substring test reported a voice verified only for v4
 * Turbo as verified for Turbo v2.5.
 */
export function deriveVerifiedTtsProviders(modelIds: readonly string[]): TtsProvider[] {
  const verified: TtsProvider[] = []
  const v2Era = modelIds.filter((m) => !V4_FAMILY.test(m))
  if (modelIds.includes("eleven_v4")) verified.push("elevenlabs-v4")
  if (modelIds.some((m) => m.includes("eleven_v3"))) verified.push("elevenlabs-v3")
  if (v2Era.some((m) => m.includes("turbo") || m.includes("flash"))) verified.push("elevenlabs-turbo")
  if (v2Era.some((m) => m.includes("multilingual_v2"))) verified.push("elevenlabs-multilingual")
  return verified
}

/**
 * Drop the providers this deployment does not offer (surface profile
 * `models.allow` / `models.deny`, or a saved Admin → Availability override)
 * from each voice's verified list, keeping the order, and set
 * `recommendedProvider` to the first one left. A voice with nothing left
 * carries neither field — the same shape as a voice verified for no model of
 * ours, so clients do not switch providers for it.
 *
 * Runs on every response, cache hits included: the 5-minute page cache holds
 * the full verified list, so an availability change saved by an admin applies
 * at once instead of after the page expires. Without it, a curated deployment
 * that never listed a newer model (v4) would be told to send exactly the model
 * its own text-to-speech route then refuses.
 */
function withAvailableProviders(page: { voices: SharedVoice[]; hasMore: boolean }): {
  voices: SharedVoice[]
  hasMore: boolean
} {
  return {
    ...page,
    voices: page.voices.map(({ verifiedProviders, ...voice }) => {
      const available = (verifiedProviders ?? []).filter((p) => !isModelDenied(p))
      return available.length > 0
        ? { ...voice, recommendedProvider: available[0], verifiedProviders: available }
        : voice
    }),
  }
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
    // B4c: narrow the premade catalog to the deployment's allowed voice genders
    // (inert when voice.allowedGenders is [] — the default).
    const voices = filterVoicesByAllowedGender(await getVoices())
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
      // B4c: the client gender is ADVISORY — force it to the deployment's single
      // allowed gender when locked, drop a disallowed request when several are
      // allowed, pass through when unrestricted. Response is post-filtered below
      // (never trust the provider to honor the param).
      gender: clampLibraryGender(query.gender),
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
      return reply.send(withAvailableProviders(cached.data))
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
          ...(verifiedProviders.length > 0 ? { verifiedProviders } : {}),
        }
      })

      // B4c: post-filter the mapped response by allowed genders (defence in
      // depth — the outbound `gender` clamp above is a hint the provider need
      // not honor). Inert when unrestricted.
      const result = { voices: filterVoicesByAllowedGender(voices), hasMore: data.has_more ?? false }

      // Cache result (clear all on overflow). The cache holds every verified
      // provider; model availability is applied on the way out (below).
      if (sharedVoiceCache.size >= SHARED_CACHE_MAX) {
        sharedVoiceCache.clear()
      }
      sharedVoiceCache.set(cacheKey, { data: result, expiresAt: Date.now() + SHARED_CACHE_TTL_MS })

      return reply.send(withAvailableProviders(result))
    } catch (err) {
      console.error("[voices/library] Failed to fetch shared voices:", (err as Error).message)
      return reply.send({ voices: [], hasMore: false })
    }
  })
}
