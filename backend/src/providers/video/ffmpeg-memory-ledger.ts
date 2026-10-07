/**
 * The container's ffmpeg memory ledger, in Redis (decided 2026-10-05).
 *
 * One Railway container runs four processes (server, worker, render-worker,
 * orchestrator) under ONE memory limit, so the budget every ffmpeg launch
 * reserves from (`ffmpeg-memory.ts`) must be shared by all of them: per-process
 * accounting lets each spend the whole of it.
 *
 * THE LEDGER is two keys per container — a sorted set of lease expiries and a
 * hash of lease sizes — and every decision is one Lua script, so it is atomic
 * across processes:
 *
 *   reserve   drop expired leases, SUM the live ones, then admit when
 *             total + peak ≤ budget, or — a launch bigger than the whole
 *             budget — only when the total is 0. A live oversized lease makes
 *             `total + peak ≤ budget` false for everyone else, so nothing else
 *             reserves while it holds. Refused: nothing is written and the
 *             total is returned.
 *   renew     upsert the lease with a fresh expiry — the heartbeat; it also
 *             puts back a lease that expired under a long stall or an outage
 *             while its ffmpeg kept running (the memory is in use either way).
 *   release   delete the lease.
 *
 * The total is never a counter: it is summed from LIVE leases at every
 * decision, so it cannot drift. A lease is only as alive as its heartbeat — a
 * process that dies stops renewing and its memory frees itself when the TTL
 * passes. `now` comes from the caller: every process of one container shares
 * one clock (and a different container has a different key).
 *
 * Every call is bounded by `commandTimeoutMs`: the BullMQ connection retries
 * forever and queues commands while it is down, which would hang the launch.
 * A call that errors or times out THROWS — the gate above this decides what to
 * do (`ffmpeg-memory-gate.ts` falls back to the local share).
 */

/** The slice of an ioredis client the ledger uses. */
export interface LedgerClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
}

/** How long a lease lives without a heartbeat, and how often the holder renews it. */
export const FFMPEG_LEASE_TTL_MS = 30_000
export const FFMPEG_LEASE_HEARTBEAT_MS = 10_000
/** The longest one ledger call may take before it counts as failed. */
export const FFMPEG_LEDGER_COMMAND_TIMEOUT_MS = 2_000

/** KEYS: expiries (zset), sizes (hash). ARGV: now, lease id, peak MiB, budget MiB, ttl ms. */
const RESERVE_LUA = `
local now = tonumber(ARGV[1])
local peak = tonumber(ARGV[3])
local budget = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local dead = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)
for _, id in ipairs(dead) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('HDEL', KEYS[2], id)
end
local total = 0
for _, size in ipairs(redis.call('HVALS', KEYS[2])) do
  total = total + tonumber(size)
end
local fits
if peak > budget then fits = (total == 0) else fits = (total + peak <= budget) end
if not fits then return {0, total} end
redis.call('ZADD', KEYS[1], now + ttl, ARGV[2])
redis.call('HSET', KEYS[2], ARGV[2], peak)
redis.call('PEXPIRE', KEYS[1], ttl * 4)
redis.call('PEXPIRE', KEYS[2], ttl * 4)
return {1, total + peak}
`

/** KEYS: expiries, sizes. ARGV: now, lease id, peak MiB, ttl ms. */
const RENEW_LUA = `
redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[4]), ARGV[2])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]) * 4)
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[4]) * 4)
return 1
`

/** KEYS: expiries, sizes. ARGV: lease id. */
const RELEASE_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
return 1
`

/** The scripts, exported so a test double can recognise which one it was handed. */
export const FFMPEG_LEDGER_SCRIPTS = { reserve: RESERVE_LUA, renew: RENEW_LUA, release: RELEASE_LUA } as const

export interface LedgerReserveResult {
  readonly reserved: boolean
  /** The container's live total in MiB — including this lease when reserved. */
  readonly totalMiB: number
}

export interface MemoryLedgerOptions {
  /** The client, read on every call (a connection may be replaced). */
  readonly client: () => LedgerClient
  /** The container's identity — all its processes, and no other container, share it. */
  readonly containerId: string
  readonly now?: () => number
  readonly ttlMs?: number
  readonly commandTimeoutMs?: number
}

/** Rejects when `work` has not settled in `ms`; the late result is dropped. */
function bounded<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`ffmpeg memory ledger ${what} timed out after ${ms} ms`)), ms)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

export class RedisMemoryLedger {
  private readonly keys: [string, string]
  private readonly now: () => number
  readonly ttlMs: number
  private readonly commandTimeoutMs: number

  constructor(private readonly options: MemoryLedgerOptions) {
    // `{…}` is a hash tag: both keys land in one slot on a clustered Redis.
    const base = `ffmpeg:mem:{${options.containerId}}`
    this.keys = [`${base}:exp`, `${base}:mib`]
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? FFMPEG_LEASE_TTL_MS
    this.commandTimeoutMs = options.commandTimeoutMs ?? FFMPEG_LEDGER_COMMAND_TIMEOUT_MS
  }

  /** Take `peakMiB` under lease `leaseId` if it fits `budgetMiB`. Throws when
   *  Redis errors or does not answer in time. */
  async reserve(leaseId: string, peakMiB: number, budgetMiB: number): Promise<LedgerReserveResult> {
    const raw = await this.run("reserve", RESERVE_LUA, this.now(), leaseId, peakMiB, budgetMiB, this.ttlMs)
    if (!Array.isArray(raw) || raw.length < 2) throw new Error("ffmpeg memory ledger: unexpected reserve reply")
    return { reserved: Number(raw[0]) === 1, totalMiB: Number(raw[1]) }
  }

  /** Extend (or re-create) the lease — the heartbeat. */
  async renew(leaseId: string, peakMiB: number): Promise<void> {
    await this.run("renew", RENEW_LUA, this.now(), leaseId, peakMiB, this.ttlMs)
  }

  /** Delete the lease. */
  async release(leaseId: string): Promise<void> {
    await this.run("release", RELEASE_LUA, leaseId)
  }

  private run(what: string, script: string, ...args: Array<string | number>): Promise<unknown> {
    let call: Promise<unknown>
    try {
      // Redis EVAL of the constant scripts above — nothing user-supplied is evaluated.
      call = this.options.client().eval(script, 2, this.keys[0], this.keys[1], ...args)
    } catch (error) {
      return Promise.reject(error)
    }
    return bounded(call, this.commandTimeoutMs, what)
  }
}
