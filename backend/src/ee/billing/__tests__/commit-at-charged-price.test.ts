import { beforeEach, describe, expect, it, vi } from "vitest"

const { trySettleManagedCredits, commitCredits, getModelCreditCostFromDB, from, single, jobsUpdate } = vi.hoisted(() => {
  const single = vi.fn()
  const jobsUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
  const from = vi.fn((table: string) => table === "jobs"
    ? { update: jobsUpdate }
    : { select: vi.fn(() => ({ eq: vi.fn(() => ({ single, maybeSingle: single })) })) })
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

import { commitAtChargedPrice, settleAtChargedPrice } from "../commit-at-charged-price.js"

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

// Nemotron 3.5 Transcribe (decided 2026-11-12): held at the measured minutes,
// charged for the minutes KIE decoded — up OR down, through the metered settle.
describe("settleAtChargedPrice — a run charged for what the provider reports, up or down", () => {
  it("an under-measured file charges MORE than the hold: the overrun is collected (commit_credits_metered)", async () => {
    mockCharged("nemotron-3-5-transcribe:3m", 4)
    commitCredits.mockResolvedValue({ charged: 4, collectedOverHold: 2, shortfall: 0 })
    mockUsageLog({ credits_used: 2, status: "committed" })
    const result = await settleAtChargedPrice("ul", "job", "nemotron-3-5-transcribe:3m")
    expect(commitCredits).toHaveBeenCalledTimes(1)
    expect(commitCredits).toHaveBeenCalledWith("ul", 4, { collectOverHold: true })
    expect(jobsUpdate).toHaveBeenCalledWith({ credits_actual: 4 })
    expect(result).toEqual({ charged: 4, reserved: 2, collectedOverHold: 2, shortfall: 0 })
  })

  it("an over-measured file charges LESS than the hold: the rest is released", async () => {
    mockCharged("nemotron-3-5-transcribe:2m", 3)
    commitCredits.mockResolvedValue({ charged: 3, collectedOverHold: 0, shortfall: 0 })
    mockUsageLog({ credits_used: 50, status: "committed" })
    const result = await settleAtChargedPrice("ul", "job", "nemotron-3-5-transcribe:2m")
    expect(commitCredits).toHaveBeenCalledTimes(1)
    expect(commitCredits).toHaveBeenCalledWith("ul", 3, { collectOverHold: true })
    expect(jobsUpdate).toHaveBeenCalledWith({ credits_actual: 3 })
    expect(result.charged).toBe(3)
  })

  it("no receipt and the log still reserved: left reserved and loud, as settleCommitMetered leaves it — no second settlement", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    mockCharged("nemotron-3-5-transcribe:9m", 8)
    mockUsageLog({ credits_used: 5, status: "reserved" })
    const result = await settleAtChargedPrice("ul", "job", "nemotron-3-5-transcribe:9m")
    // Never a plain commit_credits, whose TS fallback would commit the WHOLE hold under a clamped credits_actual.
    expect(commitCredits).toHaveBeenCalledTimes(1)
    expect(commitCredits).toHaveBeenCalledWith("ul", 8, { collectOverHold: true })
    expect(jobsUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ charged: undefined, reserved: 5, collectedOverHold: 0, shortfall: 0 })
    expect(error.mock.calls.some((c: unknown[]) => String(c[0]).startsWith("[ALERT]"))).toBe(true)
    error.mockRestore()
  })

  it("no receipt because the log was already committed: nothing more is done", async () => {
    mockCharged("nemotron-3-5-transcribe:2m", 3)
    mockUsageLog({ credits_used: 2, status: "committed" })
    await settleAtChargedPrice("ul", "job", "nemotron-3-5-transcribe:2m")
    expect(commitCredits).toHaveBeenCalledTimes(1)
    expect(jobsUpdate).not.toHaveBeenCalled()
  })

  it("managed credits short-circuit", async () => {
    trySettleManagedCredits.mockResolvedValue(true)
    await settleAtChargedPrice("ul", "job", "nemotron-3-5-transcribe:2m")
    expect(commitCredits).not.toHaveBeenCalled()
    expect(getModelCreditCostFromDB).not.toHaveBeenCalled()
  })
})
