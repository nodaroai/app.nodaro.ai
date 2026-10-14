import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { translate } from "@/lib/i18n"
import { ReviewBanners } from "../review-banners"

/**
 * A Tighten Episode's review on an older take (decided 2026-10-13): an edit
 * that belongs to another take of the node says so, and Discard asks first; an
 * edit here that would replace it is asked about once.
 */
const t = (key: Parameters<typeof translate>[1]) => translate("en", key)
afterEach(() => cleanup())

function banners(over: { model?: Record<string, unknown>; edits?: Record<string, unknown> } = {}) {
  const edits = { discardStaleEdit: vi.fn(), replaceAsked: false, confirmReplace: vi.fn(), cancelReplace: vi.fn(), ...over.edits }
  const model = { base: {}, planProblems: [], reviewable: true, editStatus: "stale", staleEditOfOtherTake: true, locked: false, newerRun: null, transcript: {}, ...over.model }
  render(
    <ReviewBanners
      model={model as never}
      edits={edits as never}
      checks={{ staleTake: false } as never}
      runs={{ gate: { mode: "ready", hold: null }, canUpdatePreview: false } as never}
    />,
  )
  return edits
}

describe("the review on an older take", () => {
  it("says the edits belong to another take — not that they were made on an earlier plan", () => {
    banners()
    expect(screen.getByText(t("edlReview.staleEditOtherTake"))).toBeInTheDocument()
    expect(screen.queryByText(t("edlReview.staleEdit"))).toBeNull()
  })

  it("Discard asks first: Cancel keeps the edits, Discard drops them", () => {
    const edits = banners()
    fireEvent.click(screen.getByRole("button", { name: t("edlReview.discardEdits") }))
    expect(edits.discardStaleEdit).not.toHaveBeenCalled()
    expect(screen.getByText(t("edlReview.discardOtherTakeConfirm"))).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }))
    expect(edits.discardStaleEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: t("edlReview.discardEdits") }))
    fireEvent.click(screen.getByRole("button", { name: t("edlReview.discardConfirm") }))
    expect(edits.discardStaleEdit).toHaveBeenCalledTimes(1)
  })

  it("an edit on an earlier plan keeps its words and its one-click Discard", () => {
    const edits = banners({ model: { staleEditOfOtherTake: false } })
    expect(screen.getByText(t("edlReview.staleEdit"))).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: t("edlReview.discardEdits") }))
    expect(edits.discardStaleEdit).toHaveBeenCalledTimes(1)
  })

  it("an edit that would replace another take's asks: Replace them / Cancel", () => {
    const edits = banners({ edits: { replaceAsked: true } })
    expect(screen.getByText(t("edlReview.replaceOtherTakeEdit"))).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: t("edlReview.replaceConfirm") }))
    expect(edits.confirmReplace).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getAllByRole("button", { name: t("common.cancel") })[0]!)
    expect(edits.cancelReplace).toHaveBeenCalledTimes(1)
  })

  it("while edits are locked the ask shows no buttons: nothing can replace the other take's edit", () => {
    banners({ edits: { replaceAsked: true }, model: { locked: true } })
    expect(screen.getByText(t("edlReview.replaceOtherTakeEdit"))).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: t("edlReview.replaceConfirm") })).toBeNull()
  })
})
