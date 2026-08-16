/**
 * HeyGen catalog — avatar looks + voices, cached in-process, SHARED through
 * Redis, and served PROGRESSIVELY as DELTAS.
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
 * Fill semantics: one fetch in flight per catalog per process (stampede
 * guard); pages accumulate as they land (de-duplicated by id, capped); a
 * mid-way failure keeps the pages and RESUMES from the last cursor on the
 * next request (10 s back-off), so a HeyGen hiccup never restarts from zero
 * or drops the list.
 *
 * Multi-instance: a warm instance re-reads the store's tiny META every
 * STORE_SYNC_MS (sooner when a client shows it a generation it does not
 * know) and adopts a newer snapshot, so a manual refresh on one replica — or
 * two replicas that filled on their own at a cold boot, which is deliberate:
 * a cold instance serves pages progressively rather than waiting on a
 * sibling's lock — converge on one list within seconds, not a TTL.
 *
 * GOTCHA: avatar looks come from /v3/avatars/looks (photo_avatar only) —
 * NOT from /v2/avatars (Studio avatars; incompatible with Avatar IV/V).
 * GOTCHA: voice preview field is `preview_audio`, NOT `preview_audio_url`.
 * GOTCHA: `gender` from the voices API uses mixed casing ("Male", "FEMALE",
 * "unknown") — normalise to lowercase with `normalizeGender()`.
 */

import { randomBytes } from "node:crypto"
import { config } from "../../lib/config.js"
import { heygenFetch, isHeygenConfigured } from "./client.js"
import {
  REFRESH_LOCK_TTL_MS,
  acquireRefreshLock,
  isStoreReachable,
  readSnapshot,
  readSnapshotMeta,
  releaseRefreshLock,
  writeSnapshot,
} from "./catalog-store.js"
import type {
  HeygenAvatar,
  HeygenVoice,
  RawAvatarsLooksResponse,
  RawVoicesResponse,
} from "./types.js"

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

/** Safety caps on pagination (guard a looping cursor). HeyGen's public
 *  photo-avatar catalog is ≈140 pages of 50 = ≈7,000 looks today (measured
 *  2026-08-16: no duplicate ids, a clean `has_more:false` end) — the old cap
 *  of 50 pages at 20 per page silently truncated it to the first 1,000 looks.
 *  Pages are de-duplicated by id as they land, so a cursor that loops adds
 *  nothing and trips MAX_PAGES; MAX_ITEMS bounds what one fill can hold (and
 *  publish to every instance) even if HeyGen hands out fresh ids forever. */
const MAX_PAGES = 1000
const MAX_ITEMS = 25_000

/** After a failed page, wait this long before the next request resumes. */
const RETRY_BACKOFF_MS = 10_000

/** Resume from the saved cursor this many times in a row; then start over —
 *  a cursor HeyGen no longer honours must not pin a catalog on a dead fill. */
const MAX_RESUME_FAILURES = 5

/** Don't ask Redis "did someone else refresh?" more often than this. */
const STORE_RECHECK_MS = 5_000

/** While serving a complete list, look for a NEWER shared snapshot this
 *  often (one tiny meta read) — how fast a manual refresh on one instance, or
 *  two instances that filled independently, converge on the same list. */
const STORE_SYNC_MS = 30_000

/** Per-process entropy for generation ids: two instances that start a fill
 *  in the same millisecond must not mint the same id (a client would splice
 *  their pages together). */
const PROCESS_TAG = randomBytes(3).toString("hex")

/** Fire-and-forget: the callee handles its own failures; this only guards
 *  against a future throw becoming an unhandled rejection. */
function inBackground(p: Promise<unknown>): void {
  p.catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[heygen/catalog] background task failed:", err instanceof Error ? err.message : String(err))
  })
}

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

/** What a client already holds — ask for everything after it. */
export interface CatalogSince {
  readonly offset: number
  readonly generation: string
}

