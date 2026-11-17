// The large-upload slots: at most 3 open uploads and 20 starts an hour per
// account. The contract runs on a JS twin of the Lua here, and on a REAL Redis
// with the real Lua whenever one is reachable (FFMPEG_LEDGER_TEST_REDIS_URL,
// else localhost:6379 — never REDIS_URL); skipped, not failed, when none is.
import { afterAll, describe, expect, it } from "vitest"
import IORedis from "ioredis"
import {
  CLAIM_LARGE_UPLOAD_LUA,
  MAX_LARGE_UPLOAD_STARTS_PER_HOUR,
  MAX_OPEN_LARGE_UPLOADS,
  claimLargeUploadSlot,
  openUploadsKey,
  releaseLargeUploadSlot,
  uploadStartsKey,
  type SlotsClient,
} from "../large-upload-slots.js"

/** A JS twin of CLAIM_LARGE_UPLOAD_LUA over an in-memory store. */
function twin(): SlotsClient & { down: boolean } {
  const zsets = new Map<string, Map<string, number>>()
  const counters = new Map<string, number>()
  const client = {
    down: false,
    async eval(script: string, _n: number, ...args: Array<string | number>) {
      if (client.down) throw new Error("redis down")
      expect(script).toBe(CLAIM_LARGE_UPLOAD_LUA)
      const [open, rate, now, exp, member, maxOpen, maxRate] = args.map(String) as [string, string, string, string, string, string, string]
      if ((counters.get(rate) ?? 0) >= Number(maxRate)) return 2
      const set = zsets.get(open) ?? zsets.set(open, new Map()).get(open)!
      for (const [m, score] of [...set]) if (score <= Number(now)) set.delete(m)
      if (set.size >= Number(maxOpen)) return 1
      set.set(member, Number(exp))
      counters.set(rate, (counters.get(rate) ?? 0) + 1)
      return 0
    },
    async zrem(key: string, member: string) {
      if (client.down) throw new Error("redis down")
      return zsets.get(key)?.delete(member) ? 1 : 0
    },
  }
  return client
}

function contract(make: () => SlotsClient, user: () => string) {
  const T0 = 1_800_000_000_000
  const HOUR = 60 * 60 * 1000

  it("takes up to 3 open uploads, refuses the 4th, and a released one frees its slot", async () => {
    const c = make()
    const u = user()
    for (let i = 0; i < MAX_OPEN_LARGE_UPLOADS; i++) {
      expect(await claimLargeUploadSlot(u, `k${i}`, T0 + HOUR, T0, c)).toBe("taken")
    }
    expect(await claimLargeUploadSlot(u, "k3", T0 + HOUR, T0, c)).toBe("too_many_open")
    await releaseLargeUploadSlot(u, "k1", c)
    expect(await claimLargeUploadSlot(u, "k3", T0 + HOUR, T0, c)).toBe("taken")
  })

  it("an expired upload frees its slot on its own", async () => {
    const c = make()
    const u = user()
    for (let i = 0; i < MAX_OPEN_LARGE_UPLOADS; i++) await claimLargeUploadSlot(u, `k${i}`, T0 + 1000, T0, c)
    expect(await claimLargeUploadSlot(u, "late", T0 + 2 * HOUR, T0 + 1001, c)).toBe("taken")
  })

  it("counts per account", async () => {
    const c = make()
    const a = user()
    const b = user()
    for (let i = 0; i < MAX_OPEN_LARGE_UPLOADS; i++) await claimLargeUploadSlot(a, `k${i}`, T0 + HOUR, T0, c)
    expect(await claimLargeUploadSlot(b, "k0", T0 + HOUR, T0, c)).toBe("taken")
  })

  it("allows 20 starts an hour, released or not, then refuses until the next hour", async () => {
    const c = make()
    const u = user()
    for (let i = 0; i < MAX_LARGE_UPLOAD_STARTS_PER_HOUR; i++) {
      expect(await claimLargeUploadSlot(u, `k${i}`, T0 + HOUR, T0, c)).toBe("taken")
      await releaseLargeUploadSlot(u, `k${i}`, c)
    }
    expect(await claimLargeUploadSlot(u, "one-more", T0 + HOUR, T0, c)).toBe("rate_limited")
    expect(await claimLargeUploadSlot(u, "next-hour", T0 + 3 * HOUR, T0 + HOUR, c)).toBe("taken")
  })
}

let seq = 0
describe("large-upload slots — JS twin", () => {
  contract(twin, () => `user-${++seq}`)

  it("throws when Redis cannot answer (the route refuses the start)", async () => {
    const c = twin()
    c.down = true
    await expect(claimLargeUploadSlot("u", "k", 2, 1, c)).rejects.toThrow("redis down")
  })

  it("keys: one open set per account, one start counter per account and hour", () => {
    expect(openUploadsKey("u")).toBe("upload:large:open:u")
    expect(uploadStartsKey("u", 0)).not.toBe(uploadStartsKey("u", 60 * 60 * 1000))
  })
})

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
const real = await connect()
const realUsers: string[] = []
afterAll(async () => {
  if (real) {
    for (const u of realUsers) await real.del(openUploadsKey(u), ...[0, 1, 2, 3].map((h) => uploadStartsKey(u, 1_800_000_000_000 + h * 3_600_000)))
    real.disconnect()
  }
})

describe.skipIf(!real)("large-upload slots — real Redis and the real Lua", () => {
  contract(() => real as unknown as SlotsClient, () => {
    const u = `test-${crypto.randomUUID()}`
    realUsers.push(u)
    return u
  })
})
