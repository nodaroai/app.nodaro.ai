// UGC Clips' quote, on the card and in the panel alike: one table, read from saved
// data, hidden while the node runs again (its figures are the last run's).
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"

vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { UgcClipsQuote } from "../ugc-clips-quote"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const QUOTE = { lines: [{ label: "Clip 1 (12 s)", credits: 100 }], expected: 100, ceiling: 200 }

afterEach(() => {
  cleanup()
  act(() => { useLocaleStore.getState().setLocale("en") })
})

describe("UGC Clips' quote", () => {
  it("shows the last run's figures once it has run", () => {
    render(<UgcClipsQuote quote={QUOTE} status="completed" />)
    expect(screen.getByTestId("ugc-clips-quote").textContent).toContain(t("ugc.clips.expected"))
  })

  it("hides while the node runs again: the figures are the last run's", () => {
    render(<UgcClipsQuote quote={QUOTE} status="running" />)
    expect(screen.queryByTestId("ugc-clips-quote")).toBeNull()
  })

  it("a malformed quote is not shown", () => {
    const { container } = render(<UgcClipsQuote quote={{ lines: [] }} status="completed" />)
    expect(container.innerHTML).toBe("")
  })

  it("names each line in the person's language by its id; English keeps the route's own words", () => {
    const quote = { lines: [{ label: "Clip 1 (12 s)", key: "clip", n: 1, seconds: 12, credits: 100 }, { label: "Captions", key: "captions", credits: 5 }], expected: 105, ceiling: 205 }
    render(<UgcClipsQuote quote={quote} status="completed" />)
    expect(screen.getByText("Clip 1 (12 s)")).toBeTruthy()
    expect(screen.getByText("Captions")).toBeTruthy()
    cleanup()
    act(() => { useLocaleStore.getState().setLocale("he") })
    render(<UgcClipsQuote quote={quote} status="completed" />)
    expect(screen.getByText(translate("he", "ugc.clips.clipLength", { n: 1, seconds: "12" }))).toBeTruthy()
    expect(screen.getByText(translate("he", "ugc.quote.captions"))).toBeTruthy()
  })
})
