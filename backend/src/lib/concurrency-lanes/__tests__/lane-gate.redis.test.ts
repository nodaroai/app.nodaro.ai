// The concurrency gate against a REAL Redis and the real Lua (decided
// 2026-10-30). The JS twin the other suite runs on cannot catch a Lua mistake —
// a string where a number is due, a cjson null, an empty table encoded as an
// object, a wrong key — so the same contract runs here whenever a Redis is
// reachable. Skipped (not failed) when none is. CI sets
// FFMPEG_LEDGER_REQUIRE_REDIS=1 in the job that has a Redis service ("FFmpeg
// Ledger (real Redis)"), where an unreachable Redis FAILS instead of skipping.
//
// It talks to FFMPEG_LEDGER_TEST_REDIS_URL, else localhost:6379 — deliberately
// NOT REDIS_URL, which a developer's .env may point at a shared Redis. Every
// case runs under its own random key prefix, deleted afterwards.
import { describe, it, expect, afterAll } from "vitest"
import IORedis from "ioredis"
import { randomUUID } from "node:crypto"
import { runLaneGateContract } from "./lane-gate-contract.js"

const URL = process.env.FFMPEG_LEDGER_TEST_REDIS_URL ?? "redis://localhost:6379"

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
afterAll(() => redis?.disconnect())

async function deletePrefix(prefix: string): Promise<void> {
  let cursor = "0"
  do {
    const [next, keys] = await redis!.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500)
    cursor = next
    if (keys.length > 0) await redis!.del(...keys)
  } while (cursor !== "0")
}

describe.runIf(process.env.FFMPEG_LEDGER_REQUIRE_REDIS === "1")("the real-Redis suite is required here", () => {
  it("a Redis is reachable, so the suite below runs instead of skipping", () => {
    expect(redis, `no Redis reachable at ${URL} (FFMPEG_LEDGER_REQUIRE_REDIS=1)`).toBeDefined()
  })
})

describe.skipIf(!redis)("ConcurrencyGate — the contract on a real Redis and the real Lua", () => {
  runLaneGateContract(() => {
    const prefix = `cl:test:${randomUUID()}:`
    return {
      client: () => redis!,
      prefix,
      zadd: async (key, score, member) => { await redis!.zadd(key, score, member) },
      cleanup: () => deletePrefix(prefix),
    }
  })
})
