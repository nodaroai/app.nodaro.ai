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

/** Config-panel keys whose Hebrew value is legitimately Latin (reviewed one by one). */
const LEGIT_LATIN_HE: readonly string[] = [
  "cfgshared.badgeI2I",
  "node.creditsSuffix",
  "cfgext.compBlendMultiply",
  "cfgext.compBlendScreen",
  "cfgext.compBlendOverlay",
  "cfgext.compXPercent",
  "cfgext.compYPercent",
  "cfgext.slideKenBurns",
  "cfgext.injRefImageN",
  "cfgext.sceneCriticScore",
  "vidcfg.pro1080p",
  "audiocfg.providerElevenLabsStt",
  "audiocfg.providerWhisper",
  "audiocfg.providerIncrediblyFastWhisper",
]

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

  it("every en key has a Hebrew translation (translate() falls back silently, so this is the only signal)", () => {
    // Pre-existing gaps, tracked: the SSO copy is not offered in Hebrew yet.
    const KNOWN_UNTRANSLATED = new Set(["auth.continueWithSso", "auth.ssoExchanging"])
    const missing = Object.keys(en).filter((k) => !(k in he) && !KNOWN_UNTRANSLATED.has(k))
    expect(missing, `en keys with no he value:\n${missing.join("\n")}`).toEqual([])
    for (const k of KNOWN_UNTRANSLATED) expect(k in he, `${k} is translated now — drop it from KNOWN_UNTRANSLATED`).toBe(false)
  })

  it("every config-panel Hebrew value is actually Hebrew (no copy-pasted English)", () => {
    // Values that are legitimately Latin: brand/model names, industry terms
    // kept in English (blend modes), format tokens.
    const LATIN_OK = new Set<string>(LEGIT_LATIN_HE)
    const NS = /^(proccfg|utilcfg|paramcfg|inputcfg|txtcfg|scriptcfg|cfgshared|cfgext|imgcfg|vidcfg|audiocfg|node)\./
    const HEBREW = /[\u0590-\u05FF]/
    const bad = Object.entries(he)
      .filter(([k, v]) => NS.test(k) && !LATIN_OK.has(k) && !HEBREW.test(v as string))
      .map(([k, v]) => `${k} = ${v}`)
    expect(bad, `he values with no Hebrew letter:\n${bad.join("\n")}`).toEqual([])
    for (const k of LATIN_OK) expect(k in he && !HEBREW.test(he[k as keyof typeof he] as string), `${k} is Hebrew now — drop it from the Latin allowlist`).toBe(true)
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
