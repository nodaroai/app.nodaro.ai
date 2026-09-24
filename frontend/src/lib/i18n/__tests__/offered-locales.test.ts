import { describe, it, expect } from "vitest"
import { LANGUAGES } from "@nodaro/shared"
import {
  CHROME_COMPLETE_RATIO,
  chromeCoverage,
  isChromeComplete,
  isOfferedLocale,
  languageMenuRows,
  offeredLanguages,
} from "../offered-locales"
import { registeredChromeLocales } from ".."

/**
 * The language menus and browser detection offer only locales whose chrome
 * dictionary is (near-)complete. The gate is derived from the dictionaries,
 * so these tests pin the DERIVATION, not a hand-written list: finishing a
 * translation must put the language in the menu with no other edit, and a
 * stub dictionary must never leak into it.
 */
describe("offered locales — derived from chrome-dictionary coverage", () => {
  it("English and Hebrew are offered (both dictionaries are complete)", () => {
    expect(isOfferedLocale("en")).toBe(true)
    expect(isOfferedLocale("he")).toBe(true)
    expect(chromeCoverage("en")).toBe(1)
    expect(chromeCoverage("he")).toBeGreaterThanOrEqual(CHROME_COMPLETE_RATIO)
  })

  it("a stub dictionary is NOT offered — German sits at well under 1% coverage", () => {
    // If this fails because German got translated: good, delete this case.
    expect(chromeCoverage("de")).toBeLessThan(0.05)
    expect(isOfferedLocale("de")).toBe(false)
    expect(offeredLanguages().some((l) => l.id === "de")).toBe(false)
  })

  it("every registered locale is offered exactly when its coverage clears the ratio", () => {
    for (const id of registeredChromeLocales()) {
      expect(isOfferedLocale(id), id).toBe(chromeCoverage(id) >= CHROME_COMPLETE_RATIO)
      expect(isChromeComplete(id), id).toBe(isOfferedLocale(id))
    }
  })

  it("the ratio is strict enough that a stub can never pass and lenient enough for a few tracked gaps", () => {
    expect(CHROME_COMPLETE_RATIO).toBeGreaterThan(0.9)
    expect(CHROME_COMPLETE_RATIO).toBeLessThan(1)
  })

  it("keeps LANGUAGES display order", () => {
    const order = LANGUAGES.map((l) => l.id)
    const offered = offeredLanguages().map((l) => l.id)
    expect(offered).toEqual(order.filter((id) => offered.includes(id)))
  })

  it("an unknown id is not offered", () => {
    expect(isOfferedLocale("zz")).toBe(false)
    expect(isOfferedLocale(null)).toBe(false)
    expect(isOfferedLocale(undefined)).toBe(false)
  })
})

describe("languageMenuRows — the current locale stays visible even when not offered", () => {
  it("returns exactly the offered languages when the current one is offered", () => {
    expect(languageMenuRows("he")).toEqual(offeredLanguages())
    expect(languageMenuRows("en")).toEqual(offeredLanguages())
  })

  it("appends a not-offered current locale so a pre-gate saved choice can still be seen and switched away from", () => {
    const rows = languageMenuRows("de")
    expect(rows.slice(0, -1)).toEqual(offeredLanguages())
    expect(rows[rows.length - 1]?.id).toBe("de")
  })
})
