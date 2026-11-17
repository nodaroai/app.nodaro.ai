// @reads-none talks only to Redis; reads no repo file
import { redis } from "./queue.js"

/**
 * What one account may have going on the large-upload lane
 * (`routes/large-upload.ts`), kept in Redis so it holds across processes and
 * replicas:
 *
 * - at most {@link MAX_OPEN_LARGE_UPLOADS} OPEN uploads — started, not yet
 *   completed or aborted, and not expired. Each is a member of the account's
 *   sorted set scored by its token's expiry, so an upload a browser abandoned
 *   frees its slot on its own when its token expires;
 * - at most {@link MAX_LARGE_UPLOAD_STARTS_PER_HOUR} starts per hour (a fixed
 *   window), so opening and aborting in a loop is bounded too.
 *
 * Both are checked and taken in ONE Lua script, so two starts at once cannot
 * both pass. `/start` fails CLOSED when Redis cannot answer: without the count
 * the lane would be unbounded.
 */

export const MAX_OPEN_LARGE_UPLOADS = 3
export const MAX_LARGE_UPLOAD_STARTS_PER_HOUR = 20
const HOUR_MS = 60 * 60 * 1000

/** The account's open uploads (a sorted set: member = object key, score = expiry ms). */
export const openUploadsKey = (userId: string) => `upload:large:open:${userId}`
/** The account's starts in the current hour. */
export const uploadStartsKey = (userId: string, now: number) => `upload:large:starts:${userId}:${Math.floor(now / HOUR_MS)}`

/**
 * KEYS[1] open set, KEYS[2] start counter. ARGV: now ms, expiry ms of this
 * upload, member, max open, max starts, counter TTL seconds.
 * Answers 0 taken, 1 too many open, 2 too many starts.
 */
export const CLAIM_LARGE_UPLOAD_LUA = `
local starts = tonumber(redis.call('GET', KEYS[2]) or '0')
if starts >= tonumber(ARGV[5]) then return 2 end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[4]) then return 1 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIREAT', KEYS[1], ARGV[2])
if redis.call('INCR', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[6]) end
return 0
`

/** The slice of the Redis client the slots use (a test passes a twin). */
export interface SlotsClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  zrem(key: string, member: string): Promise<unknown>
}

export type ClaimOutcome = "taken" | "too_many_open" | "rate_limited"

/**
 * Take a slot for the upload stored at `member` (its object key) until
 * `expiresAt`. Throws when Redis cannot answer — the caller refuses the start.
 * The set's own expiry is moved to this upload's, which is the latest of the
 * set's: every token lives as long.
 */
export async function claimLargeUploadSlot(
  userId: string,
  member: string,
  expiresAt: number,
  now: number = Date.now(),
  client: SlotsClient = redis as unknown as SlotsClient,
): Promise<ClaimOutcome> {
  const answer = await client.eval(
    CLAIM_LARGE_UPLOAD_LUA,
    2,
    openUploadsKey(userId),
    uploadStartsKey(userId, now),
    String(now),
    String(expiresAt),
    member,
    String(MAX_OPEN_LARGE_UPLOADS),
    String(MAX_LARGE_UPLOAD_STARTS_PER_HOUR),
    String(Math.ceil(HOUR_MS / 1000) + 60),
  )
  if (answer === 0) return "taken"
  if (answer === 1) return "too_many_open"
  if (answer === 2) return "rate_limited"
  throw new Error(`large-upload slots: unexpected answer ${String(answer)}`)
}

/** Give the slot back (best-effort: an unreleased slot frees itself at the token's expiry). */
export async function releaseLargeUploadSlot(
  userId: string,
  member: string,
  client: SlotsClient = redis as unknown as SlotsClient,
): Promise<void> {
  await client.zrem(openUploadsKey(userId), member).catch((err: unknown) => {
    console.error("[large-upload] could not release an open-upload slot:", err)
  })
}