/** A snapshot of a catalog from `offset` on, and whether that is all of it. */
export interface CatalogSnapshot<T> {
  /** Items from `offset` (inclusive), at most `limit` of them when given. */
  readonly items: T[]
  /** The offset actually applied — 0 unless the caller's `since` matched. */
  readonly offset: number
  /** How many items are known so far in this generation. */
  readonly total: number
  /** Whether the SERVER's list is whole (a client may still be behind — see `total`). */
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

/** What a manual refresh did to one catalog. */
export type CatalogRefreshOutcome = "unconfigured" | "started" | "already-running" | "adopted" | "locked-elsewhere"

interface CatalogOptions<T> {
  /** Key in the shared Redis store; omit for a memory-only catalog. */
  readonly storeKind?: string
  /** How long a complete list is fresh before a background refresh. */
  readonly ttlMs: () => number
  /** Identity of an item — pages are de-duplicated on it as they land. */
  readonly idOf: (item: T) => string
}

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
  /** Refresh-lock owner token while THIS process refreshes the shared store,
   *  and when Redis will have expired it on its own — past that we hold nothing. */
  private lockToken: string | null = null
  private lockUntil = 0
  private lastStoreCheck = 0
  private storeCheck: Promise<void> | null = null
  /** Consecutive failed pages of the current (resumed) fill. */
  private resumeFailures = 0
  /** Last time a cold process looked for a snapshot to adopt (throttled: with
   *  Redis down every read costs its 1.5 s timeout, and the pickers poll). */
  private lastAdoptLook = 0
  /** The look in progress — concurrent boot-time requests share it rather
   *  than concluding "nothing here" and starting a fill of their own. */
  private adopting: Promise<boolean> | null = null
  /** Last time a warm process checked the store's meta for a newer list. */
  private lastSync = 0
  private syncing: Promise<void> | null = null
  /** Ids seen by the current fill (dedupe across pages). */
  private seenIds = new Set<string>()

  constructor(
    private readonly name: string,
    private readonly fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
    private readonly opts: CatalogOptions<T>,
  ) {}

  /** What is known right now (from `since.offset` on when the generation
   *  matches, at most `limit` items) — waits for at most the first page of a
   *  cold fill. */
  async snapshot(since?: CatalogSince, limit?: number): Promise<CatalogSnapshot<T>> {
    if (!isHeygenConfigured()) {
      return { items: [], offset: 0, total: 0, complete: true, generation: NONE_GENERATION }
    }

    // A process that has nothing yet first asks the shared store — after a
    // deploy the whole list is one Redis read away, no HeyGen call at all.
    // While a local fill is running, keep looking (another instance may
    // finish first) but no more often than STORE_RECHECK_MS.
    if (!this.full && this.opts.storeKind) await this.lookForSnapshot()

    if (this.full && this.opts.storeKind) {
      // Warm: converge on the shared list. A sibling instance may have
      // refreshed (manual refresh, or two instances that filled on their own
      // at boot) — one tiny meta read every STORE_SYNC_MS, sooner when a
      // client hands us a generation we do not know (it just talked to a
      // sibling): without this, replicas would disagree until their own TTL
      // and a client behind a load balancer would flip between the two lists.
      const mismatch = !!since && since.generation !== this.full.generation
      await this.syncWithStore(mismatch)
    }

    const full = this.completed()
    if (full) {
      // Stale-while-revalidate: past the TTL, hand out the old list at once
      // and refresh behind it — the next caller gets the new one.
      if (Date.now() - full.ts >= this.opts.ttlMs()) inBackground(this.refresh())
      return this.answer(full.items, true, full.generation, since, limit)
    }

    // Cold everywhere: start (or resume) the fill and wait for the first page
    // only. When the fill is backing off after a failure, this answers
    // immediately with whatever pages exist (possibly none) — still
    // `complete:false`, so the client keeps asking and picks the resume up.
    this.kick()
    if (this.partial.length === 0 && this.inflight && this.firstPage) await this.firstPage.promise
    // Re-read after the await — the fill may have completed meanwhile (TS's
    // narrowing of `this.full` above does not survive the suspension).
    const filled = this.completed()
    if (filled) return this.answer(filled.items, true, filled.generation, since, limit)
    return this.answer(this.partial, false, this.partialGeneration, since, limit)
  }

