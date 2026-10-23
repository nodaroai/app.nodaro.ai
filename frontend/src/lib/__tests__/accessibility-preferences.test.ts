import { describe, it, expect, beforeEach } from "vitest"
import {
  applyPreferences,
  DEFAULT_PREFERENCES,
  HIDE_KEY,
  hiddenUntilAfter,
  isDefault,
  loadHiddenUntil,
  saveHiddenUntil,
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

  it("hides the button for calendar months and forgets an expired choice", () => {
    const now = new Date("2026-10-23T12:00:00Z")
    expect(new Date(hiddenUntilAfter(1, now)).getUTCMonth()).toBe(10)
    expect(new Date(hiddenUntilAfter(6, now)).getUTCFullYear()).toBe(2027)
    const until = hiddenUntilAfter(3, now)
    saveHiddenUntil(until)
    expect(loadHiddenUntil(now.getTime())).toBe(until)
    expect(loadHiddenUntil(until + 1)).toBeNull()
    expect(window.localStorage.getItem(HIDE_KEY)).toBeNull()
  })

  it("knows the defaults", () => {
    expect(isDefault(DEFAULT_PREFERENCES)).toBe(true)
    expect(isDefault({ ...DEFAULT_PREFERENCES, bigCursor: true })).toBe(false)
  })
})
