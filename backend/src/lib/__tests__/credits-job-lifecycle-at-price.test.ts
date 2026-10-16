/**
 * `commitReservedCreditsForJobAtPrice` — a job answered by a cheaper model than
 * the one it reserved for (describe-to-picker's Gemini fallback) is charged
 * that model's price: `commit_credits` takes the actual amount and returns the
 * rest of the hold in the same commit. Never more than was reserved; a price
 * that cannot be read commits the hold whole, as a plain commit would.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  holds: [] as Array<{ id: string; credits_used?: number | null }>,
  price: 11 as number | Error,
  commits: [] as Array<[string, number | undefined]>,
  priced: [] as string[],
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: h.holds, error: null }) }) }),
    }),
  },
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    getModelCreditCost: async (id: string) => {
      h.priced.push(id)
      if (h.price instanceof Error) throw h.price
      return h.price
    },
    commitCredits: async (id: string, actual?: number) => { h.commits.push([id, actual]) },
  },
}))

import { commitReservedCreditsForJobAtPrice } from "../credits-job-lifecycle.js"

describe("commitReservedCreditsForJobAtPrice", () => {
  beforeEach(() => {
    h.holds = [{ id: "log-1", credits_used: 28 }]
    h.price = 11
    h.commits = []
    h.priced = []
  })

  it("commits the hold at the answering model's marked-up price", async () => {
    await commitReservedCreditsForJobAtPrice("job-1", "describe-to-picker:economy")
    expect(h.priced).toEqual(["describe-to-picker:economy"])
    expect(h.commits).toEqual([["log-1", 11]])
  })

  it("never charges more than was reserved", async () => {
    h.price = 40
    await commitReservedCreditsForJobAtPrice("job-1", "describe-to-picker:economy")
    expect(h.commits).toEqual([["log-1", 28]])
  })

  it("a price it cannot read commits the hold whole, logged", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    h.price = new Error("Price not configured")
    await commitReservedCreditsForJobAtPrice("job-1", "describe-to-picker:economy")
    expect(h.commits).toEqual([["log-1", undefined]])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it("nothing held: nothing priced or committed", async () => {
    h.holds = []
    await commitReservedCreditsForJobAtPrice("job-1", "describe-to-picker:economy")
    expect(h.priced).toEqual([])
    expect(h.commits).toEqual([])
  })
})
