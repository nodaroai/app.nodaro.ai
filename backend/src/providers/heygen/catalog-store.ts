/**
 * Redis snapshot store for the HeyGen catalogs — the part of the catalog
 * that is SHARED across API instances and SURVIVES deploys.
 *
 * Two keys per catalog kind:
 *   • the SNAPSHOT — the last COMPLETE list as one JSON blob
 *     (`{ generation, filledAt, items }`, ≈4 MB for the avatar looks);
 *   • its META — `{ generation, filledAt }`, a few dozen bytes, written in
 *     the same Lua step. Instances poll the meta (cheap) to learn that a
 *     newer list exists and read the blob only then.
 * The snapshot is written exactly once per fill, when it finishes, and read
 * when a process needs the list (fresh boot, its own copy went stale, or a
 * sibling instance published a newer one). Partial fills never touch Redis.
 * A REFRESH of an existing snapshot is guarded by a lock so one instance per
 * environment refetches HeyGen, not each of them.
 *
 * Every Redis call is bounded by a short timeout and every failure degrades
 * to "no store": the shared client (`lib/queue.ts`) queues commands forever
 * while Redis is down (`maxRetriesPerRequest: null`), which is what BullMQ
 * wants but would hang a picker request. (A timed-out command stays in that
 * offline queue; the callers throttle themselves to a handful of commands per
 * minute, so an outage cannot pile up more than that.) The write is a Lua
 * compare-and-set on `filledAt`, so a delayed replay can never overwrite a
 * newer snapshot with an older one.
 */

import { randomBytes } from "node:crypto"
import { redis } from "../../lib/queue.js"

/** Bump when the stored shape changes — old blobs are simply ignored. */
const KEY_VERSION = "v1"

/** Bound on every Redis round-trip from the request path. */
const REDIS_TIMEOUT_MS = 1_500

/** A refresh fill takes ≈1.5–2 min; the lock outlives a stuck one. */
export const REFRESH_LOCK_TTL_MS = 15 * 60 * 1000

/** Snapshots expire on their own if nothing refreshes them for a long time. */
const SNAPSHOT_TTL_SECONDS = 14 * 24 * 60 * 60

/** Sanity net: the real avatar list is ≈4.4 MB; anything far beyond that is a
 *  runaway fill (looping cursor) that must not be published to every instance. */
export const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024

export interface StoredSnapshot<T> {
  readonly generation: string
  /** Epoch ms when the fill that produced it completed. */
  readonly filledAt: number
  readonly items: T[]
}

/** The cheap half of a snapshot: enough to know whether it is newer than ours. */
export interface StoredSnapshotMeta {
  readonly generation: string
  readonly filledAt: number
}

const snapshotKey = (kind: string) => `heygen:catalog:${KEY_VERSION}:${kind}`
const metaKey = (kind: string) => `heygen:catalog:${KEY_VERSION}:${kind}:meta`
const lockKey = (kind: string) => `heygen:catalog:${KEY_VERSION}:${kind}:refresh-lock`

/**
 * Only write when the stored snapshot is older (or absent) — a replayed or
 * slow write can never regress a newer snapshot. The stamp is read from the
 * small META key; a snapshot written before the meta existed (or with an
 * unreadable meta) is stamped from the blob itself, once. Nothing here can
 * raise: every decode is pcall-ed and every stamp goes through tonumber.
 *   KEYS[1] snapshot, KEYS[2] meta
 *   ARGV[1] snapshot json, ARGV[2] filledAt, ARGV[3] ttl seconds, ARGV[4] meta json
 */
const WRITE_IF_NEWER_LUA = `
local function stampOf(raw)
  if not raw then return nil end
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == "table" then return tonumber(decoded.filledAt) end
  return nil
end
local cur = stampOf(redis.call("get", KEYS[2]))
if cur == nil then cur = stampOf(redis.call("get", KEYS[1])) end
local mine = tonumber(ARGV[2])
if cur ~= nil and mine ~= nil and cur >= mine then
  return 0
end
redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[3])
redis.call("set", KEYS[2], ARGV[4], "EX", ARGV[3])
return 1
`

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("redis timeout")), REDIS_TIMEOUT_MS)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

