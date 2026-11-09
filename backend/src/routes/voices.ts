import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import type { TtsProvider } from "@nodaro/shared/models"
import { config } from "../lib/config.js"
import { describeLimitedVoices } from "../providers/provider-keys.js"
import { ELEVENLABS_BASE_URL } from "../providers/elevenlabs/client.js"
import { getPremadeVoices } from "../lib/premade-voice-catalog.js"
import { filterVoicesByAllowedGender, clampLibraryGender, voiceNotAvailableBody } from "../lib/voice-policy.js"
import { recordLibraryVoiceGenders } from "../lib/library-voice-genders.js"
import { judgeVoicesUnderLock } from "../lib/voice-lock.js"
import { isModelDenied } from "../lib/surface-deny.js"
import { PREVIEW_VOICE_ID } from "../lib/voice-preview-address.js"
import {
  PreviewUnavailableError,
  loadPreview,
  requestedRange,
  verifiedPreviewSource,
  voicePreviewProxyOn,
  withSameSitePreviews,
} from "../lib/voice-preview-proxy.js"

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
 * Only exact ids count in the v4 family: `eleven_v4` and `eleven_v4_turbo`;
 * the other `eleven_v4_…` variants (`_hq`, `_exp`, …) are not providers of ours.
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
  // The fast v4, by its exact id. After v3 (decided 2026-10-06): a voice verified for both is recommended on v3, not on Turbo.
  if (modelIds.includes("eleven_v4_turbo")) verified.push("elevenlabs-v4-turbo")
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

/**
 * The voices as this request should see their previews: on a deployment that
 * serves them from its own host (`VOICE_PREVIEW_PROXY=true`), each one's
 * same-site address (lib/voice-preview-proxy.ts); otherwise, and for the
 * platform's own internal calls (an MCP tool, whose client is not a browser on
 * this site), the provider's address, as before. Applied on the way out, so
 * the caches keep the provider's addresses.
 */
function forThisSite<T extends { voice_id: string; preview_url: string }>(req: FastifyRequest, voices: readonly T[]): T[] {
  return voicePreviewProxyOn() && !req.isInternalCall ? withSameSitePreviews(voices) : [...voices]
}

const previewParams = z.object({ voiceId: z.string().regex(PREVIEW_VOICE_ID) })
const previewQuery = z.object({ src: z.string(), sig: z.string() })
const PREVIEW_NOT_FOUND = { error: { code: "not_found", message: "Not found" } } as const

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function voicesRoutes(app: FastifyInstance) {
  app.get("/v1/voices", async (req, reply) => {
    // B4c: narrow the premade catalog to the deployment's allowed voice genders;
    // under a lock a voice with no known gender is not listed (inert when
    // voice.allowedGenders is [] — the default).
    const voices = forThisSite(req, filterVoicesByAllowedGender(await getPremadeVoices()))
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
      const page = withAvailableProviders(cached.data)
      return reply.send({ ...page, voices: forThisSite(req, page.voices) })
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

      // B4c: the Voice Library has no lookup by voice id, so a voice lock can
      // only place a library voice this deployment has listed. Remember the
      // gender the library states for EVERY voice on this page, before the
      // filter below (so a later change of the lock is judged right); the
      // lock's resolver reads it when the voice is used (lib/voice-gender.ts).
      // Written only under a lock. A failed write leaves the voice unknown,
      // which the lock refuses — so it never fails the listing.
      await recordLibraryVoiceGenders(voices).catch((err: unknown) => {
        console.warn("[voices/library] could not record library voice genders:", (err as Error).message)
      })

      // B4c: post-filter the mapped response by allowed genders (defence in
      // depth — the outbound `gender` clamp above is a hint the provider need
      // not honor). A voice whose gender the library does not state is not
      // listed under a lock. Inert when unrestricted.
      const result = { voices: filterVoicesByAllowedGender(voices), hasMore: data.has_more ?? false }

      // Cache result (clear all on overflow). The cache holds every verified
      // provider; model availability is applied on the way out (below).
      if (sharedVoiceCache.size >= SHARED_CACHE_MAX) {
        sharedVoiceCache.clear()
      }
      sharedVoiceCache.set(cacheKey, { data: result, expiresAt: Date.now() + SHARED_CACHE_TTL_MS })

      const page = withAvailableProviders(result)
      return reply.send({ ...page, voices: forThisSite(req, page.voices) })
    } catch (err) {
      console.error("[voices/library] Failed to fetch shared voices:", (err as Error).message)
      return reply.send({ voices: [], hasMore: false })
    }
  })

  // A voice's preview, served from this site (VOICE_PREVIEW_PROXY=true): the
  // provider's file, at the address the lists above gave it. The signed
  // address is the credential — an <audio src> sends no bearer — so the route
  // is public (middleware/auth.ts) and fetches only a file the platform
  // listed, for the voice it listed it under (lib/voice-preview-proxy.ts).
  // Off: 404, as if there were no such route.
  app.get("/v1/voices/:voiceId/preview", async (req, reply) => {
    if (!voicePreviewProxyOn()) return reply.status(404).send(PREVIEW_NOT_FOUND)
    const params = previewParams.safeParse(req.params)
    const query = previewQuery.safeParse(req.query)
    const voiceId = params.success ? params.data.voiceId : ""
    const upstream = params.success && query.success ? verifiedPreviewSource(voiceId, query.data.src, query.data.sig) : null
    if (!upstream) return reply.status(404).send(PREVIEW_NOT_FOUND)

    // The voice lock, as the speech routes judge the same voice, before
    // anything is fetched: an address minted before a lock was set, or for a
    // voice a lock has since locked out, plays nothing. No lock: nothing read.
    const verdict = await judgeVoicesUnderLock([voiceId], { userId: req.userId ?? null })
    if (!verdict.allowed) return reply.status(400).send(voiceNotAvailableBody())

    let file
    try {
      file = await loadPreview(upstream)
    } catch (err) {
      if (!(err instanceof PreviewUnavailableError)) throw err
      req.log.warn({ voiceId, reason: err.reason }, "[voices/preview] the provider's preview could not be served")
      return reply.status(502).send({ error: { code: "preview_unavailable", message: "This voice's preview could not be loaded." } })
    }

    const size = file.body.byteLength
    // A day in this browser only: a shared cache would keep serving a preview
    // after a voice lock refused the voice.
    reply.header("Content-Type", file.contentType).header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=86400")
    const range = requestedRange(req.headers.range, size)
    if (range === "unsatisfiable") return reply.status(416).header("Content-Range", `bytes */${size}`).send()
    if (range) {
      return reply.status(206).header("Content-Range", `bytes ${range.start}-${range.end}/${size}`).send(file.body.subarray(range.start, range.end + 1))
    }
    return reply.send(file.body)
  })
}