  /** The full list — waits for the fill to complete. `[]` when unconfigured
   *  or when nothing could be fetched at all. */
  async list(): Promise<T[]> {
    if (!isHeygenConfigured()) return []
    if (!this.full && this.opts.storeKind) await this.adoptFromStore()
    if (this.full && Date.now() - this.full.ts < this.opts.ttlMs()) return this.full.items
    // Fill (or finish an interrupted fill) now — no back-off for an explicit
    // full-list request, so a caller that needs everything gets a real try.
    this.notBefore = 0
    while (!this.full || Date.now() - this.full.ts >= this.opts.ttlMs()) {
      this.kick()
      if (!this.inflight) break // failed and backing off — stop looping
      await this.inflight
      if (this.filling && !this.inflight) break // failed mid-way; keep what we have
    }
    return this.full ? this.full.items : this.partial
  }

  /** Boot warm-up: adopt the shared snapshot if there is one, else start the
   *  fill in the background. No-op when unconfigured. */
  warm(): void {
    if (!isHeygenConfigured()) return
    inBackground(this.snapshot())
  }

  private completed(): { items: T[]; ts: number; generation: string } | null {
    return this.full
  }

  /** Slice from the caller's offset when it is talking about THIS list. The
   *  whole-list path hands out the live array by reference (copying ≈7,000
   *  items per request would cost more than it protects) — callers must
   *  treat a snapshot's `items` as read-only. */
  private answer(
    items: T[],
    complete: boolean,
    generation: string,
    since?: CatalogSince,
    limit?: number,
  ): CatalogSnapshot<T> {
    const offset =
      since && since.generation === generation && since.offset >= 0 && since.offset <= items.length
        ? since.offset
        : 0
    const end = limit && limit > 0 ? Math.min(items.length, offset + limit) : items.length
    return {
      items: offset === 0 && end === items.length ? items : items.slice(offset, end),
      offset,
      total: items.length,
      complete,
      generation,
    }
  }

  /** Cold path: look for a snapshot to adopt, at most every STORE_RECHECK_MS —
   *  and only ONE look at a time. A request that arrives while the look is
   *  in flight (boot: warm() plus the first picker) waits for it instead of
   *  seeing an empty memory and kicking a needless fill. */
  private async lookForSnapshot(): Promise<void> {
    if (this.adopting) { await this.adopting; return }
    if (Date.now() < this.lastAdoptLook + STORE_RECHECK_MS) return
    this.lastAdoptLook = Date.now()
    this.adopting = this.adoptFromStore().finally(() => { this.adopting = null })
    await this.adopting
  }

  /** Read the shared snapshot into memory when it is newer than what we hold. */
  private async adoptFromStore(): Promise<boolean> {
    const kind = this.opts.storeKind
    if (!kind) return false
    const stored = await readSnapshot<T>(kind)
    if (!stored) return false
    if (this.full && this.full.ts >= stored.filledAt) return false
    this.full = { items: stored.items, ts: stored.filledAt, generation: stored.generation }
    return true
  }

  /**
   * Warm-path convergence: is there a NEWER snapshot in the store than the
   * list we serve? Costs one small meta read; the blob is read only when the
   * meta says so. Throttled to STORE_SYNC_MS (STORE_RECHECK_MS when `urgent`
   * — a client just showed us a generation that is not ours). A fill in
   * flight here is left to finish: its result is fresher still, and the
   * store's compare-and-set keeps the order right.
   */
  private async syncWithStore(urgent: boolean): Promise<void> {
    const kind = this.opts.storeKind
    if (!kind || !this.full) return
    if (this.syncing) { await this.syncing; return }
    const now = Date.now()
    if (now < this.lastSync + (urgent ? STORE_RECHECK_MS : STORE_SYNC_MS)) return
    this.lastSync = now
    this.syncing = (async () => {
      const meta = await readSnapshotMeta(kind)
      if (!meta || !this.full || meta.filledAt <= this.full.ts) return
      if (await this.adoptFromStore()) {
        // Someone else's list is now ours; an interrupted fill of ours (and
        // the lock it may hold) is moot.
        this.abandonFill()
        await this.dropLock()
      }
    })().finally(() => { this.syncing = null })
    await this.syncing
  }

