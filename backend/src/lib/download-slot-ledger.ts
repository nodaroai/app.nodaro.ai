/**
 * The account's download slots, in Redis (decided 2026-10-08).
 *
 * An account may have a handful of video downloads RUNNING at once
 * (`MAX_ACTIVE_DOWNLOADS_PER_USER`). The count used to live in each process's
 * memory, so the API process (the route, the app runner's card) and the
 * orchestrator process (a run's pre-run fetch) each allowed the whole cap and
 * one account could run twice as many. This ledger makes the cap ONE number
 * across processes — and across replicas, since it is keyed by the ACCOUNT, not
 * by a container (a download's cost is the account's proxy bandwidth and the
 * fleet's yt-dlp work, not one box's memory).
 *
 * THE LEDGER is one sorted set per account — lease id → expiry — and every
 * decision is one Lua script, so it is atomic across processes. Modelled on the
 * ffmpeg memory ledger (`providers/video/ffmpeg-memory-ledger.ts`):
 *
 *   acquire   drop expired leases, COUNT the live ones, admit when below the
 *             cap. Refused: nothing is written and the count is returned.
 *   renew     upsert the lease with a fresh expiry — the heartbeat; it also puts
 *             back a lease that expired under a stall or an outage while its
 *             download kept running (the work is in progress either way).
 *   release   delete the lease.
 *
 * The count is never a counter: it is the number of LIVE leases at every
 * decision, so it cannot drift. A lease is only as alive as its heartbeat — a
 * process that dies stops renewing and its slots free themselves when the TTL
 * passes. `now` comes from the caller; replicas share a wall clock to within
 * far less than the TTL.
 *
 * Every call is bounded by `commandTimeoutMs`: a call that errors or times out
 * THROWS — `download-slots.ts` decides what to do (it falls back to the local
 * cap, which is the safe direction: the process alone still never exceeds it).
 */

/** The slice of an ioredis client the ledger uses. */
export interface DownloadLedgerClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
}

/** How long a lease lives without a heartbeat, and how often the holder renews it. */
export const DOWNLOAD_LEASE_TTL_MS = 30_000
export const DOWNLOAD_LEASE_HEARTBEAT_MS = 10_000
/** The longest one ledger call may take before it counts as failed. */
export const DOWNLOAD_LEDGER_COMMAND_TIMEOUT_MS = 2_000

/** KEYS: expiries (zset). ARGV: now, lease id, cap, ttl ms. */
const ACQUIRE_LUA = `
local now = tonumber(ARGV[1])
local cap = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local held = redis.call('ZCARD', KEYS[1])
if held >= cap then return {0, held} end
redis.call('ZADD', KEYS[1], now + ttl, ARGV[2])
redis.call('PEXPIRE', KEYS[1], ttl * 4)
return {1, held + 1}
`

/** KEYS: expiries. ARGV: now, lease id, ttl ms. */
const RENEW_LUA = `
redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[3]), ARGV[2])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 4)
return 1
`

/** KEYS: expiries. ARGV: lease id. */
const RELEASE_LUA = `
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`

/** The scripts, exported so a test double can recognise which one it was handed. */
export const DOWNLOAD_LEDGER_SCRIPTS = { acquire: ACQUIRE_LUA, renew: RENEW_LUA, release: RELEASE_LUA } as const

export interface DownloadAcquireResult {
  readonly acquired: boolean
  /** The account's live leases in the ledger — including this one when acquired. */
  readonly held: number
}

export interface DownloadLedgerOptions {
  /** The client, read on every call (a connection may be replaced). */
  readonly client: () => DownloadLedgerClient
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
      timer = setTimeout(() => reject(new Error(`download slot ledger ${what} timed out after ${ms} ms`)), ms)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

export class RedisDownloadLedger {
  private readonly now: () => number
  readonly ttlMs: number
  private readonly commandTimeoutMs: number

  constructor(private readonly options: DownloadLedgerOptions) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DOWNLOAD_LEASE_TTL_MS
    this.commandTimeoutMs = options.commandTimeoutMs ?? DOWNLOAD_LEDGER_COMMAND_TIMEOUT_MS
  }

  /** `{…}` is a hash tag, so the key is one slot on a clustered Redis. */
  private key(userId: string): string {
    return `download:slots:{${userId}}`
  }

  /** Take a slot under lease `leaseId` if the account is below `cap`. Throws
   *  when Redis errors or does not answer in time. */
  async acquire(userId: string, leaseId: string, cap: number): Promise<DownloadAcquireResult> {
    const raw = await this.run("acquire", ACQUIRE_LUA, userId, this.now(), leaseId, cap, this.ttlMs)
    if (!Array.isArray(raw) || raw.length < 2) throw new Error("download slot ledger: unexpected acquire reply")
    return { acquired: Number(raw[0]) === 1, held: Number(raw[1]) }
  }

  /** Extend (or re-create) the lease — the heartbeat. */
  async renew(userId: string, leaseId: string): Promise<void> {
    await this.run("renew", RENEW_LUA, userId, this.now(), leaseId, this.ttlMs)
  }

  /** Delete the lease. */
  async release(userId: string, leaseId: string): Promise<void> {
    await this.run("release", RELEASE_LUA, userId, leaseId)
  }

  private run(what: string, script: string, userId: string, ...args: Array<string | number>): Promise<unknown> {
    let call: Promise<unknown>
    try {
      // Redis EVAL of the constant scripts above — nothing user-supplied is evaluated.
      call = this.options.client().eval(script, 1, this.key(userId), ...args)
    } catch (error) {
      return Promise.reject(error)
    }
    return bounded(call, this.commandTimeoutMs, what)
  }
}
