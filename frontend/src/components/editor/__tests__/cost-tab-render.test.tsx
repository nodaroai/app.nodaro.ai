import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/hooks/use-billing-surface", () => ({
  useBillingSurface: () => ({
    surface: { providerId: "nodaro-cloud", displayUnit: "credits", mountCostTab: true, canReport: true, canAccount: true, canQuote: false, contract: 2 },
    isLoading: false,
  }),
}))
vi.mock("@/hooks/queries/use-editor-queries", () => ({
  useWorkflowCostSummary: () => ({
    data: { total_credits: null, total_cost_usd: null, total_jobs: 2, unavailable: 2, breakdown: [] },
    isLoading: false, error: null, refetch: () => {},
  }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: { nodes: unknown[] }) => unknown) => sel({ nodes: [] }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: false }) }))
vi.mock("@/lib/i18n", () => ({ useT: () => (k: string) => k }))

import { CostTab } from "../cost-tab"

describe("CostTab null-not-zero rendering", () => {
  it("renders an unavailable affordance for a null total — never $0 / 0 CR", () => {
    render(<CostTab />)
    expect(screen.queryByText("$0")).toBeNull()
    expect(screen.queryByText("0 CR")).toBeNull()
    // The null total renders as an em dash, and the unavailable count is surfaced.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