  /**
   * The list is stale. Shared catalogs first look for a newer snapshot in the
   * store (another instance may have refreshed already), then take the
   * refresh lock so one instance per environment refetches HeyGen — the
   * others keep serving the stale list until the new snapshot appears.
   * Memory-only catalogs just refetch. Throttled; never awaited by callers.
   */
  private async refresh(): Promise<void> {
    if (this.inflight || this.storeCheck) return
    const now = Date.now()
    if (now < this.lastStoreCheck + STORE_RECHECK_MS) return
    this.lastStoreCheck = now
    const kind = this.opts.storeKind
    if (!kind) { this.kick(); return }
    this.storeCheck = (async () => {
      if (await this.adoptFromStore()) {
        // Another instance finished first: whatever we were mid-way through
        // is moot — drop it (and our lock, if we still hold one).
        this.abandonFill()
        await this.dropLock()
        return
      }
      if (this.holdsLock()) {
        // Our own refresh was interrupted (a page failed) — resume it under
        // the lock we already hold instead of asking for it again and losing.
        this.kick()
        return
      }
      // Someone else verifiably refreshing → keep serving stale, they publish.
      if (!(await this.takeLock(kind))) return
      this.kick()
    })().finally(() => { this.storeCheck = null })
    await this.storeCheck
  }

  /** Do we still hold the refresh lock? A token past Redis's own expiry is
   *  nothing — another instance may own the key by now. */
  private holdsLock(): boolean {
    if (!this.lockToken) return false
    if (Date.now() < this.lockUntil) return true
    this.lockToken = null
    return false
  }

  /** Try to become the environment's refresher. Returns false only when
   *  another instance verifiably holds the lock (Redis reachable) — with Redis
   *  down a duplicate fill beats serving a stale list forever. */
  private async takeLock(kind: string): Promise<boolean> {
    const acquiredAt = Date.now()
    const token = await acquireRefreshLock(kind)
    if (!token) {
      if (await isStoreReachable()) return false
      this.lockToken = null
      return true
    }
    this.lockToken = token
    // A little under Redis's TTL so we never act on a key that just lapsed.
    this.lockUntil = acquiredAt + REFRESH_LOCK_TTL_MS - 30_000
    return true
  }

  /**
   * Manual refresh (operator action): fetch the list again NOW, ignoring the
   * TTL and the throttle — but not the lock: when another instance is already
   * refreshing, that is the refresh. Never waits for the fill; the pickers see
   * the new list on their next poll.
   */
  async forceRefresh(): Promise<CatalogRefreshOutcome> {
    if (!isHeygenConfigured()) return "unconfigured"
    if (this.inflight) return "already-running"
    const kind = this.opts.storeKind
    // "Refresh now" means start over — not resume an hours-old interrupted
    // fill under its old generation.
    this.notBefore = 0
    this.abandonFill()
    if (!kind) return this.kick() ? "started" : "already-running"
    if (await this.adoptFromStore()) {
      await this.dropLock()
      return "adopted"
    }
    if (!this.holdsLock() && !(await this.takeLock(kind))) return "locked-elsewhere"
    this.lastStoreCheck = Date.now()
    return this.kick() ? "started" : "already-running"
  }

  /** Forget an interrupted fill so the next kick starts fresh — unless one is
   *  in flight, in which case it finishes and (being the freshest) wins. */
  private abandonFill(): void {
    if (this.inflight) return
    this.filling = false
    this.resumeFailures = 0
  }

  /** Give the refresh lock back (no-op when we hold none / it expired). */
  private async dropLock(): Promise<void> {
    const kind = this.opts.storeKind
    const token = this.lockToken
    this.lockToken = null
    if (!kind || !token) return
    await releaseRefreshLock(kind, token)
  }

