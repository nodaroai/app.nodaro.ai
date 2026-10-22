/**
 * The review's Render final and Update preview, and the Clip Pack's footer,
 * mark a price whose UGC part is not the server's checked figure as an
 * estimate, with the reason on the button — as the render node's bar does.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasCredits: () => true }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => String(n) }))

import { translate } from "@/lib/i18n"
import type { ReviewRuns } from "@/hooks/use-review-runs"
import { ReviewRunButtons } from "../review-run-buttons"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)

const runs = (over: Partial<ReviewRuns> = {}): ReviewRuns => ({
  gate: { mode: "ready", hold: null } as never,
  finalCredits: 530,
  previewCredits: 144,
  canUpdatePreview: true,
  canRenderFinal: true,
  running: null,
  progress: null,
  checkPending: false,
  checking: null,
  renderFinal: vi.fn(),
  updatePreview: vi.fn(),
  ...over,
})

afterEach(() => cleanup())

describe("the review's run buttons", () => {
  it("a checked price: the credits, and no title", () => {
    render(<ReviewRunButtons runs={runs()} />)
    expect(screen.getByText(/Render final · 530/).closest("button")!.title).toBe("")
  })
  it("a price whose UGC part is not checked: marked as an estimate, the reason on the button", () => {
    render(<ReviewRunButtons runs={runs({ finalUnchecked: "held", previewUnchecked: "checking" })} />)
    const final = screen.getByText(`${t("renderFinal.action")} · ~530`).closest("button")!
    expect(final.title).toBe(t("ugc.price.uncheckedHeld"))
    const preview = screen.getByText(`${t("renderFinal.updatePreview")} · ~144`).closest("button")!
    expect(preview.title).toBe(t("ugc.price.checking"))
  })
})

describe("Render final where it cannot go ahead (a use-case node's Final on show)", () => {
  it("is not offered", () => {
    render(<ReviewRunButtons runs={runs({ canRenderFinal: false })} />)
    expect(screen.queryByText(new RegExp(t("renderFinal.action")))).toBeNull()
    expect(screen.getByText(new RegExp(t("renderFinal.updatePreview")))).toBeInTheDocument()
  })
})
