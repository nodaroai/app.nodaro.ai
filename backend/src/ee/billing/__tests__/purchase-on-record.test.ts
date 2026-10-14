import { describe, it, expect, vi, beforeEach } from "vitest"

const { calls, answer } = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  answer: { count: 0 as number | null, error: null as unknown },
}))

vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "gt"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return chain
    }
  }
  chain.then = (resolve: (v: unknown) => void) => resolve({ count: answer.count, error: answer.error })
  return { supabase: { from: () => chain } }
})

import { hasPurchaseOnRecord, invalidatePurchaseOnRecordCache } from "../purchase-on-record.js"

beforeEach(() => {
  calls.length = 0
  answer.count = 0
  answer.error = null
  invalidatePurchaseOnRecordCache()
})

describe("hasPurchaseOnRecord — a real payment, never a card on file", () => {
  it("counts only completed transactions for more than zero dollars", async () => {
    answer.count = 1
    expect(await hasPurchaseOnRecord("u1")).toBe(true)
    expect(calls).toContainEqual(["eq", ["status", "completed"]])
    expect(calls).toContainEqual(["gt", ["amount_usd", 0]])
  })

  it("no such row (a trial, a $0 invoice, a card on file) is not a purchase", async () => {
    answer.count = 0
    expect(await hasPurchaseOnRecord("u2")).toBe(false)
  })

  it("a failed read keeps the limits on", async () => {
    answer.count = null
    answer.error = { message: "boom" }
    expect(await hasPurchaseOnRecord("u3")).toBe(false)
  })
})
