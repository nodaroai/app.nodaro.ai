import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseModelCreditCost = vi.fn()

vi.mock("../queries/use-credits-queries", () => ({
  useModelCreditCost: (...args: unknown[]) => mockUseModelCreditCost(...args),
  getCachedCredits: vi.fn(),
  prefetchModelCredits: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { useModelCredits, getCachedCredits, prefetchModelCredits, useModelCreditCost } from "../use-model-credits"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useModelCredits", () => {
  it("returns fallback (0) when model is undefined", () => {
    mockUseModelCreditCost.mockReturnValue({ data: undefined })

    const result = useModelCredits(undefined)

    expect(result).toBe(0)
  })

  it("returns credit cost from query data", () => {
    mockUseModelCreditCost.mockReturnValue({ data: 4 })

    const result = useModelCredits("flux")

    expect(result).toBe(4)
  })

  it("returns custom fallback when data is undefined", () => {
    mockUseModelCreditCost.mockReturnValue({ data: undefined })

    const result = useModelCredits("flux", 10)

    expect(result).toBe(10)
  })

  it("re-exports getCachedCredits, prefetchModelCredits, useModelCreditCost", () => {
    expect(getCachedCredits).toBeDefined()
    expect(prefetchModelCredits).toBeDefined()
    expect(useModelCreditCost).toBeDefined()
  })
})
