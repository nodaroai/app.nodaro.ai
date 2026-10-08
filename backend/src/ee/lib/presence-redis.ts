import type { Redis } from "ioredis"
import { JOB_SOURCES } from "../../lib/job-source.js"
import { redis } from "../../lib/queue.js"
import { PRESENCE_TTL_MS, surfaceKey, type PresenceEntry, type PresenceStore } from "./presence.js"

/**
 * The presence notes in Redis, bounded however a caller behaves.
 *
 * One hash per user — a field per surface, at most MAX_SURFACES_PER_USER, the
 * least recent dropped first — expiring PRESENCE_TTL_MS after the user's last
 * note; and one sorted set of users by their last note, trimmed to the TTL and
 * to MAX_USERS on every write. A caller can name its surface freely (an
 * Origin, an MCP client, a client header), so the bounds are per user and in
 * all, never per name. The job queue shares this Redis.
 */
const PREFIX = "presence:v2"
export const MAX_SURFACES_PER_USER = 8
export const MAX_USERS = 5_000
/** What one read of the list returns at most — the newest. */
export const MAX_LISTED_USERS = 500
/** A command Redis does not answer in this long fails, and the list says nothing rather than hang. */
const COMMAND_TIMEOUT_MS = 2_000

const SOURCES: ReadonlySet<string> = new Set(JOB_SOURCES.filter((source) => source !== "internal"))

/** A field's value: when, then the note — so trimming reads the time without parsing the note. */
const fieldValue = (entry: PresenceEntry) => `${entry.lastSeenAt}\t${JSON.stringify(entry)}`
const seenAtOf = (value: string) => Number(value.slice(0, value.indexOf("\t")))

/** A stored note as written, or null for anything else. */
function parseEntry(value: string): PresenceEntry | null {
  try {
    const entry = JSON.parse(value.slice(value.indexOf("\t") + 1)) as Partial<PresenceEntry>
    if (typeof entry.userId !== "string" || typeof entry.lastSeenAt !== "number" || !SOURCES.has(String(entry.source))) return null
    return entry as PresenceEntry
  } catch {
    return null
  }
}

/** A transaction's or pipeline's replies, or the first error any command answered. */
function repliesOf(results: Array<[Error | null, unknown]> | null): unknown[] {
  if (!results) throw new Error("Redis discarded the transaction")
  for (const [error] of results) if (error) throw error
  return results.map(([, reply]) => reply)
}

type PresenceRedis = Pick<Redis, "multi" | "pipeline" | "zrevrangebyscore" | "hgetall" | "hdel">

export class RedisPresenceStore implements PresenceStore {
  private readonly users: string
  private readonly userKey: (userId: string) => string

  /** `prefix` only for a test on a real Redis, so it never touches live notes. */
  constructor(
    private readonly client: PresenceRedis,
    prefix = PREFIX,
  ) {
    this.users = `${prefix}:users`
    this.userKey = (userId) => `${prefix}:user:${userId}`
  }

  async put(entry: PresenceEntry): Promise<void> {
    const key = this.userKey(entry.userId)
    const replies = repliesOf(
      await this.client
        .multi()
        .hset(key, surfaceKey(entry), fieldValue(entry))
        .pexpire(key, PRESENCE_TTL_MS)
        .hlen(key)
        .zadd(this.users, entry.lastSeenAt, entry.userId)
        .zremrangebyscore(this.users, "-inf", entry.lastSeenAt - PRESENCE_TTL_MS)
        .zremrangebyrank(this.users, 0, -(MAX_USERS + 1))
        .exec(),
    )
    if (Number(replies[2]) > MAX_SURFACES_PER_USER) await this.trimSurfaces(key)
  }

  /** Drops a user's least recent surfaces past the cap. Not atomic with the write, and need not be: a race only trims later. */
  private async trimSurfaces(key: string): Promise<void> {
    const fields = Object.entries(await this.client.hgetall(key)).sort(([, a], [, b]) => seenAtOf(b) - seenAtOf(a))
    const extra = fields.slice(MAX_SURFACES_PER_USER).map(([field]) => field)
    if (extra.length > 0) await this.client.hdel(key, ...extra)
  }

  async since(since: number): Promise<PresenceEntry[]> {
    const userIds = await this.client.zrevrangebyscore(this.users, "+inf", since, "LIMIT", 0, MAX_LISTED_USERS)
    if (userIds.length === 0) return []
    const pipeline = this.client.pipeline()
    for (const userId of userIds) pipeline.hgetall(this.userKey(userId))
    const hashes = repliesOf(await pipeline.exec()) as Array<Record<string, string>>
    const entries = hashes.flatMap((hash) =>
      Object.values(hash ?? {}).flatMap((value) => {
        const entry = parseEntry(value)
        return entry && entry.lastSeenAt >= since ? [entry] : []
      }),
    )
    return entries.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }
}

/**
 * The store on its own connection — the BullMQ one retries forever and queues
 * every command while it is down, which would leave the notes waiting on a dead
 * Redis. This one fails a command at once while disconnected, gives up after
 * COMMAND_TIMEOUT_MS, and reconnects on its own (as `download-slots-redis.ts`).
 * Resolves once connected — or after the timeout, when Redis does not answer:
 * a client with no offline queue refuses every command while still connecting,
 * so the first note after each boot would fail and say so.
 */
export async function createPresenceStore(): Promise<PresenceStore> {
  const client = redis.duplicate({ maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: COMMAND_TIMEOUT_MS })
  // A failed command is the recorder's business; a connection error is not an unhandled event.
  client.on("error", () => undefined)
  await connectedOrTimedOut(client)
  return new RedisPresenceStore(client)
}

function connectedOrTimedOut(client: ReturnType<typeof redis.duplicate>): Promise<void> {
  if (client.status === "ready") return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      client.off("ready", done)
      resolve()
    }
    const timer = setTimeout(done, COMMAND_TIMEOUT_MS)
    timer.unref?.()
    client.once("ready", done)
  })
}
