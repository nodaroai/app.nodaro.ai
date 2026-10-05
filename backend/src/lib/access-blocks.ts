/**
 * Who is blocked — accounts and networks — as ONE in-memory snapshot per
 * process, read on every authenticated request and before any spend.
 *
 * WHY A SNAPSHOT AND NOT A PER-USER READ. A block is rare and the list is
 * short; the check is not. Loading the whole list every 30 s costs two queries
 * per process regardless of traffic, where a per-user read would cost one per
 * active user per TTL. Stale-while-refresh: a request never waits for a refresh
 * except the very first one in a process (bounded at 3 s).
 *
 * WHY 30 s IS THE LAG. An admin's block invalidates THIS process at once; every
 * other process (the other replicas, the orchestrator and workers) sees it at
 * its next refresh. Staging and production keep separate Redis but share the
 * database, so the database is the only channel both see.
 *
 * TABLES THAT ARE NOT THERE YET. Migrations reach the database only on a push
 * to main, so staging runs this code for days before 458 exists. A missing
 * table before the first successful load means "nothing is blocked" (re-probed
 * every 5 min, quietly); after a successful load, any failure keeps the last
 * good list rather than lifting every block on a database hiccup.
 *
 * Inert unless `hasAdmin()`: only an edition with an admin panel can create a
 * block, so Community never queries the tables.
 */

import { supabase } from "./supabase.js"
import { hasAdmin } from "./config.js"
import { isMissingTableError } from "./postgrest-errors.js"
import { compileCidrList, networkKey, type CidrMatcher } from "./ip-address.js"
import { networkHash } from "./client-address.js"
import { ReserveRpcError, mapReserveError, type MappedReserveError } from "./reserve-errors.js"

/** The one answer a blocked caller gets — account or network, deliberately the
 *  same: separate codes would tell a farmer which signal to change. */
export const ACCESS_BLOCKED_CODE = "access_blocked"
export const ACCESS_BLOCKED_BODY = {
  error: {
    code: ACCESS_BLOCKED_CODE,
    message: "Access has been blocked. If you think this is a mistake, contact support.",
  },
} as const

const REFRESH_MS = 30_000
const NOT_READY_RETRY_MS = 5 * 60_000
const FIRST_LOAD_LIMIT_MS = 3_000
/**
 * A read that never answers must not wedge the snapshot: while one is in
 * flight no refresh starts, so a hung query would freeze this process on the
 * list it had (and make every first check wait). Past this it is a failed read.
 */
const LOAD_TIMEOUT_MS = 10_000
/** PostgREST's row cap: an unpaged read silently stops at it. */
const PAGE = 1000

interface Snapshot {
  users: ReadonlySet<string>
  networkHashes: ReadonlySet<string>
  ranges: CidrMatcher
  /** False until the tables have been read once (missing schema, or no read yet). */
  ready: boolean
  loadedAt: number
}

const EMPTY_RANGES = compileCidrList([])

let snapshot: Snapshot | null = null
let inflight: Promise<void> | null = null
let everLoaded = false
let lastWarnAt = 0
/** Set by an admin change in THIS process: the next check waits for the re-read. */
let mustAwait = false

type PageQuery = (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { code?: string | null; message?: string } | null }>

/**
 * Every row, a page at a time, until a page comes back EMPTY. Stopping on a
 * short page would trust that the server's page is PAGE rows: a PostgREST
 * `max-rows` set lower answers short pages and would silently drop every
 * block past the first one. The next page starts after the rows actually
 * returned, for the same reason.
 */
async function readAll<T>(query: PageQuery): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; ) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) throw error
    const page = (data ?? []) as T[]
    if (page.length === 0) return rows
    rows.push(...page)
    from += page.length
  }
}

async function readLists(): Promise<{
  users: Array<{ user_id: string }>
  nets: Array<{ network_hash: string | null; cidr: string | null }>
}> {
  const users = await readAll<{ user_id: string }>((from, to) =>
    supabase.from("account_blocks").select("user_id").order("user_id").range(from, to),
  )
  const nets = await readAll<{ network_hash: string | null; cidr: string | null }>((from, to) =>
    supabase
      .from("blocked_networks")
      .select("network_hash, cidr")
      .gt("expires_at", new Date().toISOString())
      .order("id")
      .range(from, to),
  )
  return { users, nets }
}

