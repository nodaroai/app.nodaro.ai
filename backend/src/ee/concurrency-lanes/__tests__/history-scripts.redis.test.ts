// The lane history scripts against a REAL Redis and the real Lua. The JS twin
// cannot catch a Lua mistake (a cjson null, an empty table encoded as an
// object, a number printed in exponent form, a wrong key), so the same
// contract runs here whenever a Redis is reachable. Skipped (not failed) when
// none is; CI sets FFMPEG_LEDGER_REQUIRE_REDIS=1 in the job that has a Redis
// service, where an unreachable Redis FAILS instead.
//
// It talks to FFMPEG_LEDGER_TEST_REDIS_URL, else localhost:6379 — never
// REDIS_URL. Every case runs under its own random key prefix, deleted after.
import { afterAll, describe, expect, it } from "vitest"
import IORedis from "ioredis"
import { randomUUID } from "node:crypto"
import type { HistoryClient } from "../history.js"
import { runHistoryScriptsContract } from "./history-scripts-contract.js"

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

async function keysUnder(prefix: string): Promise<string[]> {
  const out: string[] = []
  let cursor = "0"
  do {
    const [next, keys] = await redis!.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500)
    cursor = next
    out.push(...keys)
  } while (cursor !== "0")
  return out
}

describe.runIf(process.env.FFMPEG_LEDGER_REQUIRE_REDIS === "1")("the real-Redis history suite is required here", () => {
  it("a Redis is reachable, so the suite below runs instead of skipping", () => {
    expect(redis, `no Redis reachable at ${URL} (FFMPEG_LEDGER_REQUIRE_REDIS=1)`).toBeDefined()
  })
})

describe.skipIf(!redis)("lane history scripts — the contract on a real Redis and the real Lua", () => {
  runHistoryScriptsContract(() => {
    const prefix = `cl:test:${randomUUID()}:hist:production:`
    return {
      client: redis! as unknown as HistoryClient,
      prefix,
      keys: () => keysUnder(prefix),
      ttlOf: async (k) => {
        const t = await redis!.pttl(k)
        return t > 0 ? t : null
      },
      cleanup: async () => {
        const keys = await keysUnder(prefix)
        if (keys.length > 0) await redis!.del(...keys)
      },
    }
  })
})
