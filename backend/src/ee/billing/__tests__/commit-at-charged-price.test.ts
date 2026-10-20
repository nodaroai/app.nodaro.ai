import { beforeEach, describe, expect, it, vi } from "vitest"

const { trySettleManagedCredits, commitCredits, getModelCreditCostFromDB, from, single, jobsUpdate } = vi.hoisted(() => {
  const single = vi.fn()
  const jobsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  const from = vi.fn((table: string) => table === "jobs"
    ? { update: jobsUpdate }
    : { select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) })
  return {
    trySettleManagedCredits: vi.fn(),
    commitCredits: vi.fn(),
    getModelCreditCostFromDB: vi.fn(),
    from,
    single,
    jobsUpdate,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from } }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { trySettleManagedCredits, commitCredits },
  getModelCreditCostFromDB,
}))

import { commitAtChargedPrice } from "../commit-at-charged-price.js"

function mockUsageLog(row: Record<string, unknown> | null): void {
  single.mockResolvedValue({ data: row, error: null })
}
function mockCharged(id: string, creditCost: number): void {
  getModelCreditCostFromDB.mockImplementation(async (asked: string) => {
    if (asked !== id) throw new Error(`unexpected credit id ${asked}`)
    return { modelIdentifier: id, creditCost }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  trySettleManagedCredits.mockResolvedValue(false)
  commitCredits.mockResolvedValue(undefined)
})

describe("commitAtChargedPrice — a run settled at another id's charged price", () => {
  it("commits the fallback id's charged price", async () => {
    mockUsageLog({ credits_used: 44, action: "suno-separate" })
    mockCharged("audio-separation", 33)
    const result = await commitAtChargedPrice("ul", "job", "audio-separation")
    expect(commitCredits).toHaveBeenCalledWith("ul", 33)
    expect(jobsUpdate).toHaveBeenCalledWith({ credits_actual: 33 })
    expect(result).toEqual({ committed: 33, reserved: 44 })
  })

  it("clamps at the reservation", async () => {
    mockUsageLog({ credits_used: 44 })
    mockCharged("audio-separation:stems", 70)
    const result = await commitAtChargedPrice("ul", "job", "audio-separation:stems")
    expect(result.committed).toBe(44)
    expect(commitCredits).toHaveBeenCalledWith("ul", 44)
    expect(jobsUpdate).toHaveBeenCalledWith({ credits_actual: 44 })
  })

  it("commits the charged price when the reservation cannot be read", async () => {
    mockUsageLog(null)
    mockCharged("audio-separation", 33)
    expect(await commitAtChargedPrice("ul", "job", "audio-separation")).toEqual({ committed: 33, reserved: undefined })
    expect(commitCredits).toHaveBeenCalledWith("ul", 33)
  })

  it("managed credits short-circuit", async () => {
    trySettleManagedCredits.mockResolvedValue(true)
    await commitAtChargedPrice("ul", "job", "audio-separation")
    expect(commitCredits).not.toHaveBeenCalled()
    expect(jobsUpdate).not.toHaveBeenCalled()
    expect(getModelCreditCostFromDB).not.toHaveBeenCalled()
  })

  it("propagates a price lookup failure without committing", async () => {
    mockUsageLog({ credits_used: 44 })
    getModelCreditCostFromDB.mockRejectedValue(new Error("pricing unavailable"))
    await expect(commitAtChargedPrice("ul", "job", "audio-separation")).rejects.toThrow(/pricing unavailable/)
    expect(commitCredits).not.toHaveBeenCalled()
  })
})
