import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { resolveInitialLocale } from "../locale-store"

const KEY = "nodaro:preferred-locale"

beforeEach(() => {
  window.localStorage.clear()
  delete window.__NODARO_RUNTIME__
})
afterEach(() => {
  window.localStorage.clear()
  delete window.__NODARO_RUNTIME__
})

describe("resolveInitialLocale — deployment default locale (A3)", () => {
  it("uses DEFAULT_LOCALE above browser detection when nothing is stored", () => {
    window.__NODARO_RUNTIME__ = { defaultLocale: "he" }
    expect(resolveInitialLocale()).toBe("he")
  })

  it("normalises a region-coded DEFAULT_LOCALE the same way browser detection does", () => {
    // "de-DE" is not a shipped id, but its language prefix "de" is — the operator
    // knob must be as lenient as the auto-detection it overrides.
    window.__NODARO_RUNTIME__ = { defaultLocale: "de-DE" }
    expect(resolveInitialLocale()).toBe("de")
  })

  it("a stored choice (localStorage) beats DEFAULT_LOCALE — never drag back a deliberate choice", () => {
    window.localStorage.setItem(KEY, "de")
    window.__NODARO_RUNTIME__ = { defaultLocale: "he" }
    expect(resolveInitialLocale()).toBe("de")
  })

  it("an unsupported DEFAULT_LOCALE is ignored (degrades to detection)", () => {
    const detected = resolveInitialLocale() // no runtime config → pure detection
    window.__NODARO_RUNTIME__ = { defaultLocale: "zz-not-real" }
    expect(resolveInitialLocale()).toBe(detected)
  })

  it("a blank DEFAULT_LOCALE is ignored (degrades to detection)", () => {
    const detected = resolveInitialLocale()
    window.__NODARO_RUNTIME__ = { defaultLocale: "  " }
    expect(resolveInitialLocale()).toBe(detected)
  })
})

/**
 * Browser detection may land only on an OFFERED locale (chrome translation
 * complete — `lib/i18n/offered-locales.ts`). A German browser must not drop a
 * first-time visitor into a language the menu does not list.
 */
describe("resolveInitialLocale — browser detection lands only on offered locales", () => {
  function withBrowserLanguages(tags: readonly string[], run: () => void) {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "languages")
    Object.defineProperty(window.navigator, "languages", { value: tags, configurable: true })
    try {
      run()
    } finally {
      if (original) Object.defineProperty(window.navigator, "languages", original)
      else delete (window.navigator as { languages?: unknown }).languages
    }
  }

  it("a German browser lands on English while the German chrome dictionary is a stub", () => {
    withBrowserLanguages(["de-DE", "de"], () => {
      expect(resolveInitialLocale()).toBe("en")
    })
  })

  it("a Hebrew browser lands on Hebrew (offered), region code stripped", () => {
    withBrowserLanguages(["he-IL"], () => {
      expect(resolveInitialLocale()).toBe("he")
    })
  })

  it("skips not-offered preferences and takes the first offered one", () => {
    withBrowserLanguages(["fr-FR", "he", "en"], () => {
      expect(resolveInitialLocale()).toBe("he")
    })
  })

  it("a stored not-offered choice is still honoured — the gate never overrides a deliberate pick", () => {
    window.localStorage.setItem(KEY, "de")
    withBrowserLanguages(["en-US"], () => {
      expect(resolveInitialLocale()).toBe("de")
    })
  })
})
