/**
 * Concurrent misses for one price id share one `model_pricing` read: a cold
 * quote (`/v1/ugc/quote`) asks many prices at once, and each id's row is read
 * once, not once per caller. A read that fails is not remembered; the cache
 * still serves the answer for 60 s.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  reads: [] as string[],
  gate: null as Promise<void> | null,
  rows: {} as Record<string, number>,
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          single: async () => {
            h.reads.push(id)
            if (h.gate) await h.gate
            const cost = h.rows[id]
            return cost === undefined
              ? { data: null, error: { code: "PGRST116" } }
              : { data: { credit_cost: cost, is_enabled: true, tier_restriction: null }, error: null }
          },
        }),
      }),
    }),
  },
}))

import { getModelCreditBaseCost, invalidateModelPricingCache, PriceNotConfiguredError } from "../credits.js"

beforeEach(() => {
  invalidateModelPricingCache()
  h.reads = []
  h.gate = null
  h.rows = {}
})

describe("a price row read is shared while it is under way", () => {
  it("three callers asking one cold id at once read its row once, and all get it", async () => {
    h.rows = { "row-a": 7 }
    let open!: () => void
    h.gate = new Promise((resolve) => { open = resolve })
    const asks = [getModelCreditBaseCost("row-a"), getModelCreditBaseCost("row-a"), getModelCreditBaseCost("row-a")]
    open()
    for (const priced of await Promise.all(asks)) expect(priced.creditCost).toBe(7)
    expect(h.reads).toEqual(["row-a"])
  })

  it("two ids are two reads", async () => {
    h.rows = { "row-a": 7, "row-b": 9 }
    const [a, b] = await Promise.all([getModelCreditBaseCost("row-a"), getModelCreditBaseCost("row-b")])
    expect([a.creditCost, b.creditCost]).toEqual([7, 9])
    expect(h.reads.sort()).toEqual(["row-a", "row-b"])
  })

  it("an id priced nowhere fails every caller sharing the read, and the next ask reads again", async () => {
    let open!: () => void
    h.gate = new Promise((resolve) => { open = resolve })
    const asks = [getModelCreditBaseCost("nowhere-xyz"), getModelCreditBaseCost("nowhere-xyz")]
    open()
    for (const ask of asks) await expect(ask).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(h.reads).toEqual(["nowhere-xyz"])
    h.gate = null
    await expect(getModelCreditBaseCost("nowhere-xyz")).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(h.reads).toEqual(["nowhere-xyz", "nowhere-xyz"])
  })

  it("an invalidation while a read is under way: the next ask starts its own read", async () => {
    h.rows = { "row-a": 7 }
    let open!: () => void
    h.gate = new Promise((resolve) => { open = resolve })
    const first = getModelCreditBaseCost("row-a")
    await vi.waitFor(() => expect(h.reads).toHaveLength(1))
    invalidateModelPricingCache()
    h.rows = { "row-a": 8 }
    const second = getModelCreditBaseCost("row-a")
    open()
    expect((await first).creditCost).toBe(8)
    expect((await second).creditCost).toBe(8)
    expect(h.reads).toEqual(["row-a", "row-a"])
  })
})
