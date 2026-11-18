/**
 * The cost-shortfall auto-pause switch: shows the saved state (an absent row reads
 * as on) and writes the key on toggle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const mutateAsync = vi.fn().mockResolvedValue({})
const settings: { cost_shortfall_auto_pause_enabled?: boolean } = {}

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  useAdminSettings: () => ({ data: settings, isLoading: false, error: null }),
}))
vi.mock("@/hooks/queries/use-app-settings-queries", () => ({
  useUpdateSettingMutation: () => ({ mutateAsync, isPending: false }),
}))

const { CostShortfallAutoPauseCard } = await import("../cost-shortfall-auto-pause-card")

const toggle = () => screen.getByLabelText("Switch off models that lose money")

beforeEach(() => {
  mutateAsync.mockClear()
  delete settings.cost_shortfall_auto_pause_enabled
})

describe("CostShortfallAutoPauseCard", () => {
  it("reads as on when nothing was saved", () => {
    render(<CostShortfallAutoPauseCard />)
    expect(toggle().getAttribute("aria-checked")).toBe("true")
  })

  it("shows a saved off", () => {
    settings.cost_shortfall_auto_pause_enabled = false
    render(<CostShortfallAutoPauseCard />)
    expect(toggle().getAttribute("aria-checked")).toBe("false")
  })

  it("saves cost_shortfall_auto_pause_enabled=false when turned off", async () => {
    render(<CostShortfallAutoPauseCard />)
    fireEvent.click(toggle())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ key: "cost_shortfall_auto_pause_enabled", value: false }),
    )
  })
})
