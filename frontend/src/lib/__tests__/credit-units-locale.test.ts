import { afterEach, describe, expect, it } from "vitest"
import { creditUnitLabel, displayUnitLabel, serverUnitLabel } from "../credit-units"
import { useLocaleStore } from "../locale-store"

/**
 * A deployment's unit word, per interface language (`billing.unitLabels`):
 * the viewer's own word wherever the deployment gave one, the single label
 * otherwise, and Nodaro's literals untouched.
 */

type SurfaceBilling = Record<string, unknown>
function billing(b: SurfaceBilling) {
  window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: true, ...b } } } as unknown as typeof window.__NODARO_RUNTIME__
}

afterEach(() => {
  delete window.__NODARO_RUNTIME__
  useLocaleStore.setState({ locale: "en" })
})

const WORDS = { en: "points", he: "נקודות" }

describe("creditUnitLabel — a client-computed figure's label", () => {
  it("unconfigured: the site's own default, byte for byte", () => {
    expect(creditUnitLabel()).toBe("CR")
    expect(creditUnitLabel("קר׳")).toBe("קר׳")
  })

  it("a single label: that label in every language, exactly as before", () => {
    billing({ unitLabel: "נקודות", unitRate: 2 })
    expect(creditUnitLabel("CR")).toBe("נקודות")
    useLocaleStore.setState({ locale: "he" })
    expect(creditUnitLabel("CR")).toBe("נקודות")
  })

  it("a per-language map: the viewer's word, and the single label where the deployment gave none", () => {
    billing({ unitLabel: "נקודות", unitRate: 2, unitLabels: WORDS })
    expect(creditUnitLabel()).toBe("points")
    useLocaleStore.setState({ locale: "he" })
    expect(creditUnitLabel()).toBe("נקודות")
    useLocaleStore.setState({ locale: "ja" })
    expect(creditUnitLabel()).toBe("נקודות")
  })
})

describe("serverUnitLabel — a figure the billing seam converted", () => {
  it("the provider's own unit id maps to the site's short label, unchanged", () => {
    expect(serverUnitLabel("credits", "CR")).toBe("CR")
    expect(serverUnitLabel(undefined, "קר׳")).toBe("קר׳")
    billing({ unitLabel: "נקודות", unitRate: 2, unitLabels: WORDS })
    expect(serverUnitLabel("credits", "CR")).toBe("CR")
  })

  it("the deployment's label reads in the viewer's language; any other unit name is as the server said", () => {
    billing({ unitLabel: "נקודות", unitRate: 2, unitLabels: WORDS })
    expect(serverUnitLabel("נקודות")).toBe("points")
    expect(serverUnitLabel("usd")).toBe("usd")
    useLocaleStore.setState({ locale: "he" })
    expect(serverUnitLabel("נקודות")).toBe("נקודות")
  })

  it("no map: the unit as the server sent it", () => {
    billing({ unitLabel: "נקודות", unitRate: 2 })
    expect(serverUnitLabel("נקודות")).toBe("נקודות")
  })
})

describe("displayUnitLabel — a `display` object's unit", () => {
  it("the word the server sent for the viewer's language, else the single unit", () => {
    expect(displayUnitLabel({ unit: "נקודות", unitLabels: WORDS })).toBe("points")
    useLocaleStore.setState({ locale: "he" })
    expect(displayUnitLabel({ unit: "נקודות", unitLabels: WORDS })).toBe("נקודות")
    useLocaleStore.setState({ locale: "ko" })
    expect(displayUnitLabel({ unit: "נקודות", unitLabels: WORDS })).toBe("נקודות")
    expect(displayUnitLabel({ unit: "points" })).toBe("points")
  })

  it("a `display` whose unit is the provider's id falls to the site's own word", () => {
    expect(displayUnitLabel({ unit: "credits" }, "credits-word")).toBe("credits-word")
  })
})
