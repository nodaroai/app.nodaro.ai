import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import { NodaroMark } from "../nodaro-exclusive-mark"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

beforeEach(() => act(() => useLocaleStore.getState().setLocale("he")))
afterEach(() => {
  cleanup()
  act(() => useLocaleStore.getState().setLocale("en"))
})

// The brand pill sits on picker and sidebar rows; its tooltip was raw English.
describe("NodaroMark in Hebrew", () => {
  it("explains itself in the user's language", () => {
    render(<NodaroMark />)
    const pill = screen.getByText("NODARO")
    expect(pill.getAttribute("title")).toBe(translate("he", "node.runsOnNodaro"))
    expect(pill.getAttribute("title")).not.toBe("Runs on nodaro.ai")
  })
})
