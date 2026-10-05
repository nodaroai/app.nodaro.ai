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
}
vi.mock("@/hooks/use-render-final", () => ({ useRenderFinal: () => controls }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => String(n) }))
vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { RenderReviewBar } from "../render-review-bar"

beforeEach(() => {
  controls.renderFinal.mockClear()
  controls.updatePreview.mockClear()
  controls.canUpdatePreview = true
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
})
