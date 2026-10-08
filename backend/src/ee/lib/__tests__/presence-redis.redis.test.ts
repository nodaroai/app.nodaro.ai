// The presence store against a REAL Redis — the fake in presence-redis.test.ts
// replays what the store sends, which cannot catch Redis answering differently
// (an argument order, a LIMIT form, a reply shape). Skipped (not failed) when no
// Redis is reachable; CI's "FFmpeg Ledger (real Redis)" job sets
// FFMPEG_LEDGER_REQUIRE_REDIS=1, where an unreachable Redis FAILS instead.
//
// It talks to FFMPEG_LEDGER_TEST_REDIS_URL, else localhost:6379 — deliberately
// NOT REDIS_URL — under a random key prefix, deleted afterwards, so it never
// touches live notes.
import { afterAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import IORedis from "ioredis"
import { MAX_SURFACES_PER_USER, RedisPresenceStore } from "../presence-redis.js"
import { PRESENCE_TTL_MS, type PresenceEntry } from "../presence.js"

const URL = process.env.FFMPEG_LEDGER_TEST_REDIS_URL ?? "redis://localhost:6379"
const PREFIX = `presence-test:${randomUUID()}`

async function connect(): Promise<IORedis | undefined> {
  const client = new IORedis(URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 500, enableOfflineQueue: false })
  client.on("error", () => undefined)
  try {
    await client.connect()
    await client.ping()
    return client
  } catch {
    client.disconnect()
    return undefined
  }
}

const redis = await connect()
afterAll(async () => {
  if (!redis) return
  const keys = await redis.keys(`${PREFIX}:*`)
  if (keys.length > 0) await redis.del(...keys)
  redis.disconnect()
})

const note = (over: Partial<PresenceEntry>): PresenceEntry => ({
  userId: "u1",
  source: "web",
  detail: "app.nodaro.ai",
  address: "203.0.113.7",
  country: "IL",
  userAgent: "Chrome",
  lastSeenAt: Date.now(),
  ...over,
})

describe.runIf(process.env.FFMPEG_LEDGER_REQUIRE_REDIS === "1")("the real-Redis suite is required here", () => {
  it("a Redis is reachable, so the suite below runs instead of skipping", () => {
    expect(redis, `no Redis reachable at ${URL} (FFMPEG_LEDGER_REQUIRE_REDIS=1)`).toBeDefined()
  })
})

describe.skipIf(!redis)("RedisPresenceStore on a real Redis", () => {
  const store = () => new RedisPresenceStore(redis!, PREFIX)

  it("a user's surfaces come back newest first, each note replacing the last for its surface", async () => {
    const now = Date.now()
    await store().put(note({ userId: "a", lastSeenAt: now - 2_000 }))
    await store().put(note({ userId: "a", detail: "studio.nodaro.ai", lastSeenAt: now - 1_000 }))
    await store().put(note({ userId: "a", lastSeenAt: now }))
    const seen = (await store().since(now - 60_000)).filter((e) => e.userId === "a")
    expect(seen.map((e) => [e.detail, e.lastSeenAt])).toEqual([
      ["app.nodaro.ai", now],
      ["studio.nodaro.ai", now - 1_000],
    ])
    const ttl = await redis!.pttl(`${PREFIX}:user:a`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(PRESENCE_TTL_MS)
  })

  it("keeps a user's most recent surfaces only, however many names they invent", async () => {
    const now = Date.now()
    for (let i = 0; i < MAX_SURFACES_PER_USER + 5; i++) await store().put(note({ userId: "b", source: "mcp", detail: `client-${i}`, lastSeenAt: now - 100 + i }))
    expect(await redis!.hlen(`${PREFIX}:user:b`)).toBe(MAX_SURFACES_PER_USER)
    const kept = (await store().since(now - 60_000)).filter((e) => e.userId === "b").map((e) => e.detail)
    expect(kept).toEqual(Array.from({ length: MAX_SURFACES_PER_USER }, (_, i) => `client-${MAX_SURFACES_PER_USER + 4 - i}`))
  })

  it("the user index forgets anyone older than the TTL, and a read asks only from a moment on", async () => {
    const now = Date.now()
    await store().put(note({ userId: "old", lastSeenAt: now - PRESENCE_TTL_MS - 1 }))
    await store().put(note({ userId: "c", lastSeenAt: now }))
    expect(await redis!.zscore(`${PREFIX}:users`, "old")).toBeNull()
    expect((await store().since(now - 1)).map((e) => e.userId)).toEqual(["c"])
  })
})
