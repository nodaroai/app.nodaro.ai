import { describe, it, expect } from "vitest"
import { translate, registeredChromeLocales } from ".."
import { en } from "../en"
import { he } from "../he"
import { LANGUAGES, type LocaleId } from "@nodaro/shared"

// @nodaro/shared's public entrypoint does not (yet) re-export the LOCALE_IDS
// array by name, only the LANGUAGES registry it is derived from — so we
// derive the equivalent list locally rather than reach into package
// internals. Same values, same order.
const LOCALE_IDS: readonly LocaleId[] = LANGUAGES.map((l) => l.id)

describe("i18n translate()", () => {
  it("returns the Hebrew string for a translated key", () => {
    expect(translate("he", "nav.integrations")).toBe("אינטגרציות")
  })

  it("falls back to English when the locale's dict has no match for a key", () => {
    // Every locale now has a registered dict (empty is fine for most); a
    // locale whose dict doesn't have this key still falls back to English.
    expect(translate("pt-BR", "nav.integrations")).toBe("Integrations")
  })

  it("falls back to English when a key is missing in the locale", () => {
    // en is the canonical key set; pick any key not present in `he` if one is
    // ever added — here we assert the fallback path via a locale with no
    // translation for this key.
    expect(translate("zh-CN", "auth.signIn")).toBe(en["auth.signIn"])
  })

  it("returns the raw key when it exists nowhere (never throws)", () => {
    // @ts-expect-error — intentionally an unknown key
    expect(translate("he", "does.not.exist")).toBe("does.not.exist")
  })

  it("interpolates {vars}", () => {
    // Uses a key with no placeholder — interpolation is a no-op but must not crash.
    expect(translate("en", "common.close", { x: 1 })).toBe("Close")
  })

  it("substitutes a real {placeholder} with the given value", () => {
    expect(translate("en", "dash.openApp", { name: "X" })).toBe("Open X")
  })

  it("leaves a {placeholder} with no matching var untouched", () => {
    expect(translate("en", "dash.openApp", { other: "X" })).toBe("Open {name}")
  })

  it("every he key is a valid en key (no orphans)", () => {
    const enKeys = new Set(Object.keys(en))
    for (const k of Object.keys(he)) expect(enKeys.has(k)).toBe(true)
  })

  it("every shipped locale has a registered chrome dict (empty is fine)", () => {
    const registered = new Set(registeredChromeLocales())
    expect(registered).toEqual(new Set(LOCALE_IDS))
  })

  it("resolves the generic usage keys in English", () => {
    expect(translate("en", "usage.dailyBlocked")).toBe("Not included")
    expect(translate("en", "usage.breakdown")).toBe("Breakdown")
  })
})

describe("node.moderation.* keys (G3)", () => {
  const KEYS = [
    "node.moderation.checking",
    "node.moderation.blockedTitle",
    "node.moderation.blockedReason",
    "node.moderation.ready",
    "node.moderation.remove",
  ] as const

  it("all five keys exist in the canonical English dict", () => {
    for (const k of KEYS) expect(typeof en[k as keyof typeof en]).toBe("string")
  })

  it("all five keys are translated in Hebrew", () => {
    for (const k of KEYS) expect(typeof he[k as keyof typeof he]).toBe("string")
  })
})
