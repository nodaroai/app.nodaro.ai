/**
 * HeyGen catalog — avatar looks + voices, cached in-process, SHARED through
 * Redis, and served PROGRESSIVELY as DELTAS. The fill/cache machine is
 * `lib/progressive-catalog/catalog.ts` (`ProgressiveCatalog`); this module is
 * HeyGen's three lists on it.
 *
 * Three catalogs:
 *   • PUBLIC avatar looks — HeyGen's preset library, ≈7,000 photo avatars over
 *     ≈140 pages of 50 (`ownership=public&avatar_type=photo_avatar`). Big and
 *     slow-changing: the complete list is published to Redis when a fill ends
 *     and adopted by every other instance (and by the next deploy) without a
 *     single HeyGen call; refetched every HEYGEN_CATALOG_REFRESH_HOURS (24 by
 *     default) by ONE instance per environment (refresh lock).
 *   • PRIVATE avatar looks — the account's own custom avatars
 *     (`ownership=private`). A small personal list that people expect to see
 *     right after they create one, so it is memory-only and refetched every
 *     couple of minutes (stale-while-revalidate), never through the daily cycle.
 *   • VOICES — ≈2,500 in one slow call; shared through Redis like the public looks.
 *
 * Serving (`snapshot(since, limit)`): what is known RIGHT NOW — the complete
 * list when warm (fresh OR stale: a stale list is served at once and refreshed
 * behind it), or, on a truly cold process with nothing in Redis either, the
 * pages fetched so far plus `complete:false` (waits for the FIRST page only,
 * ~1 s). Every answer carries a `generation`; given the client's
 * `{ offset, generation }` it returns only the items after that offset — a
 * generation mismatch (new fill, other instance) resets to 0 so two lists are
 * never spliced. `limit` slices the answer so a client can stream a warm list
 * in chunks. `list()` is the full-list API (awaits completion).
 *
 * GOTCHA: avatar looks come from /v3/avatars/looks (photo_avatar only) —
 * NOT from /v2/avatars (Studio avatars; incompatible with Avatar IV/V).
 * GOTCHA: voice preview field is `preview_audio`, NOT `preview_audio_url`.
 * GOTCHA: `gender` from the voices API uses mixed casing ("Male", "FEMALE",
 * "unknown") — normalise to lowercase with `normalizeGender()`.
 */

import { config } from "../../lib/config.js"
import { ProgressiveCatalog, type CatalogPage, type CatalogRefreshOutcome, type CatalogSince, type CatalogSnapshot } from "../../lib/progressive-catalog/catalog.js"
import { heygenFetch, isHeygenConfigured } from "./client.js"
import { heygenCatalogStore } from "./catalog-store.js"
import type {
  HeygenAvatar,
  HeygenVoice,
  RawAvatarsLooksResponse,
  RawVoicesResponse,
} from "./types.js"

export type { CatalogRefreshOutcome, CatalogSince, CatalogSnapshot } from "../../lib/progressive-catalog/catalog.js"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** How long the shared (public looks / voices) snapshot is fresh. */
function sharedTtlMs(): number {
  const hours = Number(config.HEYGEN_CATALOG_REFRESH_HOURS)
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000
}

/** The account's own looks: small list, people expect it fresh. */
const PRIVATE_TTL_MS = 2 * 60 * 1000

/** Page size for /v3/avatars/looks — HeyGen's documented maximum (default 20). */
const LOOKS_PAGE_SIZE = 50

/** Every log line of these three catalogs. */
const LOG_TAG = "heygen/catalog"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wire values HeyGen uses for a look that is done and usable. */
const READY_LOOK_STATUSES = new Set(["completed", "ready", "success", "succeeded", "done", "active"])

/** Map a raw look status onto the two states the UI cares about: absent
 *  (ready), "processing" (still building — pending/processing/training/…) or
 *  "failed". Presets carry no status at all. */
export function normalizeLookStatus(raw: string | undefined): "processing" | "failed" | undefined {
  const s = raw?.trim().toLowerCase()
  if (!s || READY_LOOK_STATUSES.has(s)) return undefined
  if (s === "failed" || s === "error" || s === "failure") return "failed"
  return "processing"
}

/**
 * Normalises HeyGen gender strings to lowercase.
 * "Male" → "male", "FEMALE" → "female", "unknown" → "unknown".
 */
function normalizeGender(g: string | undefined): string {
  return (g ?? "unknown").toLowerCase()
}

// ---------------------------------------------------------------------------
// Avatar catalogs — public presets (shared) + the account's own looks
// ---------------------------------------------------------------------------

/** `{ status }` only when there is one to show — keeps preset rows unchanged. */
function statusField(raw: string | undefined): { status?: "processing" | "failed" } {
  const status = normalizeLookStatus(raw)
  return status ? { status } : {}
}

function fetchLooksPage(ownership: "public" | "private") {
  return async (cursor: string | undefined): Promise<CatalogPage<HeygenAvatar>> => {
    // Photo avatars only, one ownership at a time, at the largest page HeyGen
    // serves — the unfiltered default (20 per page, every avatar type) was 3×
    // the calls for the same list. The type filter below stays as belt and braces.
    const params = new URLSearchParams({ ownership, avatar_type: "photo_avatar", limit: String(LOOKS_PAGE_SIZE) })
    if (cursor) params.set("token", cursor)
    const raw = await heygenFetch<RawAvatarsLooksResponse>(`/v3/avatars/looks?${params.toString()}`)
    const items = raw.data
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
        ownership,
        ...(ownership === "private" ? statusField(look.status) : {}),
      }))
    // Resolve next cursor: prefer next_token, fall back to token. Stop when no
    // cursor is returned or has_more is explicitly false.
    const nextCursor = raw.next_token ?? raw.token
    return { items, nextCursor: nextCursor && raw.has_more !== false ? nextCursor : undefined }
  }
}

