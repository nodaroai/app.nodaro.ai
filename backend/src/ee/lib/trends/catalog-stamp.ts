/**
 * The guest trend reads' kept answers, and the stamp that tells when they are
 * out of date.
 *
 * The STAMP is one `app_settings` row (`trends_catalog_stamp`), set to a fresh
 * token by {@link trendCatalogChanged} after every store write that changes
 * what a public trend read shows (store.ts, tags.ts; the census in
 * `__tests__/catalog-change-census.test.ts` holds every write to it). It lives
 * in the database because the database is the one thing every writer shares:
 * the API, the workers (`attachWebCopies` runs there), the backfill scripts,
 * and staging, which writes the same database as production. A counter in one
 * environment's Redis could not tell the other one.
 *
 * A guest's answer is KEPT in this process under the stamp read before it was
 * built, so a new stamp makes every kept answer a miss, in every process,
 * within {@link STAMP_MEMO_MS}. A stamp that cannot be read keeps nothing: the
 * answer is built from the database as if nothing were kept. The process that
 * made the change drops its kept answers at once, and an answer whose build
 * straddled a change in this process is never kept (`generation`). A kept
 * answer lives {@link KEEP_MS} at most even when the stamp never moves: the
 * bound on a change whose stamp write failed.
 *
 * The EDGE (edge-purge.ts) is told by the process that made the change, and
 * — because that process may have no edge keys (staging, a script, a local
 * backend) — by every API process that sees the stamp move
 * ({@link watchTrendCatalogForEdge}).
 */
import { randomUUID } from "node:crypto"
import { supabase } from "../../../lib/supabase.js"
import { requestTrendCatalogEdgePurge, trendCatalogEdgeConfigured } from "./edge-purge.js"

/** The `app_settings` key of the stamp. */
export const TRENDS_CATALOG_STAMP_KEY = "trends_catalog_stamp"

/** How long this process trusts a stamp it read: how soon a change made elsewhere is seen. */
export const STAMP_MEMO_MS = 2_000

/** The longest a kept answer is served while the stamp has not moved. */
export const KEEP_MS = 10 * 60 * 1000

/** How often an API process that can drop the edge's copies looks at the stamp. */
export const EDGE_WATCH_MS = 10_000

/** The edge's second purge waits until every process has read the new stamp, plus a margin. */
const EDGE_SETTLE_MS = STAMP_MEMO_MS + 3_000

/** At most this many kept answers (the least recently served go first). */
const MAX_KEPT = 500

/** A stamp read slower than this is treated as unreadable: the answer is built instead. */
const STAMP_READ_TIMEOUT_MS = 1_500

/** The stamp before any change ever wrote one. */
const NO_STAMP_YET = "none"

let memo: { stamp: string; at: number } | null = null
/** Moves with every change made in this process: an answer whose build straddled one is not kept. */
let generation = 0
const kept = new Map<string, { body: unknown; until: number }>()
let edgeWatch: ReturnType<typeof setInterval> | null = null
let edgeWatchSeen: string | null = null

function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

async function readStamp(): Promise<string | null> {
  const { data, error } = await supabase.from("app_settings").select("value").eq("key", TRENDS_CATALOG_STAMP_KEY).maybeSingle()
  if (error) return null
  const value = (data as { value?: unknown } | null)?.value
  if (value === undefined) return NO_STAMP_YET
  return typeof value === "string" && value.length > 0 ? value : null
}

/** The catalog's current stamp, or null when it cannot be read (then nothing is kept or served kept). */
export async function trendCatalogStamp(): Promise<string | null> {
  if (memo && Date.now() - memo.at < STAMP_MEMO_MS) return memo.stamp
  const before = generation
  const stamp = await withTimeout(readStamp(), STAMP_READ_TIMEOUT_MS)
  if (stamp === null) return null
  // A read that a change in this process overtook may have read the old stamp: used once, never remembered.
  if (generation === before) memo = { stamp, at: Date.now() }
  return stamp
}

/** This process's change count, read before a guest's answer is built and handed back to {@link keepGuestAnswer}. */
export function trendCatalogGeneration(): number {
  return generation
}

/** The answer kept for `key` under `stamp`, or undefined. */
export function keptGuestAnswer(stamp: string, key: string): unknown {
  const id = `${stamp}\u0000${key}`
  const entry = kept.get(id)
  if (!entry) return undefined
  if (entry.until <= Date.now()) {
    kept.delete(id)
    return undefined
  }
  // Most recently served last: the eviction below drops from the front.
  kept.delete(id)
  kept.set(id, entry)
  return entry.body
}

/**
 * Keep a guest's built 200 answer for `key` under the stamp read before it was
 * built — unless this process changed the catalog since (`builtAt`, the
 * generation read with the stamp): such a build may hold the old catalog.
 */
export function keepGuestAnswer(stamp: string, key: string, body: unknown, builtAt: number): void {
  if (builtAt !== generation) return
  const id = `${stamp}\u0000${key}`
  kept.delete(id)
  kept.set(id, { body, until: Date.now() + KEEP_MS })
  while (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next().value
    if (oldest === undefined) break
    kept.delete(oldest)
  }
}

function forgetKept(): void {
  generation += 1
  memo = null
  kept.clear()
}

/**
 * The catalog changed: this process's kept answers dropped at once, a new
 * stamp (every other process's become misses within {@link STAMP_MEMO_MS}),
 * and the edge asked to drop its copies. Called after the write succeeded.
 * Never throws: true when the new stamp was written; false (logged) when it
 * was not, and the other processes then keep their answers up to
 * {@link KEEP_MS}.
 */
export async function trendCatalogChanged(): Promise<boolean> {
  forgetKept()
  const written = await withTimeout(
    supabase.from("app_settings").upsert({ key: TRENDS_CATALOG_STAMP_KEY, value: randomUUID() }, { onConflict: "key" }),
    STAMP_READ_TIMEOUT_MS * 2,
  )
  // Again: a stamp read while the write was in flight still saw the old one.
  forgetKept()
  requestTrendCatalogEdgePurge(EDGE_SETTLE_MS)
  if (!written || written.error) {
    console.error("[trends] could not move the catalog stamp; other processes keep their answers until they expire", written?.error ?? "timed out")
    return false
  }
  return true
}

/**
 * In an API process, look at the stamp every {@link EDGE_WATCH_MS} while this
 * deployment can drop the edge's copies, and drop them when it moved: the
 * process that made the change may have had no edge keys. Started once;
 * never keeps the process alive.
 */
export function watchTrendCatalogForEdge(): void {
  if (edgeWatch) return
  edgeWatch = setInterval(() => {
    if (!trendCatalogEdgeConfigured()) return
    void withTimeout(readStamp(), STAMP_READ_TIMEOUT_MS).then((stamp) => {
      if (stamp === null) return
      if (edgeWatchSeen !== null && stamp !== edgeWatchSeen) requestTrendCatalogEdgePurge(EDGE_SETTLE_MS)
      edgeWatchSeen = stamp
    })
  }, EDGE_WATCH_MS)
  edgeWatch.unref?.()
}

/** Test-only: forget the memo, every kept answer and the edge watch. */
export function _resetTrendCatalogCacheForTests(): void {
  memo = null
  kept.clear()
  if (edgeWatch) clearInterval(edgeWatch)
  edgeWatch = null
  edgeWatchSeen = null
}
