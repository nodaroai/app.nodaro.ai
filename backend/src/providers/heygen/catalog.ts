/**
 * HeyGen catalog — avatar looks + voices, cached in-process and served
 * PROGRESSIVELY, as DELTAS.
 *
 * The real catalog is big: ≈7,000 photo-avatar looks over ≈140 pages of 50
 * (HeyGen holds ≈9,100 looks in all; digital twins and studio avatars are
 * filtered out server-side) and ≈2,500 voices in one shot. A cold fill takes
 * about a minute and a half, so nobody waits for it and nobody re-downloads it:
 *
 *   • `snapshot(since?)` answers with what is known RIGHT NOW — the complete
 *     list when the cache is warm (fresh OR stale: a stale list is served at
 *     once and refreshed in the background), or, on a cold cache, the pages
 *     fetched so far plus `complete:false`. It waits for at most the FIRST
 *     page, so the first picker open shows avatars in ~1 s and the rest
 *     streams in as the client re-polls.
 *   • Every answer carries a `generation` (one per fill) and, given the
 *     client's `{ offset, generation }`, returns only the items AFTER that
 *     offset — the client appends. A generation mismatch (new fill, restarted
 *     server) resets to offset 0 so a client can never splice two lists.
 *   • `list()` is the full-list API (awaits completion) — for callers that
 *     genuinely need everything, and the tests.
 *   • `warmHeygenCatalog()` starts both fills at boot so the first user after
 *     a deploy usually finds them done.
 *
 * Fill semantics: one fetch in flight at a time (stampede guard); pages
 * accumulate as they land; a mid-way failure keeps the pages already fetched
 * and RESUMES from the last cursor on the next request (after a short
 * back-off), so a HeyGen hiccup never restarts from zero or drops the list.
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

/** 1-hour TTL — the catalogues are large and rarely change. Past it a stale
 *  list is still served immediately while a refresh runs in the background. */
const CACHE_TTL_MS = 60 * 60 * 1000

/** Page size for /v3/avatars/looks — HeyGen's documented maximum (default 20). */
const LOOKS_PAGE_SIZE = 50

/** Safety cap on pagination (guards a looping cursor). HeyGen's photo-avatar
 *  catalog is ≈7,000 looks = ≈141 pages of 50 today (measured 2026-08-16:
 *  no duplicate ids, a clean `has_more:false` end) — the old cap of 50 pages
 *  at 20 per page silently truncated it to the first 1,000 looks. */
const MAX_PAGES = 1000

/** After a failed page, wait this long before the next request resumes. */
const RETRY_BACKOFF_MS = 10_000

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

/** What a client already holds — ask for everything after it. */
export interface CatalogSince {
  readonly offset: number
  readonly generation: string
}

/** A snapshot of a catalog from `offset` on, and whether that is all of it. */
export interface CatalogSnapshot<T> {
  /** Items from `offset` (inclusive) to the end of what is known. */
  readonly items: T[]
  /** The offset actually applied — 0 unless the caller's `since` matched. */
  readonly offset: number
  /** How many items are known so far in this generation (offset + items). */
  readonly total: number
  readonly complete: boolean
  /** Identifies the fill these items belong to; changes on every refresh. */
  readonly generation: string
}

interface Page<T> {
  readonly items: T[]
  readonly nextCursor: string | undefined
}

/** The unconfigured / nothing-will-ever-come answer. */
const NONE_GENERATION = "none"

// ---------------------------------------------------------------------------
// ProgressiveCatalog — the shared fill/cache machine (one per catalog)
// ---------------------------------------------------------------------------

class ProgressiveCatalog<T> {
  /** Last COMPLETE list + when it finished + which fill made it. */
  private full: { items: T[]; ts: number; generation: string } | null = null
  /** Pages accumulated by the current (or interrupted) fill. */
  private partial: T[] = []
  private partialPages = 0
  private partialGeneration = NONE_GENERATION
  private resumeCursor: string | undefined = undefined
  /** True while a fill has been started and not yet completed (survives a
   *  failed page so the next request resumes instead of restarting). */
  private filling = false
  private inflight: Promise<void> | null = null
  private firstPage: { promise: Promise<void>; resolve: () => void } | null = null
  private notBefore = 0
  private fills = 0

