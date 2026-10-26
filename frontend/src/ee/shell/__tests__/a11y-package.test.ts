import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SharedAccessibilityState } from "virtual:site-a11y"

/**
 * The app's own accessibility menu on a shared-header build, wired to the
 * pinned package exactly as the resolver's adapter wires it
 * (`header-module-plugin.ts`): the package's reader, its cookie writer and its
 * boot call. The app keeps no copy of the cookie format, so what is checked
 * here is that a save from the app's menu goes through the package and keeps
 * what the app does not own: the header's button place, and the letters and
 * fields a newer product wrote.
 *
 * Runs wherever the pinned package is installed — the shared-header contract
 * job installs it and sets SHARED_HEADER_TESTS_REQUIRE_PACKAGE=1, under which
 * a missing package fails instead of skipping. Public CI has no package, so
 * there it skips.
 */

const env = vi.hoisted(() => ({
  // Built from fragments: a computed specifier keeps Vite from resolving it where it is absent.
  specifier: ["@nodaroai", "shell", "a11y"].join("/"),
  require: process.env.SHARED_HEADER_TESTS_REQUIRE_PACKAGE === "1",
}))

interface PackageA11y {
  readonly readAccessibility: (now?: number) => SharedAccessibilityState
  readonly saveAccessibility: (state: SharedAccessibilityState) => void
  readonly applySavedAccessibility: () => unknown
  readonly ACCESSIBILITY_COOKIE: string
}

vi.mock("virtual:site-a11y", async () => {
  try {
    const pkg = (await import(/* @vite-ignore */ env.specifier)) as PackageA11y
    return {
      sharedAccessibility: Object.freeze({
        read: (now?: number) => pkg.readAccessibility(now),
        save: (state: SharedAccessibilityState) => pkg.saveAccessibility(state),
        applySaved: () => {
          pkg.applySavedAccessibility()
        },
      }),
    }
  } catch (error) {
    if (env.require) throw error
    return { sharedAccessibility: null }
  }
})

import { sharedAccessibility } from "virtual:site-a11y"
import {
  CONTRAST_MODES,
  DEFAULT_PREFERENCES,
  loadPreferences,
  saveHiddenUntil,
  savePreferences,
  setToggle,
  TOGGLE_KEYS,
  type AccessibilityPreferences,
  type ToggleKey,
} from "@/lib/accessibility-preferences"

interface PackageRules {
  readonly ACCESSIBILITY_TOGGLES: readonly ToggleKey[]
  readonly CONTRAST_MODES: readonly ToggleKey[]
  readonly DEFAULT_ACCESSIBILITY: AccessibilityPreferences
  readonly setAccessibilityToggle: (prefs: AccessibilityPreferences, key: ToggleKey, on: boolean) => AccessibilityPreferences
}

const rules = sharedAccessibility ? ((await import(/* @vite-ignore */ env.specifier)) as PackageRules) : null

const COOKIE = "nodaro_a11y"

function clearCookie(): void {
  document.cookie = `${COOKIE}=; Path=/; Max-Age=0`
}

function cookieValue(): string | null {
  const found = document.cookie.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))
  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : null
}

describe.skipIf(!sharedAccessibility)("the app's menu, saved through the pinned package", () => {
  beforeEach(() => {
    clearCookie()
    window.localStorage.clear()
  })
  afterEach(() => {
    clearCookie()
    window.localStorage.clear()
  })

  it("writes the package's cookie and reads it back", () => {
    savePreferences({ ...DEFAULT_PREFERENCES, textScale: 2, strong: true, headings: true })
    expect(cookieValue()).toBe("1.2.kh.0")
    expect(loadPreferences()).toEqual({ ...DEFAULT_PREFERENCES, textScale: 2, strong: true, headings: true })
  })

  it("keeps the button's place and a newer product's letters and fields", () => {
    document.cookie = `${COOKIE}=${encodeURIComponent("1.0.cz.0.40,60.n1")}; Path=/`
    savePreferences({ ...DEFAULT_PREFERENCES, invert: true })
    expect(cookieValue()).toBe("1.0.iz.0.40,60.n1")

    const later = Date.now() + 7 * 24 * 60 * 60 * 1000
    saveHiddenUntil(later)
    expect(sharedAccessibility!.read()).toEqual({
      prefs: { ...DEFAULT_PREFERENCES, invert: true },
      hiddenUntil: later,
      position: { x: 40, y: 60 },
      unknownLetters: "z",
      extraFields: ["n1"],
    })
  })

  it("reads one contrast mode from a cookie that carries several", () => {
    document.cookie = `${COOKIE}=${encodeURIComponent("1.0.cik.0")}; Path=/`
    expect(loadPreferences()).toEqual({ ...DEFAULT_PREFERENCES, contrast: true })
  })
})

describe.skipIf(!rules)("the app's menu rules are the package's", () => {
  it("has the same choices, defaults and contrast modes", () => {
    expect([...TOGGLE_KEYS].sort()).toEqual([...rules!.ACCESSIBILITY_TOGGLES].sort())
    expect(DEFAULT_PREFERENCES).toEqual(rules!.DEFAULT_ACCESSIBILITY)
    expect(CONTRAST_MODES).toEqual(rules!.CONTRAST_MODES)
  })

  it("turns a choice on or off exactly as the package does", () => {
    const starts: readonly AccessibilityPreferences[] = [
      DEFAULT_PREFERENCES,
      ...CONTRAST_MODES.map((mode) => ({ ...DEFAULT_PREFERENCES, [mode]: true, links: true })),
    ]
    for (const start of starts) {
      for (const key of TOGGLE_KEYS) {
        for (const on of [true, false]) {
          expect(setToggle(start, key, on)).toEqual(rules!.setAccessibilityToggle(start, key, on))
        }
      }
    }
  })
})
