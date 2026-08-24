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
