// The bar's buttons (A6.1, decided 2026-10-06): Render final always; Update
// preview only with the stop-rule flag on. Each quotes the run's own price.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const controls = {
  renderFinal: vi.fn(),
  updatePreview: vi.fn(),
  finalCredits: 530,
  previewCredits: 144,
  canUpdatePreview: true,
  checking: null as "final" | "proxy" | null,
  checkPending: false,
}
vi.mock("@/hooks/use-render-final", () => ({ useRenderFinal: () => controls }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => String(n) }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { RenderReviewBar, RenderReviewBarView } from "../render-review-bar"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { translate } from "@/lib/i18n"

beforeEach(() => {
  controls.renderFinal.mockClear()
  controls.updatePreview.mockClear()
  controls.canUpdatePreview = true
  controls.checking = null
  controls.checkPending = false
})
afterEach(() => cleanup())

describe("RenderReviewBar", () => {
  it("offers Render final and Update preview, each with its price", () => {
    render(<RenderReviewBar renderId="r" busy={false} />)
    fireEvent.click(screen.getByText(/Render final · 530/))
    fireEvent.click(screen.getByText(/Update preview · 144/))
    expect(controls.renderFinal).toHaveBeenCalledTimes(1)
    expect(controls.updatePreview).toHaveBeenCalledTimes(1)
  })

  it("with the flag off Update preview is hidden and Render final stays", () => {
    controls.canUpdatePreview = false
    render(<RenderReviewBar renderId="r" busy={false} />)
    expect(screen.queryByText(/Update preview/)).toBeNull()
    expect(screen.getByText(/Render final/)).toBeTruthy()
  })

  it("waits while the render is queued, and says why", () => {
    render(<RenderReviewBar renderId="r" busy />)
    const button = screen.getByText(/Render final/).closest("button")!
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/run is in progress/)
  })

  // Decided 2026-10-07: while the click's newer-run check is out (15 s at most),
  // both buttons are disabled; only the clicked one is busy (spinner, aria-busy).
  it.each([
    ["final", /Render final/, /Update preview/],
    ["proxy", /Update preview/, /Render final/],
  ] as const)("while %s's newer-run check is out, both buttons wait and only that one is busy", (kind, clicked, other) => {
    controls.checking = kind
    controls.checkPending = true
    render(<RenderReviewBar renderId="r" busy={false} />)
    const on = screen.getByText(clicked).closest("button")!
    const off = screen.getByText(other).closest("button")!
    expect(on.getAttribute("aria-busy")).toBe("true")
    expect(on.disabled).toBe(true)
    expect(on.querySelector("[data-testid=check-spinner]")).not.toBeNull()
    expect(off.getAttribute("aria-busy")).toBeNull()
    expect(off.disabled).toBe(true)
    expect(off.querySelector("[data-testid=check-spinner]")).toBeNull()
  })

  // The editor holds one run click at a time, so while another render's check
  // is out a click here would be swallowed: both wait, neither spins.
  it("while another render's newer-run check is out, both buttons wait and neither is busy", () => {
    controls.checkPending = true
    render(<RenderReviewBar renderId="r" busy={false} />)
    for (const name of [/Render final/, /Update preview/]) {
      const b = screen.getByText(name).closest("button")!
      expect(b.disabled).toBe(true)
      expect(b.getAttribute("aria-busy")).toBeNull()
      expect(b.querySelector("[data-testid=check-spinner]")).toBeNull()
    }
  })

  // C3.4: a render that cannot run at all (Speaker View until it is priced)
  // shows both buttons disabled, with no price, and says why under them.
  it("a render that cannot run: both disabled, no price, and the reason shown and described", () => {
    render(<RenderReviewBarView onRenderFinal={vi.fn()} onUpdatePreview={vi.fn()} finalCredits={530} previewCredits={144} busy={false} disabledReason="Not priced yet" />)
    const reason = screen.getByTestId("render-review-refusal")
    expect(reason.textContent).toBe("Not priced yet")
    for (const name of [/^Render final$/, /^Update preview$/]) {
      const b = screen.getByText(name).closest("button")!
      expect(b.disabled).toBe(true)
      expect(b.title).toBe("Not priced yet")
      expect(b.getAttribute("aria-describedby")).toBe(reason.id)
    }
  })

  it("the editor's bar on an unpriced Speaker View says it is not priced yet", () => {
    useWorkflowStore.setState({ nodes: [{ id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: {} }] as never })
    render(<RenderReviewBar renderId="sv" busy={false} />)
    expect(screen.getByTestId("render-review-refusal").textContent).toBe(translate("en", "speakerView.notPriced"))
    expect(screen.getByText(/^Render final$/).closest("button")!.disabled).toBe(true)
    cleanup()
    useWorkflowStore.setState({ nodes: [{ id: "r", type: "apply-edl", position: { x: 0, y: 0 }, data: {} }] as never })
    render(<RenderReviewBar renderId="r" busy={false} />)
    expect(screen.queryByTestId("render-review-refusal")).toBeNull()
  })
})