  constructor(
    private readonly name: string,
    private readonly fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  ) {}

  /** What is known right now (from `since.offset` on when the generation
   *  matches) — waits for at most the first page of a cold fill. */
  async snapshot(since?: CatalogSince): Promise<CatalogSnapshot<T>> {
    if (!isHeygenConfigured()) {
      return { items: [], offset: 0, total: 0, complete: true, generation: NONE_GENERATION }
    }

    const now = Date.now()
    const full = this.completed()
    if (full) {
      // Stale-while-revalidate: past the TTL, hand out the old list at once
      // and refresh behind it — the next caller gets the new one.
      if (now - full.ts >= CACHE_TTL_MS) this.kick()
      return this.answer(full.items, true, full.generation, since)
    }

    // Cold: start (or resume) the fill and wait for the first page only. When
    // the fill is backing off after a failure, this answers immediately with
    // whatever pages exist (possibly none) — still `complete:false`, so the
    // client keeps asking and picks the resume up once it runs.
    this.kick()
    if (this.partial.length === 0 && this.inflight && this.firstPage) await this.firstPage.promise
    // Re-read after the await — the fill may have completed meanwhile (TS's
    // narrowing of `this.full` above does not survive the suspension).
    const filled = this.completed()
    if (filled) return this.answer(filled.items, true, filled.generation, since)
    return this.answer(this.partial, false, this.partialGeneration, since)
  }

  /** The full list — waits for the fill to complete. `[]` when unconfigured
   *  or when nothing could be fetched at all. */
  async list(): Promise<T[]> {
    if (!isHeygenConfigured()) return []
    if (this.full && Date.now() - this.full.ts < CACHE_TTL_MS) return this.full.items
    // Fill (or finish an interrupted fill) now — no back-off for an explicit
    // full-list request, so a caller that needs everything gets a real try.
    this.notBefore = 0
    while (!this.full || Date.now() - this.full.ts >= CACHE_TTL_MS) {
      this.kick()
      if (!this.inflight) break // failed and backing off — stop looping
      await this.inflight
      if (this.filling && !this.inflight) break // failed mid-way; keep what we have
    }
    return this.full ? this.full.items : this.partial
  }

  /** Start the fill in the background (boot warm-up). No-op when unconfigured. */
  warm(): void {
    if (!isHeygenConfigured()) return
    if (this.full && Date.now() - this.full.ts < CACHE_TTL_MS) return
    this.kick()
  }

  private completed(): { items: T[]; ts: number; generation: string } | null {
    return this.full
  }

  /** Slice from the caller's offset when it is talking about THIS list. */
  private answer(items: T[], complete: boolean, generation: string, since?: CatalogSince): CatalogSnapshot<T> {
    const offset =
      since && since.generation === generation && since.offset >= 0 && since.offset <= items.length
        ? since.offset
        : 0
    return {
      items: offset === 0 ? items : items.slice(offset),
      offset,
      total: items.length,
      complete,
      generation,
    }
  }

  /** Start a fill/refresh/resume unless one is running or backing off. */
  private kick(): void {
    if (this.inflight) return
    if (Date.now() < this.notBefore) return
    if (!this.filling) {
      // A fresh fill (first ever, or a refresh of a complete list). A resume
      // after failure keeps `partial`/`resumeCursor`/generation and continues.
      this.filling = true
      this.partial = []
      this.partialPages = 0
      this.resumeCursor = undefined
      this.fills++
      this.partialGeneration = `${Date.now().toString(36)}-${this.fills}`
    }
    // Whoever is waiting for "anything at all" is released after this run's
    // first page lands — or when the run fails, so nobody hangs on an outage.
    let resolve!: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    this.firstPage = { promise, resolve }
    this.inflight = this.run().finally(() => { this.inflight = null })
  }

