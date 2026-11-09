import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { describeLimitedVoices } from "../providers/provider-keys.js"
import { snapshotVoiceLibrary, type LibraryVoiceRecord } from "../providers/elevenlabs/voice-library-catalog.js"
import { computeVoiceLibraryFacets, emptyVoiceLibraryFacets, type VoiceLibraryFacetCounts, type VoiceLibraryFacetFilters } from "../lib/voice-library-facets.js"
import { allowedVoiceGenders, clampLibraryGender, filterVoicesByAllowedGender, voiceLockActive } from "../lib/voice-policy.js"

/**
 * `GET /v1/voices/library/facets` — how many Voice Library voices each
 * category, tone, language, gender, age, accent and category has, for the
 * filters a client holds (`lib/voice-library-facets.ts`), so one call fills a
 * whole picker screen: counts on the categories, tones with no voices hidden,
 * "no Hebrew voices here" said before the click. Public like the listing
 * (middleware/auth.ts), no credits.
 *
 * Counted over the platform's own snapshot of the library
 * (`providers/elevenlabs/voice-library-catalog.ts`): walked by one instance
 * per environment, shared through Redis, refreshed every
 * `VOICE_LIBRARY_REFRESH_HOURS` — never a provider call per request.
 * `updatedAt` is when that snapshot was walked. On an environment that has
 * never walked the library (the first deploy), a `503 voice_library_warming`
 * for the ≈3 minutes the walk takes, rather than counts over half a list.
 *
 * The voice lock (B4c) applies exactly as it does to the listing: the gender
 * filter is clamped to the allowed genders and the snapshot is narrowed to
 * them before counting, so no count advertises a voice the listing hides.
 * Inert without a lock.
 */

/** A public, cached read: generous, but a stop against a runaway client. */
const READ_LIMIT = { rateLimit: { max: 120, timeWindow: "1 minute" } }

/** Answers are computed once per snapshot, lock state and filter set; the
 *  memo is cleared on overflow (a new snapshot makes every old key dead). */
const MEMO_MAX = 500
const memo = new Map<string, VoiceLibraryFacetCounts>()

const value = z.string().trim().max(120).optional()

const facetsQuery = z.object({
  search: z.string().trim().max(200).optional(),
  gender: value,
  age: value,
  accent: value,
  language: value,
  category: value,
  use_cases: value,
  descriptives: value,
  featured: z.enum(["true", "false"]).optional(),
})

export type VoiceLibraryFacetsQuery = z.infer<typeof facetsQuery>

/** The listing's filters, as the lock lets them through. */
export function facetFiltersFor(query: VoiceLibraryFacetsQuery): VoiceLibraryFacetFilters {
  return {
    search: query.search,
    gender: clampLibraryGender(query.gender),
    age: query.age,
    accent: query.accent,
    language: query.language,
    category: query.category,
    use_cases: query.use_cases,
    descriptives: query.descriptives,
    featured: query.featured === undefined ? undefined : query.featured === "true",
  }
}

function memoized(generation: string, filters: VoiceLibraryFacetFilters, voices: readonly LibraryVoiceRecord[]): VoiceLibraryFacetCounts {
  const key = JSON.stringify([generation, allowedVoiceGenders(), filters])
  const hit = memo.get(key)
  if (hit) return hit
  const counts = computeVoiceLibraryFacets(voiceLockActive() ? filterVoicesByAllowedGender(voices) : voices, filters)
  if (memo.size >= MEMO_MAX) memo.clear()
  memo.set(key, counts)
  return counts
}

/** Test hook: forget every memoized answer. */
export function _resetVoiceLibraryFacetsMemoForTests(): void {
  memo.clear()
}

export async function voiceLibraryFacetRoutes(app: FastifyInstance) {
  app.get("/v1/voices/library/facets", { config: READ_LIMIT }, async (req, reply) => {
    const parsed = facetsQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } })
    }

    // No key — nothing to count, and SAY so (#647), exactly as the listing does.
    if (!config.ELEVENLABS_API_KEY) {
      reply.header("Cache-Control", "no-store")
      return reply.send({ ...emptyVoiceLibraryFacets(), updatedAt: null, keyMissing: true, hint: describeLimitedVoices() })
    }

    const snap = await snapshotVoiceLibrary()
    if (!snap.complete) {
      reply.header("Cache-Control", "no-store").header("Retry-After", "30")
      return reply.status(503).send({
        error: { code: "voice_library_warming", message: "The voice library is being counted for the first time; try again in a minute." },
      })
    }

    const counts = memoized(snap.generation, facetFiltersFor(parsed.data), snap.items)
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
    return reply.send({ ...counts, updatedAt: new Date(snap.filledAt).toISOString() })
  })
}
