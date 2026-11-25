import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"
import path from "path"

// Storage-floor quartet (design §4.5): activation raise / admin-raised
// no-lower / cancel-with-lifetime → 10 GB / cancel-without → 1 GB — plus
// text-pins on the three writer paths and the reaper's load-bearing
// predicates (the just-canceled grace .or() must never be dropped).

const { mockFrom, tableResponses, updates } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  let lastMatched: { data: unknown; error: unknown } | null = null

  function createChain(table: string) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn(self),
      in: vi.fn(self),
      or: vi.fn(self),
      not: vi.fn(self),
      lt: vi.fn(self),
      gte: vi.fn(self),
      neq: vi.fn(self),
      is: vi.fn(self),
      limit: vi.fn(self),
      order: vi.fn(self),
      single: vi.fn(() => Promise.resolve(lastMatched ?? { data: null, error: null })),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        return chain
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(lastMatched ?? { data: null, error: null }).then(resolve),
    })
    return chain
  }

  const mockFrom = vi.fn((table: string) => {
    lastMatched = tableResponses.get(table) ?? null
    return createChain(table)
  })
  return { mockFrom, tableResponses, updates }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, rpc: vi.fn() },
}))

import {
  storageFloorFor,
  downgradeToEffectiveFloor,
  raiseStorageFloorOnActivation,
} from "../downgrade-floor.js"
import { TIER_STORAGE_LIMITS } from "../stripe-config.js"

const GB = 1024 * 1024 * 1024

beforeEach(() => {
  tableResponses.clear()
  updates.length = 0
})

describe("storageFloorFor", () => {
  it("payg floor = 10 GB, free floor = 1 GB", () => {
    expect(storageFloorFor(3300)).toBe(10 * GB)
    expect(storageFloorFor(1)).toBe(10 * GB)
    expect(storageFloorFor(0)).toBe(1 * GB)
  })
})

describe("downgradeToEffectiveFloor", () => {
  it("cancel-with-lifetime lands on the 10 GB floor with extras merged", async () => {
    tableResponses.set("profiles", {
      data: [{ id: "u1", lifetime_topup_credits: 3300 }],
      error: null,
    })
    const res = await downgradeToEffectiveFloor("u1", "pro", { subscription_ended_at: "now" })
    expect(res.isPayg).toBe(true)
    const write = updates.find((u) => u.table === "profiles")
    expect(write?.payload.storage_limit_bytes).toBe(10 * GB)
    expect(write?.payload.tier).toBe("free")
    expect(write?.payload.subscription_tier).toBe("free")
    expect(write?.payload.subscription_ended_at).toBe("now")
  })

  it("cancel-without-lifetime lands on the 1 GB free floor", async () => {
    tableResponses.set("profiles", {
      data: [{ id: "u1", lifetime_topup_credits: 0 }],
      error: null,
    })
    const res = await downgradeToEffectiveFloor("u1", "pro")
    expect(res.isPayg).toBe(false)
    const write = updates.find((u) => u.table === "profiles")
    expect(write?.payload.storage_limit_bytes).toBe(1 * GB)
    // From Pro (private outputs) to Free (none): the setting returns to public.
    expect(write?.payload.public_outputs).toBe(true)
  })

  it("from a plan without private outputs (Basic), the outputs setting is left alone", async () => {
    tableResponses.set("profiles", { data: [{ id: "u1", lifetime_topup_credits: 0 }], error: null })
    await downgradeToEffectiveFloor("u1", "basic")
    const write = updates.find((u) => u.table === "profiles")
    expect(write?.payload.tier).toBe("free")
    expect(write?.payload).not.toHaveProperty("public_outputs")
  })
})

describe("raiseStorageFloorOnActivation", () => {
  it("first purchase raises a below-floor limit to 10 GB", async () => {
    tableResponses.set("profiles", {
      data: { tier: "free", subscription_tier: null, lifetime_topup_credits: 3300, storage_limit_bytes: 1 * GB },
      error: null,
    })
    await raiseStorageFloorOnActivation("u1")
    expect(updates.find((u) => u.table === "profiles")?.payload.storage_limit_bytes).toBe(10 * GB)
  })

  it("admin-raised limit is never lowered", async () => {
    tableResponses.set("profiles", {
      data: { tier: "free", subscription_tier: null, lifetime_topup_credits: 3300, storage_limit_bytes: 50 * GB },
      error: null,
    })
    await raiseStorageFloorOnActivation("u1")
    expect(updates).toHaveLength(0)
  })

  it("subscribers and never-paid users are untouched", async () => {
    tableResponses.set("profiles", {
      data: { tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 3300, storage_limit_bytes: 1 * GB },
      error: null,
    })
    await raiseStorageFloorOnActivation("sub")
    tableResponses.set("profiles", {
      data: { tier: "free", subscription_tier: null, lifetime_topup_credits: 0, storage_limit_bytes: 1 * GB },
      error: null,
    })
    await raiseStorageFloorOnActivation("never-paid")
    expect(updates).toHaveLength(0)
  })
})

describe("writer-path + reaper text pins", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(__dirname, "..", rel), "utf8")

  it("all three downgrade writers route through the floor helpers", () => {
    // The webhook and the expiry safety net end a plan through endPaidPlan,
    // which writes through downgradeToEffectiveFloor (the payg floor split).
    const floor = read("downgrade-floor.ts")
    expect(floor).toMatch(/export async function endPaidPlan[\s\S]*downgradeToEffectiveFloor\(/)
    const provision = read("provision-credits.ts")
    expect(provision).toContain("endPaidPlan(userId")
    expect(provision).toContain("raiseStorageFloorOnActivation(userId)")
    const cleanup = read("cleanup-service.ts")
    expect(cleanup).toContain("downgradeToEffectiveFloor(user.id")
    expect(cleanup).toContain("endPaidPlan(id")
  })

  it("the reaper keeps BOTH legacy predicates and gains the retention filter", () => {
    const cleanup = read("cleanup-service.ts")
    expect(cleanup).toContain('.or("tier.eq.free,tier.is.null")')
    expect(cleanup).toMatch(/subscription_ended_at\.is\.null,subscription_ended_at\.lt\./)
    expect(cleanup).toContain("isPaygRetentionActive")
    expect(cleanup).toContain('select("id, lifetime_topup_credits, last_topup_at")')
  })

  it("floor values stay tied to the entitlement map", () => {
    expect(TIER_STORAGE_LIMITS.payg).toBe(10 * GB)
    expect(TIER_STORAGE_LIMITS.free).toBe(1 * GB)
  })
})