  private async run(): Promise<void> {
    try {
      do {
        const page = await this.fetchPage(this.resumeCursor)
        this.partial = [...this.partial, ...page.items]
        this.partialPages++
        this.resumeCursor = page.nextCursor
        this.firstPage?.resolve()
      } while (this.resumeCursor && this.partialPages < MAX_PAGES)
      if (this.resumeCursor) {
        // eslint-disable-next-line no-console
        console.warn(`[heygen/catalog] ${this.name}: stopped at the ${MAX_PAGES}-page safety cap with more pages available`)
      }
      this.full = { items: this.partial, ts: Date.now(), generation: this.partialGeneration }
      this.filling = false
      this.resumeCursor = undefined
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error(`[heygen/catalog] Failed to fetch ${this.name} (page ${this.partialPages + 1}):`, msg)
      // Keep the pages we have; the next request resumes from `resumeCursor`
      // after a short back-off. Release anyone waiting on the first page.
      this.notBefore = Date.now() + RETRY_BACKOFF_MS
      this.firstPage?.resolve()
    }
  }

  /** Test hook: forget everything. */
  _reset(): void {
    this.full = null
    this.partial = []
    this.partialPages = 0
    this.partialGeneration = NONE_GENERATION
    this.resumeCursor = undefined
    this.filling = false
    this.inflight = null
    this.firstPage = null
    this.notBefore = 0
    this.fills = 0
  }
}

// ---------------------------------------------------------------------------
// Avatar catalog
// ---------------------------------------------------------------------------

async function fetchAvatarPage(cursor: string | undefined): Promise<Page<HeygenAvatar>> {
  // Ask HeyGen for photo avatars only, at the largest page it serves — the
  // unfiltered default (20 per page, every avatar type) was 3× the calls for
  // the same list. The client-side type filter below stays as belt and braces.
  const params = new URLSearchParams({ avatar_type: "photo_avatar", limit: String(LOOKS_PAGE_SIZE) })
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
    }))
  // Resolve next cursor: prefer next_token, fall back to token. Stop when no
  // cursor is returned or has_more is explicitly false.
  const nextCursor = raw.next_token ?? raw.token
  return { items, nextCursor: nextCursor && raw.has_more !== false ? nextCursor : undefined }
}

const avatarCatalog = new ProgressiveCatalog<HeygenAvatar>("avatars", fetchAvatarPage)

/**
 * Returns the FULL list of HeyGen photo-avatar looks (waits for the fill).
 * Cached for 1h. Returns [] when HEYGEN_API_KEY is unset.
 */
export function listAvatars(): Promise<HeygenAvatar[]> {
  return avatarCatalog.list()
}

/**
 * The avatar looks known right now — from `since.offset` on when the caller's
 * generation matches: the complete list when the cache is warm (fresh or
 * stale — a stale list is refreshed in the background), or the pages fetched
 * so far (`complete: false`) while a cold fill is running. Never waits past
 * the first page.
 */
export function snapshotAvatars(since?: CatalogSince): Promise<CatalogSnapshot<HeygenAvatar>> {
  return avatarCatalog.snapshot(since)
}

// ---------------------------------------------------------------------------
// Voice catalog
// ---------------------------------------------------------------------------

async function fetchVoicePage(cursor: string | undefined): Promise<Page<HeygenVoice>> {
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

const voiceCatalog = new ProgressiveCatalog<HeygenVoice>("voices", fetchVoicePage)

/**
 * Returns the FULL list of HeyGen voices (waits for the fill).
 * Cached for 1h. Returns [] when HEYGEN_API_KEY is unset.
 */
export function listVoices(): Promise<HeygenVoice[]> {
  return voiceCatalog.list()
}

/** The voices known right now — see `snapshotAvatars`. */
export function snapshotVoices(since?: CatalogSince): Promise<CatalogSnapshot<HeygenVoice>> {
  return voiceCatalog.snapshot(since)
}

/**
 * Boot warm-up: start both fills in the background so the first picker after
 * a deploy usually finds the catalogs already there. Fire-and-forget; no-op
 * without a HeyGen key (a key pasted later kicks the fill on first use).
 */
export function warmHeygenCatalog(): void {
  if (!isHeygenConfigured()) return
  // eslint-disable-next-line no-console
  console.log("[heygen/catalog] warming avatars + voices in the background")
  avatarCatalog.warm()
  voiceCatalog.warm()
}

/** Test hook: forget both catalogs. */
export function _resetHeygenCatalogForTests(): void {
  avatarCatalog._reset()
  voiceCatalog._reset()
}
