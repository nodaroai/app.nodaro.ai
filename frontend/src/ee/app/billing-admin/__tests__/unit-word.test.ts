import { afterEach, describe, expect, it } from "vitest"
import { useLocaleStore } from "@/lib/locale-store"
import { unitWord } from "../units"

/** The billing account's page names the deployment's unit in the viewer's language, like every other screen. */
afterEach(() => {
  delete window.__NODARO_RUNTIME__
  useLocaleStore.setState({ locale: "en" })
})

const unit = { label: "נקודות", rate: 10, decimals: 0 }

describe("unitWord", () => {
  it("the deployment's label as sent, with no per-language words", () => {
    expect(unitWord(unit)).toBe("נקודות")
  })

  it("a deployment whose label is the word credits keeps it (not the site's short label)", () => {
    expect(unitWord({ label: "credits", rate: 10, decimals: 0 })).toBe("credits")
  })

  it("the viewer's word where the deployment gives one", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true, unitLabel: "נקודות", unitRate: 10, unitLabels: { en: "points" } } } } as unknown as typeof window.__NODARO_RUNTIME__
    expect(unitWord(unit)).toBe("points")
    useLocaleStore.setState({ locale: "he" })
    expect(unitWord(unit)).toBe("נקודות")
  })

  it("no unit: nothing", () => {
    expect(unitWord(null)).toBe("")
  })
})
