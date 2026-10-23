import { describe, it, expect, beforeEach } from "vitest"
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  isDefault,
  loadPreferences,
  parsePreferences,
  savePreferences,
  STORAGE_KEY,
  TOGGLE_KEYS,
} from "../accessibility-preferences"

describe("accessibility preferences", () => {
  beforeEach(() => {
    window.localStorage.clear()
    for (const name of [...document.documentElement.getAttributeNames()]) {
      if (name.startsWith("data-a11y-")) document.documentElement.removeAttribute(name)
    }
  })

  it("keeps only well-formed stored values", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences("not json")).toEqual(DEFAULT_PREFERENCES)
    expect(parsePreferences(JSON.stringify({ textScale: 7, contrast: "yes", links: true }))).toEqual({
      ...DEFAULT_PREFERENCES,
      links: true,
    })
  })

  it("round-trips through this browser's storage", () => {
    const prefs = { ...DEFAULT_PREFERENCES, textScale: 2 as const, headings: true }
    savePreferences(prefs)
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()
    expect(loadPreferences()).toEqual(prefs)
  })

  it("puts every choice on <html> and takes it off again", () => {
    const root = document.documentElement
    const all = { ...DEFAULT_PREFERENCES, textScale: 1 as const }
    const everything = Object.fromEntries(TOGGLE_KEYS.map((k) => [k, true]))
    applyPreferences({ ...all, ...everything }, root)
    expect(root.getAttribute("data-a11y-text")).toBe("1")
    for (const attr of ["contrast", "spacing", "links", "headings", "font", "cursor", "motion"]) {
      expect(root.hasAttribute(`data-a11y-${attr}`)).toBe(true)
    }
    applyPreferences(DEFAULT_PREFERENCES, root)
    expect(root.getAttributeNames().filter((n) => n.startsWith("data-a11y-"))).toEqual([])
  })

  it("knows the defaults", () => {
    expect(isDefault(DEFAULT_PREFERENCES)).toBe(true)
    expect(isDefault({ ...DEFAULT_PREFERENCES, bigCursor: true })).toBe(false)
  })
})
