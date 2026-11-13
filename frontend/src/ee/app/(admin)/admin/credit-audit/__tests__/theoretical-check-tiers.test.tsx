/**
 * The credit audit's pricing-table mode: a key priced only through composite
 * rows (its per-length / per-resolution rows) comes back CHECK_TIERS — covered
 * by some row, not known to be charged at one. The page shows that status
 * under its own label, never as OK, with the cheapest row that covers each
 * billed amount in the "We Charge" column, and counts it among the mismatches.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/api", () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))

import AdminCreditAudit from "../page"

const RESULT = {
  mode: "theoretical",
  lookbackMinutes: 10080,
  markupPercent: 0,
  totalRecords: 5,
  successRecords: 5,
  uniqueModels: 2,
  mismatches: 1,
  timestamp: "2026-11-13T10:00:00.000Z",
  models: [
    {
      kieModel: "grok-imagine/extend", ourKey: "grok-extend", category: "special", tasks: 3,
      providerCredits: 27, providerMin: 27, providerMax: 27, ourCredits: null,
      providerCostInCredits: 67.5, expectedCredits: 68, diff: null, diffPercent: null,
      status: "CHECK_TIERS", variable: false,
      tierBreakdown: [{ kieCost: 27, tasks: 3, required: 68, bestTier: 70, covered: true }],
    },
    {
      kieModel: "flux-2/pro", ourKey: "flux-2-pro", category: "image", tasks: 2,
      providerCredits: 10, providerMin: 10, providerMax: 10, ourCredits: 30,
      providerCostInCredits: 25, expectedCredits: 25, diff: 5, diffPercent: 20,
      status: "OK", variable: false,
    },
  ],
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("nodaro-credit-audit-result", JSON.stringify(RESULT))
})

describe("credit audit (pricing table) — a key priced only through composite rows", () => {
  it("shows CHECK_TIERS under its own label with the cheapest covering row, never as OK", () => {
    render(<AdminCreditAudit />)
    const grok = screen.getByRole("row", { name: /grok-imagine\/extend/ })
    expect(within(grok).getByText("Check tiers")).toBeTruthy()
    expect(within(grok).queryByText("OK")).toBeNull()
    const covering = within(grok).getByText("70")
    expect(covering.getAttribute("title")).toMatch(/cheapest row that covers/i)
  })

  it("counts it among the mismatches", async () => {
    render(<AdminCreditAudit />)
    await userEvent.click(screen.getByRole("button", { name: /Mismatches \(1\)/ }))
    expect(screen.getByRole("row", { name: /grok-imagine\/extend/ })).toBeTruthy()
    expect(screen.queryByRole("row", { name: /flux-2\/pro/ })).toBeNull()
  })
})
