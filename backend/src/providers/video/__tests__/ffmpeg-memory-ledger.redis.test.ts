// The ffmpeg memory ledger against a REAL Redis and the real Lua scripts
// (decided 2026-10-05). The JS twin the other suite runs on cannot catch a Lua
// mistake — a string where a number is due, an integer division, a wrong key —
// so the same contract runs here whenever a Redis is reachable. Skipped (not
// failed) when none is — a developer's machine usually has one (`redis-server`).
// CI sets FFMPEG_LEDGER_REQUIRE_REDIS=1 in the job that has a Redis service
// ("FFmpeg Ledger (real Redis)"), where an unreachable Redis FAILS instead of
// skipping, so the real scripts can never silently stop being exercised.
//
// It talks to FFMPEG_LEDGER_TEST_REDIS_URL, else localhost:6379 — deliberately
// NOT REDIS_URL, which a developer's .env may point at a shared Redis. Every
// key is namespaced by a random container id and deleted afterwards.
import { describe, it, expect, afterAll, vi } from "vitest"
import IORedis from "ioredis"
import { randomUUID } from "node:crypto"
import { RedisMemoryLedger } from "../ffmpeg-memory-ledger.js"
import { ContainerMemoryGate } from "../ffmpeg-memory-gate.js"
import { runLedgerContract } from "./ledger-contract.js"

const URL = process.env.FFMPEG_LEDGER_TEST_REDIS_URL ?? "redis://localhost:6379"

// The production client factory builds its connection from the BullMQ one in
// lib/queue.ts; here that is a client of the test Redis (never REDIS_URL).
vi.mock("../../../lib/queue.js", async () => {
  const { default: Redis } = await import("ioredis")
  const url = process.env.FFMPEG_LEDGER_TEST_REDIS_URL ?? "redis://localhost:6379"
  return { redis: new Redis(url, { maxRetriesPerRequest: null }) }
})

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
  it("a Redis is reachable, so the suites below run instead of skipping", () => {
    expect(redis, `no Redis reachable at ${URL} (FFMPEG_LEDGER_REQUIRE_REDIS=1)`).toBeDefined()
  })
})

describe.skipIf(!redis)("RedisMemoryLedger — the contract on a real Redis and the real Lua", () => {
  runLedgerContract(() => ({
    client: () => redis!,
    cleanup: async (ids) => {
      for (const id of ids) await redis!.del(`ffmpeg:mem:{${id}}:exp`, `ffmpeg:mem:{${id}}:mib`)
    },
  }))
})

describe.skipIf(!redis)("ContainerMemoryGate on a real Redis — two processes, one budget", () => {
  const BUDGET = 5000

  it("cannot exceed the budget, hands the memory over on release, and keeps containers apart", async () => {
    const id = `gate-${randomUUID()}`
    const other = `gate-${randomUUID()}`
    const mk = (container: string) =>
      new ContainerMemoryGate({ ledger: new RedisMemoryLedger({ client: () => redis!, containerId: container }), localShare: () => 0.5, log: () => undefined })
    const a = mk(id)
    const b = mk(id)
    const c = mk(other)
    try {
      const held = await a.tryReserve(3000, BUDGET)
      expect(held.reservation).toBeDefined()
      const refused = await b.tryReserve(3000, BUDGET)
      expect(refused.reservation).toBeUndefined()
      expect(refused.containerTotalMiB).toBe(3000)
      expect((await c.tryReserve(5000, BUDGET)).reservation).toBeDefined() // another container: its own budget
      held.reservation!.release()
      // release is sent before this reserve on the same connection pool order — poll briefly for it
      let got = false
      for (let k = 0; k < 20 && !got; k++) {
        got = (await b.tryReserve(3000, BUDGET)).reservation !== undefined
        if (!got) await new Promise((r) => setTimeout(r, 25))
      }
      expect(got).toBe(true)
    } finally {
      await redis!.del(`ffmpeg:mem:{${id}}:exp`, `ffmpeg:mem:{${id}}:mib`, `ffmpeg:mem:{${other}}:exp`, `ffmpeg:mem:{${other}}:mib`)
    }
  })

  it("an oversized launch holds the container alone, and a dead Redis falls back instead of hanging", async () => {
    const id = `gate-${randomUUID()}`
    const dead = new IORedis("redis://127.0.0.1:1", { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 0, retryStrategy: () => null })
    dead.on("error", () => undefined)
    const logs: string[] = []
    try {
      const live = new ContainerMemoryGate({ ledger: new RedisMemoryLedger({ client: () => redis!, containerId: id }), localShare: () => 0.5, log: () => undefined })
      const huge = await live.tryReserve(BUDGET + 1, BUDGET)
      expect(huge.reservation).toBeDefined()
      expect((await live.tryReserve(1, BUDGET)).reservation).toBeUndefined()
      huge.reservation!.release()

      const offline = new ContainerMemoryGate({ ledger: new RedisMemoryLedger({ client: () => dead, containerId: id }), localShare: () => 0.5, log: (m) => logs.push(m) })
      const t0 = Date.now()
      const local = await offline.tryReserve(2000, BUDGET) // within the 2500 local share
      expect(Date.now() - t0).toBeLessThan(2500)
      expect(local.reservation).toBeDefined()
      expect((await offline.tryReserve(1000, BUDGET)).reservation).toBeUndefined() // 3000 > 2500
      expect(logs).toHaveLength(1)
    } finally {
      dead.disconnect()
      await redis!.del(`ffmpeg:mem:{${id}}:exp`, `ffmpeg:mem:{${id}}:mib`)
    }
  })
})

describe.skipIf(!redis)("createFfmpegMemoryLedger — the production client, built fresh", () => {
  it("the FIRST reserve after boot works: the client is ready before the gate gets it, so no false outage", async () => {
    const replica = `boot-${randomUUID()}`
    const before = process.env.RAILWAY_REPLICA_ID
    process.env.RAILWAY_REPLICA_ID = replica
    const logs: string[] = []
    try {
      const { createFfmpegMemoryLedger } = await import("../../../lib/ffmpeg-memory-redis.js")
      const built = await createFfmpegMemoryLedger()
      expect(built.containerId).toBe(replica)
      expect(built.containerIdSource).toBe("RAILWAY_REPLICA_ID")
      const gate = new ContainerMemoryGate({ ledger: built.ledger, localShare: () => 0.5, log: (m) => logs.push(m) })
      const first = await gate.tryReserve(1000, 5000) // the very first command on the new connection
      expect(first.reservation).toBeDefined()
      expect(gate.ledgerDown).toBe(false)
      expect(logs).toEqual([]) // not an outage, and nothing logged as one
      expect(await redis!.hlen(`ffmpeg:mem:{${replica}}:mib`)).toBe(1) // it really went through Redis, not the local share
      first.reservation!.release()
    } finally {
      if (before === undefined) delete process.env.RAILWAY_REPLICA_ID
      else process.env.RAILWAY_REPLICA_ID = before
      await redis!.del(`ffmpeg:mem:{${replica}}:exp`, `ffmpeg:mem:{${replica}}:mib`)
    }
  })
})
