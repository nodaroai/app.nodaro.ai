import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react"

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { buildModelTree } from "@nodaro/shared"
import { ModelsTab } from "../models-tab"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"
import { PICKER_TAB_LABEL_KEY } from "@/lib/node-picker-i18n"

const setLocale = (l: "he" | "en") => act(() => useLocaleStore.getState().setLocale(l))
const first = () => buildModelTree()[0]

beforeEach(() => setLocale("he"))
afterEach(() => {
  cleanup()
  setLocale("en")
})

// The Models tab renders inside the same popup as the node list and had the
// same bug: every string it minted itself ("N models", "Models" back button,
// "creates X", the kind, "No models found") was raw English.
describe("Models tab in Hebrew", () => {
  it("counts a series' models in Hebrew", () => {
    render(<ModelsTab onSelectModel={vi.fn()} />)
    expect(screen.queryAllByText(/\d+ models$/)).toEqual([])
    const line = first()
    expect(
      screen.getByText(`${line.family} · ${translate("he", "addnode.modelCount", { count: line.models.length })}`),
    ).toBeTruthy()
  })

  it("drills into a series with a Hebrew back button, kind and 'creates' copy", () => {
    render(<ModelsTab onSelectModel={vi.fn()} />)
    const line = first()
    fireEvent.click(screen.getByText(line.series))
    expect(screen.getByRole("button", { name: translate("he", "addnode.tabModels") })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Models/ })).toBeNull()
    expect(screen.getByText(`${line.family} · ${translate("he", PICKER_TAB_LABEL_KEY[line.kind])}`)).toBeTruthy()
    expect(screen.queryByText(/^creates /)).toBeNull()
    const prefix = translate("he", "addnode.createsNode", { node: "" }).trim()
    expect(screen.getAllByText(new RegExp(`^${prefix} `)).length).toBeGreaterThan(0)
  })

  it("backs out of a series with the key that points backwards in the reading direction", () => {
    render(<ModelsTab onSelectModel={vi.fn()} />)
    const line = first()
    fireEvent.click(screen.getByText(line.series))
    // Hebrew: ← is "forward", so it must NOT back out…
    fireEvent.keyDown(document, { key: "ArrowLeft" })
    expect(screen.getByRole("button", { name: translate("he", "addnode.tabModels") })).toBeTruthy()
    // …and → does.
    fireEvent.keyDown(document, { key: "ArrowRight" })
    expect(screen.queryByRole("button", { name: translate("he", "addnode.tabModels") })).toBeNull()
    expect(screen.getByText(line.series)).toBeTruthy()
  })

  it("keeps ← as the back key in English", () => {
    setLocale("en")
    render(<ModelsTab onSelectModel={vi.fn()} />)
    const line = first()
    fireEvent.click(screen.getByText(line.series))
    fireEvent.keyDown(document, { key: "ArrowLeft" })
    expect(screen.queryByRole("button", { name: "Models" })).toBeNull()
    expect(screen.getByText(line.series)).toBeTruthy()
  })
})