/** The read, or a failure once LOAD_TIMEOUT_MS has passed without an answer. */
function withinLoadTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${LOAD_TIMEOUT_MS / 1000} s`)), LOAD_TIMEOUT_MS)
    ;(timer as { unref?: () => void }).unref?.()
  })
  // An abandoned read may still fail later: that must not surface as an
  // unhandled rejection, which ends a Node process.
  work.catch(() => {})
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

async function load(): Promise<void> {
  try {
    const { users, nets } = await withinLoadTimeout(readLists())
    snapshot = {
      users: new Set(users.map((u) => u.user_id)),
      networkHashes: new Set(nets.map((n) => n.network_hash).filter((h): h is string => typeof h === "string")),
      ranges: compileCidrList(nets.map((n) => n.cidr).filter((c): c is string => typeof c === "string")),
      ready: true,
      loadedAt: Date.now(),
    }
    everLoaded = true
  } catch (err) {
    const missing = isMissingTableError(err as { code?: string | null })
    if (missing && !everLoaded) {
      snapshot = { users: new Set(), networkHashes: new Set(), ranges: EMPTY_RANGES, ready: false, loadedAt: Date.now() }
      return
    }
    // Keep the last good list; try again soon. With none at all, nothing is
    // blocked until a read succeeds — a database outage stops everything else
    // anyway, and refusing every request on top of it would not help anyone.
    snapshot = snapshot
      ? { ...snapshot, loadedAt: Date.now() - REFRESH_MS + 5_000 }
      : { users: new Set(), networkHashes: new Set(), ranges: EMPTY_RANGES, ready: false, loadedAt: Date.now() - NOT_READY_RETRY_MS + 5_000 }
    if (Date.now() - lastWarnAt > 60_000) {
      lastWarnAt = Date.now()
      console.warn("[access-blocks] could not read the block lists:", (err as { message?: string })?.message ?? err)
    }
  }
}

/**
 * Start a read, AFTER any read already running: a read that began before an
 * admin's write may return the old list, so an invalidation queues a fresh one
 * behind it rather than waiting on it.
 */
function startLoad(): Promise<void> {
  const prior = inflight ?? Promise.resolve()
  const next: Promise<void> = prior.then(load, load).finally(() => {
    if (inflight === next) inflight = null
  })
  inflight = next
  return next
}

function isStale(s: Snapshot | null): boolean {
  if (!s) return true
  return Date.now() - s.loadedAt >= (s.ready ? REFRESH_MS : NOT_READY_RETRY_MS)
}

async function current(): Promise<Snapshot | null> {
  if (!hasAdmin()) return null
  if (isStale(snapshot) && !inflight) startLoad()
  if ((!snapshot || mustAwait) && inflight) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([inflight, new Promise((resolve) => (timer = setTimeout(resolve, FIRST_LOAD_LIMIT_MS)))])
    clearTimeout(timer)
    mustAwait = false
  }
  return snapshot
}

/** Is this account blocked? Never true on an edition without an admin panel. */
export async function isUserBlocked(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  const s = await current()
  return s?.users.has(userId) ?? false
}

/** Is any account blocked at all? Lets a caller skip a read when none is. */
export async function anyUserBlocked(): Promise<boolean> {
  const s = await current()
  return (s?.users.size ?? 0) > 0
}

/** Is this client address inside a live network block? */
export async function isAddressBlocked(address: string | null | undefined): Promise<boolean> {
  if (!address) return false
  const s = await current()
  if (!s) return false
  if (s.ranges.matches(address)) return true
  if (s.networkHashes.size === 0) return false
  const key = networkKey(address)
  return key !== null && s.networkHashes.has(networkHash(key))
}

/**
 * Every reserve site calls this FIRST (`__tests__/access-blocks-totality.test.ts`
 * fails the build on one that does not): a blocked account reserves nothing,
 * on any lane, and the refusal is the reserve vocabulary's own
 * (`ACCOUNT_BLOCKED` → 403 `access_blocked`), so each site's existing catch
 * already answers it.
 */
export async function refuseBlockedReservation(userId: string | null | undefined): Promise<void> {
  if (await isUserBlocked(userId)) {
    throw new ReserveRpcError("ACCOUNT_BLOCKED", "ACCOUNT_BLOCKED: reservation refused for a blocked account")
  }
}

/** The same refusal for the lanes that answer `{ ok: false }` instead of throwing. */
export async function blockedReservationRefusal(userId: string | null | undefined): Promise<MappedReserveError | null> {
  if (!(await isUserBlocked(userId))) return null
  return mapReserveError(new ReserveRpcError("ACCOUNT_BLOCKED", "ACCOUNT_BLOCKED"))
}

/**
 * After an admin change: this process re-reads now, and the next check waits
 * for it — the admin's own process enforces at once, the others within one
 * refresh.
 */
export function invalidateAccessBlocks(): void {
  if (!hasAdmin()) return
  if (snapshot) snapshot = { ...snapshot, loadedAt: 0 }
  mustAwait = true
  startLoad()
}

/** For the admin page: how big, how fresh, and whether the tables exist yet. */
export async function accessBlocksStatus(): Promise<{
  ready: boolean
  users: number
  networks: number
  loadedAt: string | null
}> {
  const s = await current()
  if (!s) return { ready: false, users: 0, networks: 0, loadedAt: null }
  return {
    ready: s.ready,
    users: s.users.size,
    networks: s.networkHashes.size + s.ranges.size,
    loadedAt: s.ready ? new Date(s.loadedAt).toISOString() : null,
  }
}

/** Test hook. */
export function __resetAccessBlocksForTests(): void {
  snapshot = null
  inflight = null
  everLoaded = false
  lastWarnAt = 0
  mustAwait = false
}