const publicAvatarCatalog = new ProgressiveCatalog<HeygenAvatar>("avatars", fetchLooksPage("public"), {
  configured: isHeygenConfigured,
  logTag: LOG_TAG,
  store: heygenCatalogStore,
  storeKind: "avatars",
  ttlMs: sharedTtlMs,
  idOf: (a) => a.avatarId,
})
const privateAvatarCatalog = new ProgressiveCatalog<HeygenAvatar>("private-avatars", fetchLooksPage("private"), {
  configured: isHeygenConfigured,
  logTag: LOG_TAG,
  ttlMs: () => PRIVATE_TTL_MS,
  idOf: (a) => a.avatarId,
})

/**
 * Returns the FULL list of HeyGen photo-avatar looks — the account's own
 * looks first, then the preset library (waits for both fills). Returns []
 * when HEYGEN_API_KEY is unset.
 */
export async function listAvatars(): Promise<HeygenAvatar[]> {
  const [own, presets] = await Promise.all([privateAvatarCatalog.list(), publicAvatarCatalog.list()])
  return [...own, ...presets]
}

/**
 * The PUBLIC (preset) looks known right now — from `since.offset` on when the
 * caller's generation matches, at most `limit` items: the complete list when
 * warm (fresh or stale — a stale list is refreshed in the background by one
 * instance), or the pages fetched so far (`complete: false`) while a cold fill
 * is running. Never waits past the first page.
 */
export function snapshotAvatars(since?: CatalogSince, limit?: number): Promise<CatalogSnapshot<HeygenAvatar>> {
  return publicAvatarCatalog.snapshot(since, limit)
}

/**
 * The account's OWN (private) looks — a small list served whole, refetched
 * every couple of minutes so a look created a moment ago shows up. Never
 * waits past the first page.
 */
export async function snapshotPrivateAvatars(): Promise<HeygenAvatar[]> {
  return (await privateAvatarCatalog.snapshot()).items
}

// ---------------------------------------------------------------------------
// Voice catalog
// ---------------------------------------------------------------------------

async function fetchVoicePage(cursor: string | undefined): Promise<CatalogPage<HeygenVoice>> {
  const url = cursor ? `/v2/voices?token=${encodeURIComponent(cursor)}` : "/v2/voices"
  const raw = await heygenFetch<RawVoicesResponse>(url)
  const items = raw.data.voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    language: v.language,
    gender: normalizeGender(v.gender),
    previewAudio: v.preview_audio,
    supportPause: v.support_pause ?? false,
    emotionSupport: v.emotion_support ?? false,
    supportLocale: v.support_locale ?? false,
  }))
  const nextCursor = raw.next_token ?? raw.token
  return { items, nextCursor: nextCursor && raw.has_more !== false ? nextCursor : undefined }
}

const voiceCatalog = new ProgressiveCatalog<HeygenVoice>("voices", fetchVoicePage, {
  configured: isHeygenConfigured,
  logTag: LOG_TAG,
  store: heygenCatalogStore,
  storeKind: "voices",
  ttlMs: sharedTtlMs,
  idOf: (v) => v.voiceId,
})

/**
 * Returns the FULL list of HeyGen voices (waits for the fill).
 * Returns [] when HEYGEN_API_KEY is unset.
 */
export function listVoices(): Promise<HeygenVoice[]> {
  return voiceCatalog.list()
}

/** The voices known right now — see `snapshotAvatars`. */
export function snapshotVoices(since?: CatalogSince, limit?: number): Promise<CatalogSnapshot<HeygenVoice>> {
  return voiceCatalog.snapshot(since, limit)
}

/**
 * Boot warm-up: adopt the shared snapshots from Redis (one read each — no
 * HeyGen call after a deploy) or, on a truly cold environment, start the
 * fills in the background so the first picker usually finds them done.
 * Fire-and-forget; no-op without a HeyGen key (a key pasted later kicks the
 * fill on first use).
 */
export function warmHeygenCatalog(): void {
  if (!isHeygenConfigured()) return
  // eslint-disable-next-line no-console
  console.log("[heygen/catalog] warming avatars + voices (Redis snapshot or background fill)")
  publicAvatarCatalog.warm()
  privateAvatarCatalog.warm()
  voiceCatalog.warm()
}

/** What a manual refresh did to each catalog. */
export interface HeygenCatalogRefreshResult {
  readonly avatars: CatalogRefreshOutcome
  readonly privateAvatars: CatalogRefreshOutcome
  readonly voices: CatalogRefreshOutcome
}

/**
 * Operator action: refetch every catalog from HeyGen now (TTL ignored, lock
 * respected). Returns at once — the fills run in the background and the
 * pickers pick the new lists up on their next poll.
 */
export async function refreshHeygenCatalog(): Promise<HeygenCatalogRefreshResult> {
  const [avatars, privateAvatars, voices] = await Promise.all([
    publicAvatarCatalog.forceRefresh(),
    privateAvatarCatalog.forceRefresh(),
    voiceCatalog.forceRefresh(),
  ])
  return { avatars, privateAvatars, voices }
}

/** Test hook: forget every catalog. */
export function _resetHeygenCatalogForTests(): void {
  publicAvatarCatalog._reset()
  privateAvatarCatalog._reset()
  voiceCatalog._reset()
}
