import { describe, it, expect, afterEach } from "vitest"
import { resolveInitialLocale } from "../locale-store"

/**
 * B1 folds A3's default locale into surface.locale.default without retiring the
 * shipped top-level defaultLocale. surface.locale.default wins when both are set.
 */
describe("resolveInitialLocale — surface.locale.default fold", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
    try {
      window.localStorage.clear()
    } catch {
      /* jsdom without a localStorage file */
    }
  })

  it("uses surface.locale.default when present", () => {
    window.__NODARO_RUNTIME__ = { surface: { locale: { default: "he", picker: true } } }
    expect(resolveInitialLocale()).toBe("he")
  })

  it("falls back to the A3 top-level defaultLocale", () => {
    window.__NODARO_RUNTIME__ = { defaultLocale: "de" }
    expect(resolveInitialLocale()).toBe("de")
  })
})
