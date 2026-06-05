/**
 * HeyGen catalog — avatar looks + voices with in-process cache.
 *
 * Both functions follow the same pattern as `routes/voices.ts`:
 *   - Module-level `{ data, ts }` cache with 1h TTL.
 *   - `inflight` promise guard to prevent stampedes.
 *   - Graceful degrade: returns [] when HEYGEN_API_KEY is not set.
 *
 * GOTCHA: avatar looks come from /v3/avatars/looks (photo_avatar only) —
 * NOT from /v2/avatars (Studio avatars; incompatible with Avatar IV/V).
 * GOTCHA: voice preview field is `preview_audio`, NOT `preview_audio_url`.
 * GOTCHA: `gender` from the voices API uses mixed casing ("Male", "FEMALE",
 * "unknown") — normalise to lowercase with `normalizeGender()`.
 */

import { heygenFetch, isHeygenConfigured } from "./client.js"
import type {
  HeygenAvatar,
  HeygenVoice,
  RawAvatarsLooksResponse,
  RawVoicesResponse,
} from "./types.js"

// ---------------------------------------------------------------------------
// Cache config
// ---------------------------------------------------------------------------

/** 1-hour TTL — avatars/voices catalogues are large and rarely change. */
const CACHE_TTL_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalises HeyGen gender strings to lowercase.
 * "Male" → "male", "FEMALE" → "female", "unknown" → "unknown".
 */
function normalizeGender(g: string | undefined): string {
  return (g ?? "unknown").toLowerCase()
}

// ---------------------------------------------------------------------------
// Avatar catalog
// ---------------------------------------------------------------------------

interface AvatarCache {
  data: HeygenAvatar[]
  ts: number
}

let avatarCache: AvatarCache | null = null
let avatarInflight: Promise<HeygenAvatar[]> | null = null

/** Maximum number of pagination pages to fetch (safety cap). */
const MAX_PAGES = 50

async function fetchAvatars(): Promise<HeygenAvatar[]> {
  const accumulated: HeygenAvatar[] = []
  let cursor: string | undefined
  let pageCount = 0

  do {
    const url = cursor ? `/v3/avatars/looks?token=${encodeURIComponent(cursor)}` : "/v3/avatars/looks"
    const raw = await heygenFetch<RawAvatarsLooksResponse>(url)

    const page = raw.data
      .filter((look) => look.avatar_type === "photo_avatar")
      .map((look) => ({
        avatarId: look.id,
        groupId: look.group_id,
        name: look.name,
        gender: normalizeGender(look.gender),
        previewImageUrl: look.preview_image_url,
        defaultVoiceId: look.default_voice_id,
        preferredOrientation: look.preferred_orientation,
        supportedEngines: look.supported_api_engines,
      }))

    accumulated.push(...page)
    pageCount++

    // Resolve next cursor: prefer next_token, fall back to token
    const nextCursor = raw.next_token ?? raw.token
    // Stop when: no cursor returned, has_more is explicitly false, or safety cap reached
    cursor = (nextCursor && raw.has_more !== false) ? nextCursor : undefined
  } while (cursor && pageCount < MAX_PAGES)

  return accumulated
}

/**
 * Returns the list of HeyGen photo-avatar looks.
 *
 * Results are cached for 1h. Multiple concurrent callers share a single
 * in-flight request (stampede guard). Returns [] when HEYGEN_API_KEY is unset.
 */
export async function listAvatars(): Promise<HeygenAvatar[]> {
  if (!isHeygenConfigured()) return []

  const now = Date.now()
  if (avatarCache && now - avatarCache.ts < CACHE_TTL_MS) {
    return avatarCache.data
  }

  if (avatarInflight) return avatarInflight

  avatarInflight = fetchAvatars()
    .then((data) => {
      avatarCache = { data, ts: Date.now() }
      return data
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error("[heygen/catalog] Failed to fetch avatars:", msg)
      return []
    })
    .finally(() => {
      avatarInflight = null
    })

  return avatarInflight
}

// ---------------------------------------------------------------------------
// Voice catalog
// ---------------------------------------------------------------------------

interface VoiceCache {
  data: HeygenVoice[]
  ts: number
}

let voiceCache: VoiceCache | null = null
let voiceInflight: Promise<HeygenVoice[]> | null = null

async function fetchVoices(): Promise<HeygenVoice[]> {
  const accumulated: HeygenVoice[] = []
  let cursor: string | undefined
  let pageCount = 0

  do {
    const url = cursor ? `/v2/voices?token=${encodeURIComponent(cursor)}` : "/v2/voices"
    const raw = await heygenFetch<RawVoicesResponse>(url)

    const page = raw.data.voices.map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      language: v.language,
      gender: normalizeGender(v.gender),
      previewAudio: v.preview_audio,
      supportPause: v.support_pause ?? false,
      emotionSupport: v.emotion_support ?? false,
      supportLocale: v.support_locale ?? false,
    }))

    accumulated.push(...page)
    pageCount++

    const nextCursor = raw.next_token ?? raw.token
    cursor = (nextCursor && raw.has_more !== false) ? nextCursor : undefined
  } while (cursor && pageCount < MAX_PAGES)

  return accumulated
}

/**
 * Returns the list of HeyGen voices.
 *
 * Results are cached for 1h. Multiple concurrent callers share a single
 * in-flight request (stampede guard). Returns [] when HEYGEN_API_KEY is unset.
 */
export async function listVoices(): Promise<HeygenVoice[]> {
  if (!isHeygenConfigured()) return []

  const now = Date.now()
  if (voiceCache && now - voiceCache.ts < CACHE_TTL_MS) {
    return voiceCache.data
  }

  if (voiceInflight) return voiceInflight

  voiceInflight = fetchVoices()
    .then((data) => {
      voiceCache = { data, ts: Date.now() }
      return data
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error("[heygen/catalog] Failed to fetch voices:", msg)
      return []
    })
    .finally(() => {
      voiceInflight = null
    })

  return voiceInflight
}