function warn(op: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  // eslint-disable-next-line no-console
  console.warn(`[heygen/catalog-store] ${op} failed (serving from memory):`, msg)
}

function parseMeta(raw: string | null): StoredSnapshotMeta | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSnapshotMeta>
    if (typeof parsed.generation !== "string" || typeof parsed.filledAt !== "number") return null
    return { generation: parsed.generation, filledAt: parsed.filledAt }
  } catch {
    return null
  }
}

/** The stamp of the stored snapshot for `kind` — one tiny read — or null. */
export async function readSnapshotMeta(kind: string): Promise<StoredSnapshotMeta | null> {
  try {
    return parseMeta(await withTimeout(redis.get(metaKey(kind))))
  } catch (err) {
    warn(`read ${kind} meta`, err)
    return null
  }
}

/** The last complete snapshot for `kind`, or null (absent, unreadable, Redis down). */
export async function readSnapshot<T>(kind: string): Promise<StoredSnapshot<T> | null> {
  try {
    const raw = await withTimeout(redis.get(snapshotKey(kind)))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot<T>>
    if (
      typeof parsed.generation !== "string" ||
      typeof parsed.filledAt !== "number" ||
      !Array.isArray(parsed.items)
    ) return null
    return { generation: parsed.generation, filledAt: parsed.filledAt, items: parsed.items }
  } catch (err) {
    warn(`read ${kind}`, err)
    return null
  }
}

/** Publish a complete snapshot. Returns true when it became the stored one
 *  (false when a newer one was already there, when it is implausibly large,
 *  or when Redis was unavailable). */
export async function writeSnapshot<T>(kind: string, snap: StoredSnapshot<T>): Promise<boolean> {
  const json = JSON.stringify(snap)
  if (json.length > MAX_SNAPSHOT_BYTES) {
    warn(`write ${kind}`, new Error(`snapshot of ${snap.items.length} items is ${json.length} bytes — over the ${MAX_SNAPSHOT_BYTES}-byte sanity cap, not published`))
    return false
  }
  const meta: StoredSnapshotMeta = { generation: snap.generation, filledAt: snap.filledAt }
  try {
    const res = await withTimeout(
      redis.eval(
        WRITE_IF_NEWER_LUA, 2, snapshotKey(kind), metaKey(kind),
        json, String(snap.filledAt), String(SNAPSHOT_TTL_SECONDS), JSON.stringify(meta),
      ),
    )
    return res === 1
  } catch (err) {
    warn(`write ${kind}`, err)
    return false
  }
}

/** Try to become the one instance that refreshes `kind`. Returns an owner
 *  token to release with, or null when another instance holds the lock — or
 *  when Redis is unavailable, in which case the caller may refresh anyway
 *  (a duplicate fill costs HeyGen calls, not correctness). */
export async function acquireRefreshLock(kind: string): Promise<string | null> {
  const token = randomBytes(12).toString("hex")
  try {
    const ok = await withTimeout(redis.set(lockKey(kind), token, "PX", REFRESH_LOCK_TTL_MS, "NX"))
    return ok === "OK" ? token : null
  } catch (err) {
    warn(`lock ${kind}`, err)
    return null
  }
}

/** Whether Redis answered at all on the last lock attempt is not tracked; a
 *  caller that wants "lock or Redis down → go ahead" uses this probe. */
export async function isStoreReachable(): Promise<boolean> {
  try {
    await withTimeout(redis.ping())
    return true
  } catch {
    return false
  }
}

export async function releaseRefreshLock(kind: string, token: string): Promise<void> {
  try {
    await withTimeout(redis.eval(RELEASE_LOCK_LUA, 1, lockKey(kind), token))
  } catch {
    // The lock expires on its own; never fail a fill over a release hiccup.
  }
}
