/**
 * The reservation is a hard ceiling — `commit_credits` refunds a surplus but
 * never charges above it — so a turn that outspends its reservation is served
 * free. These pin the arithmetic that keeps the loop under it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const { settingsMock } = vi.hoisted(() => ({ settingsMock: vi.fn() }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: settingsMock }))

const { resolveTurnBudget, estimateNextCallUsd, wouldExceedBudget } = await import("../budget.js")
const { TURN_CAPS } = await import("../constants.js")
const { creditsToUsd } = await import("@nodaro/shared")

beforeEach(() => {
  settingsMock.mockReset()
  settingsMock.mockResolvedValue({ cost_markup_percent: 0, service_margin_percent: { "workflow-copilot": 20 } })
})

describe("resolveTurnBudget", () => {
  it("leaves headroom under the reservation and discounts the service rate", async () => {
    const budget = await resolveTurnBudget(150)
    const naive = creditsToUsd(150)
    expect(budget.limitUsd).toBeLessThan(naive)
    // 85% of the reservation, then divided by 1.2 for the configured rate.
    expect(budget.limitUsd).toBeCloseTo(creditsToUsd((150 * TURN_CAPS.budgetSafetyShare) / 1.2), 6)
  })

  it("scales with a smaller reservation (a low balance shortens the turn)", async () => {
    const small = await resolveTurnBudget(20)
    const large = await resolveTurnBudget(150)
    expect(small.limitUsd).toBeLessThan(large.limitUsd)
    expect(small.reservedCredits).toBe(20)
  })

  it("falls back to the global markup when no per-service rate is configured", async () => {
    settingsMock.mockResolvedValue({ cost_markup_percent: 0, service_margin_percent: {} })
    const budget = await resolveTurnBudget(100)
    expect(budget.limitUsd).toBeCloseTo(creditsToUsd(100 * TURN_CAPS.budgetSafetyShare), 6)
  })
})

describe("the SHIPPED ceiling admits a real turn", () => {
  it("does not refuse the first call, and affords several iterations", async () => {
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    const { COPILOT_MODEL_ID } = await import("../constants.js")
    const ceiling = STATIC_CREDIT_COSTS["workflow-copilot"]!
    const budget = await resolveTurnBudget(ceiling)
    // A realistic first call: the system prompt plus a working conversation.
    const first = estimateNextCallUsd(COPILOT_MODEL_ID, 30_000)
    expect(wouldExceedBudget(budget, 0, first), "the first call must not be refused").toBe(false)
    // …and enough headroom for a multi-step turn (cached prefix from #2 on).
    const cached = estimateNextCallUsd(COPILOT_MODEL_ID, 60_000, true)
    expect(wouldExceedBudget(budget, first + 3 * cached, cached)).toBe(false)
  })
})

describe("estimateNextCallUsd", () => {
  it("prices the prompt plus a typical reply, and grows with the prompt", () => {
    const small = estimateNextCallUsd("claude-sonnet-5", 4_000)
    const large = estimateNextCallUsd("claude-sonnet-5", 400_000)
    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
  })

  it("prices a cached prefix far below a fresh one", () => {
    const fresh = estimateNextCallUsd("claude-sonnet-5", 200_000)
    const cached = estimateNextCallUsd("claude-sonnet-5", 200_000, true)
    expect(cached).toBeLessThan(fresh)
  })
})

describe("wouldExceedBudget", () => {
  it("stops before the call that would break the ceiling, not after", () => {
    const budget = { limitUsd: 1, reservedCredits: 150 }
    expect(wouldExceedBudget(budget, 0.5, 0.4)).toBe(false)
    expect(wouldExceedBudget(budget, 0.5, 0.6)).toBe(true)
  })
})
