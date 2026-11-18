import { describe, it, expect } from "vitest"
import { usdToCredits } from "@nodaro/shared/credits"
import { COST_SHORTFALL_RULE, judgeCostShortfall, pauseWindow, type CostShortfallJob, type PauseCandidate } from "../cost-shortfall.js"
import { anomalyToleranceCredits } from "../credit-anomaly.js"

const committed = (charged: number, used = charged) => ({ status: "committed", credits_used: used, credits_charged: charged })
const job = (over: Partial<CostShortfallJob>): CostShortfallJob => ({
  providerCostUsd: 0.1,
  usageLog: committed(50),
  sideCharged: 0,
  sharedUsageLog: false,
  ...over,
})

describe("judgeCostShortfall", () => {
  it("flags a flat-priced job that committed its reservation below the provider's GPU-time bill", () => {
    // The shape that went unnoticed: a fixed price reserved and committed
    // (8 credits), while the provider billed by GPU time.
    const verdict = judgeCostShortfall(job({ providerCostUsd: 0.159, usageLog: committed(8) }))
    expect(verdict).toEqual({
      kind: "cost_shortfall",
      chargedCredits: 8,
      costCredits: usdToCredits(0.159),
      shortfallCredits: usdToCredits(0.159) - 8,
      countsTowardPause: true,
    })
  })

  it("passes a job charged exactly its provider cost", () => {
    const providerCredits = usdToCredits(0.1)
    expect(judgeCostShortfall(job({ usageLog: committed(providerCredits) }))).toMatchObject({ kind: "covered", costCredits: providerCredits })
  })

  it("passes a job charged above cost", () => {
    expect(judgeCostShortfall(job({ usageLog: committed(500) })).kind).toBe("covered")
  })

  it("ignores a shortfall inside the anomaly tolerance (rounding)", () => {
    const providerCredits = usdToCredits(0.1)
    expect(judgeCostShortfall(job({ usageLog: committed(providerCredits - anomalyToleranceCredits()) })).kind).toBe("covered")
    expect(judgeCostShortfall(job({ usageLog: committed(providerCredits - anomalyToleranceCredits() - 1) })).kind).toBe("cost_shortfall")
  })

  it("counts toward a pause only when charged under half the cost", () => {
    const providerCredits = usdToCredits(1) // 500 credits
    const half = providerCredits * COST_SHORTFALL_RULE.maxChargedShareOfCost
    expect(judgeCostShortfall(job({ providerCostUsd: 1, usageLog: committed(half) }))).toMatchObject({ kind: "cost_shortfall", countsTowardPause: false })
    expect(judgeCostShortfall(job({ providerCostUsd: 1, usageLog: committed(half - 1) }))).toMatchObject({ kind: "cost_shortfall", countsTowardPause: true })
  })

  it("adds the job's settled side holds to its charge", () => {
    const providerCredits = usdToCredits(0.1)
    expect(judgeCostShortfall(job({ usageLog: committed(10), sideCharged: providerCredits - 10 })).kind).toBe("covered")
  })

  it("skips a job with no provider cost, or a cost of zero or less", () => {
    expect(judgeCostShortfall(job({ providerCostUsd: null }))).toEqual({ kind: "skip", reason: "no_provider_cost" })
    expect(judgeCostShortfall(job({ providerCostUsd: 0 }))).toEqual({ kind: "skip", reason: "no_provider_cost" })
    expect(judgeCostShortfall(job({ providerCostUsd: -1 }))).toEqual({ kind: "skip", reason: "no_provider_cost" })
  })

  it("skips a job with no usage log", () => {
    expect(judgeCostShortfall(job({ usageLog: null }))).toEqual({ kind: "skip", reason: "no_usage_log" })
  })

  it("never judges a job whose hold is still open", () => {
    expect(judgeCostShortfall(job({ usageLog: { status: "reserved", credits_used: 8, credits_charged: null } }))).toEqual({ kind: "skip", reason: "settlement_pending" })
  })

  it("skips a refunded job", () => {
    expect(judgeCostShortfall(job({ usageLog: { status: "refunded", credits_used: 8, credits_charged: 0 } }))).toEqual({ kind: "skip", reason: "refunded" })
  })

  it("skips a run free by design (a zero-priced model reserves nothing)", () => {
    expect(judgeCostShortfall(job({ usageLog: committed(0, 0) }))).toEqual({ kind: "skip", reason: "free_by_design" })
  })

  it("skips a job whose usage log another job shares", () => {
    expect(judgeCostShortfall(job({ providerCostUsd: 1, usageLog: committed(8), sharedUsageLog: true }))).toEqual({ kind: "skip", reason: "shared_usage_log" })
  })
})

describe("pauseWindow", () => {
  const minute = 60_000
  const t0 = Date.parse("2026-11-18T10:00:00Z")
  const losing = (i: number, atMinute: number): PauseCandidate => ({ jobId: `j${i}`, completedAtMs: t0 + atMinute * minute, chargedCredits: 8, costCredits: 80 })

  it("does not pause on four cost-shortfall jobs", () => {
    expect(pauseWindow([0, 5, 10, 15].map((m, i) => losing(i, m)), null)).toBeNull()
  })

  it("pauses on the fifth cost-shortfall job inside the window", () => {
    const hit = pauseWindow([0, 5, 10, 15, 20].map((m, i) => losing(i, m)), null)
    expect(hit?.map((c) => c.jobId)).toEqual(["j0", "j1", "j2", "j3", "j4"])
  })

  it("does not pause when the five are spread over more than the window", () => {
    expect(pauseWindow([0, 20, 40, 55, 61].map((m, i) => losing(i, m)), null)).toBeNull()
  })

  it("finds a window anywhere in the run of jobs", () => {
    const hit = pauseWindow([0, 100, 110, 120, 130, 140].map((m, i) => losing(i, m)), null)
    expect(hit?.map((c) => c.jobId)).toEqual(["j1", "j2", "j3", "j4", "j5"])
  })

  it("ignores a small shortfall (charged at least half the cost)", () => {
    const small = [0, 1, 2, 3, 4].map((m, i) => ({ ...losing(i, m), chargedCredits: 40 }))
    expect(pauseWindow(small, null)).toBeNull()
  })

  it("counts only jobs completed after the model was last switched on", () => {
    const jobs = [0, 5, 10, 15, 20, 25].map((m, i) => losing(i, m))
    // Switched back on at minute 2: only five jobs are newer — still a pause.
    expect(pauseWindow(jobs, t0 + 2 * minute)).not.toBeNull()
    // Switched back on at minute 7: four newer jobs — no pause.
    expect(pauseWindow(jobs, t0 + 7 * minute)).toBeNull()
  })
})
