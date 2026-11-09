/**
 * The whole shared Voice Library as the platform's own catalog — what the
 * facet counts (`GET /v1/voices/library/facets`, `lib/voice-library-facets.ts`)
 * are computed from. A `ProgressiveCatalog` (`lib/progressive-catalog/`):
 * one instance per environment walks the listing page by page (≈21,700
 * voices over ≈220 pages of 100, ≈3 minutes, measured 2026-11-09), publishes
 * the complete list to Redis, and every other instance — and the next deploy
 * — adopts it with no provider call. Past `VOICE_LIBRARY_REFRESH_HOURS` the
 * stale list is still served while one instance refetches behind it.
 *
 * The listing route (`routes/voices.ts`) does NOT read this: a page of the
 * library stays a live, filtered call to the provider (its search is fuzzy
 * and its sort is its own); the catalog only answers "how many".
 *
 * No key: `snapshotVoiceLibrary()` answers an empty, complete list — the
 * route checks the key itself first and says `keyMissing`, like the listing.
 */
import { config } from "../../lib/config.js"
import { ProgressiveCatalog, type CatalogPage, type CatalogSnapshot } from "../../lib/progressive-catalog/catalog.js"
import { createSnapshotStore } from "../../lib/progressive-catalog/snapshot-store.js"
import { providerFetch } from "../egress.js"
import {
  sharedVoicesHeaders,
  sharedVoicesUrl,
  toLibraryVoiceRecord,
  type LibraryVoiceRecord,
  type RawSharedVoicesPage,
} from "./shared-voices.js"

export type { LibraryVoiceRecord } from "./shared-voices.js"

/** The listing's largest page. */
const PAGE_SIZE = 100

/** Every log line of this catalog. */
const LOG_TAG = "voice-library/catalog"

/**
 * Safety caps with headroom: 21,710 voices today and the library grows every
 * day. Pages are de-duplicated by id, so a cursor that loops adds nothing;
 * the item cap bounds what one fill holds and publishes. At ≈500 bytes a
 * voice the byte cap below admits ≈80,000 voices.
 */
const MAX_ITEMS = 60_000
const MAX_PAGES = 2_000
const MAX_SNAPSHOT_BYTES = 40 * 1024 * 1024

/** The blob is ≈2.5× the store's default sizing (≈10 MB against ≈4 MB), so
 *  its round-trips get a wider bound: a read that overran the default would
 *  answer "no store" and every boot would walk the provider for 3 minutes. */
const REDIS_TIMEOUT_MS = 5_000

/** The library's own Redis namespace: `voice-library:catalog:v1:voices[:meta|:refresh-lock]`. */
export const voiceLibraryStore = createSnapshotStore({
  namespace: "voice-library:catalog",
  logTag: "voice-library/catalog-store",
  maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
  redisTimeoutMs: REDIS_TIMEOUT_MS,
})

/** Whether the library can be walked at all: the speech provider's key is set. */
export function voiceLibraryConfigured(): boolean {
  return !!config.ELEVENLABS_API_KEY
}

/** How long a complete list is fresh (`VOICE_LIBRARY_REFRESH_HOURS`, default 6). */
function ttlMs(): number {
  const hours = Number(config.VOICE_LIBRARY_REFRESH_HOURS)
  return (Number.isFinite(hours) && hours > 0 ? hours : 6) * 60 * 60 * 1000
}

/** One page of the unfiltered listing; the cursor is the 0-based page number. */
async function fetchLibraryPage(cursor: string | undefined): Promise<CatalogPage<LibraryVoiceRecord>> {
  const page = cursor ? Number.parseInt(cursor, 10) : 0
  const params = new URLSearchParams({ page_size: String(PAGE_SIZE), page: String(page) })
  // Through the egress funnel like every provider call; no billing model, so
  // the walk takes no concurrency slot (a read of the library, not a render).
  const res = await providerFetch(
    { provider: "elevenlabs", operation: "sharedVoices.walk", modelKey: null, body: undefined, dimensions: {} },
    sharedVoicesUrl(params),
    { headers: sharedVoicesHeaders() },
  )
  if (!res.ok) throw new Error(`shared voices page ${page}: HTTP ${res.status}`)
  const data = (await res.json()) as RawSharedVoicesPage
  const items = (data.voices ?? []).map(toLibraryVoiceRecord)
  // An empty page that still claims more would loop until the page cap; stop there instead.
  return { items, nextCursor: data.has_more === true && items.length > 0 ? String(page + 1) : undefined }
}

const catalog = new ProgressiveCatalog<LibraryVoiceRecord>("voices", fetchLibraryPage, {
  configured: voiceLibraryConfigured,
  logTag: LOG_TAG,
  store: voiceLibraryStore,
  storeKind: "voices",
  ttlMs,
  idOf: (v) => v.id,
  maxItems: MAX_ITEMS,
  maxPages: MAX_PAGES,
})

/** A catalog snapshot plus the time the complete list was walked (epoch ms; 0 while incomplete). */
export type VoiceLibrarySnapshot = CatalogSnapshot<LibraryVoiceRecord> & { readonly filledAt: number }

/**
 * The library as known right now: the complete list (`complete: true`, fresh
 * or stale — a stale one is refreshed behind it by one instance) with
 * `filledAt`, the time it was walked; or, on an environment that has never
 * walked it, the pages so far with `complete: false`. Never waits past the
 * first page. Callers treat `items` as read-only.
 */
export async function snapshotVoiceLibrary(): Promise<VoiceLibrarySnapshot> {
  const snap = await catalog.snapshot()
  return { ...snap, filledAt: snap.complete ? catalog.filledAt() : 0 }
}

/**
 * Boot warm-up: adopt the shared snapshot from Redis (one read — no provider
 * call after a deploy) or, on a truly cold environment, start the walk in the
 * background so the first facets request after the first deploy usually
 * finds it done. Fire-and-forget; no-op without a key.
 */
export function warmVoiceLibraryCatalog(): void {
  if (!voiceLibraryConfigured()) return
  // eslint-disable-next-line no-console
  console.log(`[${LOG_TAG}] warming the voice library (Redis snapshot or background walk)`)
  catalog.warm()
}

/** Test hook: forget the catalog. */
export function _resetVoiceLibraryCatalogForTests(): void {
  catalog._reset()
}
