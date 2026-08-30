import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

/**
 * SAI-8 / A3 — the ONE rule for a dollar figure: an admin, and an explicit
 * toggle they turned on. The old seed `useState(surface.displayUnit !==
 * "credits")` put every user of a non-"credits" authority on the raw-USD view
 * with no control to leave it (only the toggle BUTTON was admin-gated).
 * Parameterised over units so no future `displayUnit` string re-opens it.
 */

const auth = vi.hoisted(() => ({ isAdmin: false }))
const surface = vi.hoisted(() => ({ displayUnit: "credits" }))

vi.mock("@/hooks/use-billing-surface", () => ({
  useBillingSurface: () => ({
    surface: { providerId: "stub", displayUnit: surface.displayUnit, mountCostTab: true, canReport: true, canAccount: true, canQuote: false, contract: 2 },
    isLoading: false,
  }),
}))
vi.mock("@/hooks/queries/use-editor-queries", () => ({
  useWorkflowCostSummary: () => ({
    data: {
      total_credits: 36,
      total_cost_usd: 1.2639, // an admin-only figure the client must never show unasked
      unit: surface.displayUnit,
      total_jobs: 3,
      unavailable: 0,
      breakdown: [
        { node_type: "generate-image", model: "flux", runs: 3, successful: 3, failed: 0, total_credits: 36, total_cost_usd: 1.2639, avg_credits_per_run: 12, unavailable: 0 },
      ],
    },
    isLoading: false, error: null, refetch: () => {},
  }),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: { nodes: unknown[] }) => unknown) => sel({ nodes: [] }),
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }))
vi.mock("@/lib/i18n", () => ({ useT: () => (k: string) => k }))

import { CostTab } from "../cost-tab"

afterEach(() => {
  cleanup()
  auth.isAdmin = false
  surface.displayUnit = "credits"
})

const UNITS = ["credits", "usd", "sai-units", "יחידות", ""]

describe("CostTab — no dollar figure without admin + explicit toggle", () => {
  for (const unit of UNITS) {
    it(`non-admin, displayUnit=${JSON.stringify(unit)}: no "$" anywhere, USD digits absent, credits shown`, () => {
      surface.displayUnit = unit
      const { container } = render(<CostTab />)
      expect(container.textContent).not.toContain("$")
      expect(container.textContent).not.toContain("1.2639")
      expect(container.textContent).not.toContain("1.264")
      // The figure renders under the unit the summary arrived with (H13): the
      // provider id "credits" (and an unstated unit) map to the short label.
      const label = unit === "credits" || unit === "" ? "CR" : unit
      expect(screen.getAllByText(new RegExp(`36 ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).length).toBeGreaterThan(0)
    })
  }

  it("admin with the toggle un-clicked: still credits, still no dollar figure (default is off)", () => {
    auth.isAdmin = true
    surface.displayUnit = "usd"
    const { container } = render(<CostTab />)
    expect(screen.getAllByText(/36 usd/).length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain("1.26")
    // The toggle exists for the admin (it shows the current "CR" state), but
    // the only "$" on screen may be that toggle's own glyph — never a figure.
    expect(container.textContent).not.toMatch(/\$\d/)
  })
})
