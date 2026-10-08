// The download-slot ledger against a REAL Redis and the real Lua (decided
// 2026-10-08). The JS twin the other suite runs on cannot catch a Lua mistake —
// a string where a number is due, a wrong key — so the same contract runs here
// whenever a Redis is reachable. Skipped (not failed) when none is. CI sets
// FFMPEG_LEDGER_REQUIRE_REDIS=1 in the job that has a Redis service ("FFmpeg
// Ledger (real Redis)"), where an unreachable Redis FAILS instead of skipping.
//
// It talks to FFMPEG_LEDGER_TEST_REDIS_URL, else localhost:6379 — deliberately
// NOT REDIS_URL, which a developer's .env may point at a shared Redis. Every
// key is namespaced by a random account id and deleted afterwards.
import { describe, it, expect, afterAll } from "vitest"
import IORedis from "ioredis"
import { runDownloadLedgerContract } from "./download-ledger-contract.js"

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

describe.runIf(process.env.FFMPEG_LEDGER_REQUIRE_REDIS === "1")("the real-Redis suite is required here", () => {
  it("a Redis is reachable, so the suite below runs instead of skipping", () => {
    expect(redis, `no Redis reachable at ${URL} (FFMPEG_LEDGER_REQUIRE_REDIS=1)`).toBeDefined()
  })
})

describe.skipIf(!redis)("RedisDownloadLedger — the contract on a real Redis and the real Lua", () => {
  runDownloadLedgerContract(() => ({
    client: () => redis!,
    cleanup: async (ids) => {
      for (const id of ids) await redis!.del(`download:slots:{${id}}`)
    },
  }))
})