  /** Start a fill/refresh/resume unless one is running or backing off.
   *  Returns true when THIS call started a run. */
  private kick(): boolean {
    if (this.inflight) return false
    if (Date.now() < this.notBefore) return false
    if (!this.filling) {
      // A fresh fill (first ever, or a refresh of a complete list). A resume
      // after failure keeps `partial`/`resumeCursor`/generation and continues.
      this.filling = true
      this.partial = []
      this.partialPages = 0
      this.resumeCursor = undefined
      this.seenIds = new Set()
      this.fills++
      this.partialGeneration = `${Date.now().toString(36)}-${this.fills}-${PROCESS_TAG}`
    }
    // Whoever is waiting for "anything at all" is released after this run's
    // first page lands — or when the run fails, so nobody hangs on an outage.
    let resolve!: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    this.firstPage = { promise, resolve }
    this.inflight = this.run().finally(() => { this.inflight = null })
    return true
  }

  private async run(): Promise<void> {
    try {
      do {
        const page = await this.fetchPage(this.resumeCursor)
        const fresh = page.items.filter((item) => {
          const id = this.opts.idOf(item)
          if (this.seenIds.has(id)) return false
          this.seenIds.add(id)
          return true
        })
        this.partial = [...this.partial, ...fresh]
        this.partialPages++
        this.resumeCursor = page.nextCursor
        this.resumeFailures = 0
        this.firstPage?.resolve()
      } while (this.resumeCursor && this.partialPages < MAX_PAGES && this.partial.length < MAX_ITEMS)
      if (this.resumeCursor) {
        // eslint-disable-next-line no-console
        console.warn(`[heygen/catalog] ${this.name}: stopped at the safety cap (${this.partialPages} pages, ${this.partial.length} items) with more pages available`)
      }
      const done = { items: this.partial, ts: Date.now(), generation: this.partialGeneration }
      this.full = done
      this.filling = false
      this.resumeCursor = undefined
      // Publish OUTSIDE the in-flight window: the list is complete and
      // servable now; a slow Redis must not hold `inflight` (which would
      // block the next refresh) — and the store swallows its own failures.
      inBackground(this.publish(done))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error(`[heygen/catalog] Failed to fetch ${this.name} (page ${this.partialPages + 1}):`, msg)
      // Keep the pages we have; the next request resumes from `resumeCursor`
      // after a short back-off. Release anyone waiting on the first page.
      this.notBefore = Date.now() + RETRY_BACKOFF_MS
      this.resumeFailures++
      if (this.resumeFailures >= MAX_RESUME_FAILURES) {
        // eslint-disable-next-line no-console
        console.warn(`[heygen/catalog] ${this.name}: ${this.resumeFailures} failed resumes in a row — the next fill starts from page 1`)
        this.filling = false
        this.resumeFailures = 0
        // Giving up on this fill gives the environment its refresher slot back.
        inBackground(this.dropLock())
      }
      this.firstPage?.resolve()
    }
  }

  /** Share a finished list with the other instances / the next deploy. */
  private async publish(done: { items: T[]; ts: number; generation: string }): Promise<void> {
    const kind = this.opts.storeKind
    if (!kind) return
    await writeSnapshot(kind, { generation: done.generation, filledAt: done.ts, items: done.items })
    await this.dropLock()
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
    this.lockToken = null
    this.lockUntil = 0
    this.lastStoreCheck = 0
    this.storeCheck = null
    this.lastAdoptLook = 0
    this.adopting = null
    this.resumeFailures = 0
    this.lastSync = 0
    this.syncing = null
    this.seenIds = new Set()
  }
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
  return async (cursor: string | undefined): Promise<Page<HeygenAvatar>> => {
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
  storeKind: "avatars",
  ttlMs: sharedTtlMs,
  idOf: (a) => a.avatarId,
})
const privateAvatarCatalog = new ProgressiveCatalog<HeygenAvatar>("private-avatars", fetchLooksPage("private"), {
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

const voiceCatalog = new ProgressiveCatalog<HeygenVoice>("voices", fetchVoicePage, {
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
