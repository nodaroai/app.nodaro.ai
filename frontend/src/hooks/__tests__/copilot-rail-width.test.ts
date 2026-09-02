import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const hidden = vi.fn(() => false)
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfaceFeatureHidden: (key: string) => (key === "copilot" ? hidden() : false),
}))
vi.mock("@/lib/edition", async () => {
  const actual = await vi.importActual<typeof import("@/lib/edition")>("@/lib/edition")
  return { ...actual, hasCredits: () => true }
})

const { useCopilotRailWidth, COPILOT_TAB_WIDTH, useCopilotUiStore } = await import("@/hooks/use-copilot-ui-store")

beforeEach(() => {
  hidden.mockReturnValue(false)
  useCopilotUiStore.setState({ open: false, everOpened: false, turnActive: false })
})

// The rail's width is the one number every inline-start offset reads (the
// floating tool bar, and through it the Add Node panel). It must describe what
// is actually rendered: a deployment that hides the Copilot feature renders no
// rail at all, so the offset must be 0 — not the collapsed tab's 40px.
describe("useCopilotRailWidth", () => {
  it("is the collapsed tab width when the copilot is surfaced", () => {
    expect(renderHook(() => useCopilotRailWidth()).result.current).toBe(COPILOT_TAB_WIDTH)
  })
  it("is 0 when the deployment hides the copilot feature", () => {
    hidden.mockReturnValue(true)
    expect(renderHook(() => useCopilotRailWidth()).result.current).toBe(0)
  })
})
