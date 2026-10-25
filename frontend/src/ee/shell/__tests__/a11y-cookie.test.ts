import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { SharedAccessibilityState } from "virtual:site-a11y"
import {
  ACCESSIBILITY_COOKIE,
  accessibilityCookie,
  cookieDomainFor,
  encodeAccessibilityCookie,
  writeAccessibilityCookie,
} from "../a11y-cookie"

/**
 * The app's copy of the header package's accessibility-cookie writer. The
 * first block pins the format; the second holds it to the package's own
 * reader, and runs wherever the pinned package is installed — the
 * shared-header contract job installs it and sets
 * SHARED_HEADER_TESTS_REQUIRE_PACKAGE=1, under which a missing package fails
 * instead of skipping. Public CI has no package, so there it skips.
 */

const NONE = {
  textScale: 0,
  contrast: false,
  spacing: false,
  links: false,
  headings: false,
  readableFont: false,
  bigCursor: false,
  stopMotion: false,
} as const

const SOME: SharedAccessibilityState = {
  prefs: { ...NONE, textScale: 2, contrast: true, headings: true, stopMotion: true },
  hiddenUntil: null,
}

function clearCookie(): void {
  document.cookie = `${ACCESSIBILITY_COOKIE}=; Path=/; Max-Age=0`
}

describe("the shared accessibility cookie (the app's writer)", () => {
  afterEach(clearCookie)

  it("writes the package's compact value", () => {
    expect(encodeAccessibilityCookie({ prefs: NONE, hiddenUntil: null })).toBe("1.0.-.0")
    expect(encodeAccessibilityCookie(SOME)).toBe("1.2.chm.0")
    const all = { textScale: 1, contrast: true, spacing: true, links: true, headings: true, readableFont: true, bigCursor: true, stopMotion: true } as const
    expect(encodeAccessibilityCookie({ prefs: all, hiddenUntil: 1_900_000_000_000 })).toBe("1.1.cslhfum.1900000000000")
  })

  it("shares it on .nodaro.ai and keeps it host-only elsewhere", () => {
    expect(cookieDomainFor("nodaro.ai")).toBe(".nodaro.ai")
    expect(cookieDomainFor("app.nodaro.ai")).toBe(".nodaro.ai")
    expect(cookieDomainFor("next.nodaro.ai")).toBe(".nodaro.ai")
    expect(cookieDomainFor("localhost")).toBeUndefined()
    expect(cookieDomainFor("evilnodaro.ai")).toBeUndefined()
    expect(cookieDomainFor("nodaro.ai.example.com")).toBeUndefined()
  })

  it("carries the package's attributes", () => {
    expect(accessibilityCookie(SOME, { hostname: "app.nodaro.ai", protocol: "https:" })).toBe(
      "nodaro_a11y=1.2.chm.0; Path=/; Max-Age=31536000; SameSite=Lax; Secure; Domain=.nodaro.ai",
    )
    expect(accessibilityCookie(SOME, { hostname: "localhost", protocol: "http:" })).toBe(
      "nodaro_a11y=1.2.chm.0; Path=/; Max-Age=31536000; SameSite=Lax",
    )
  })

  it("writes it to the page", () => {
    writeAccessibilityCookie(SOME)
    expect(document.cookie).toContain("nodaro_a11y=1.2.chm.0")
  })
})

// Built from fragments: the package name lives only under ee/shell/ anyway,
// and a computed specifier keeps Vite from resolving it where it is absent.
const PACKAGE_A11Y = ["@nodaroai", "shell", "a11y"].join("/")
const REQUIRE_PACKAGE = process.env.SHARED_HEADER_TESTS_REQUIRE_PACKAGE === "1"

interface PackageA11y {
  readonly readAccessibility: (now?: number) => SharedAccessibilityState
}

async function loadPackage(): Promise<PackageA11y | null> {
  try {
    return (await import(/* @vite-ignore */ PACKAGE_A11Y)) as PackageA11y
  } catch (error) {
    if (REQUIRE_PACKAGE) throw error
    return null
  }
}

const pkg = await loadPackage()

describe.skipIf(!pkg)("the app's writer, read back by the pinned package", () => {
  beforeEach(() => {
    clearCookie()
    window.localStorage.clear()
  })
  afterEach(() => {
    clearCookie()
    window.localStorage.clear()
  })

  it("reads back every choice the app writes", () => {
    const later = Date.now() + 30 * 24 * 60 * 60 * 1000
    for (const state of [
      { prefs: NONE, hiddenUntil: null },
      SOME,
      { prefs: { ...NONE, textScale: 1 as const, spacing: true, links: true, readableFont: true, bigCursor: true }, hiddenUntil: later },
    ]) {
      writeAccessibilityCookie(state)
      expect(pkg!.readAccessibility()).toEqual(state)
    }
  })

  it("carries the app's earlier per-browser choices into the cookie once", () => {
    window.localStorage.setItem("nodaro.a11y.v1", JSON.stringify(SOME.prefs))
    expect(pkg!.readAccessibility()).toEqual(SOME)
    expect(document.cookie).toContain("nodaro_a11y=1.2.chm.0")
    // From then on the cookie is the source: a later reset is never undone.
    writeAccessibilityCookie({ prefs: NONE, hiddenUntil: null })
    expect(pkg!.readAccessibility().prefs).toEqual(NONE)
  })
})
