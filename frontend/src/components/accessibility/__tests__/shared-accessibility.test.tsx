import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SharedAccessibilityState } from "virtual:site-a11y"

/**
 * A build with the shared site header: the accessibility choices live in the
 * store every Nodaro product shares (`virtual:site-a11y`, faked here), on
 * every page, and this browser's own storage is never a second source. And
 * where the header is mounted, its menu is the one on the page. All of that
 * only where the deployment shows the header (`siteHeaderMode()`, faked here:
 * on unless a test says otherwise); elsewhere the build's module is unused.
 */

const shared = vi.hoisted(() => {
  const none = {
    textScale: 0 as 0 | 1 | 2,
    contrast: false,
    invert: false,
    strong: false,
    spacing: false,
    links: false,
    headings: false,
    readableFont: false,
    bigCursor: false,
    stopMotion: false,
  }
  let state: SharedAccessibilityState = { prefs: none, hiddenUntil: null }
  return {
    none,
    get state() {
      return state
    },
    set(next: SharedAccessibilityState) {
      state = next
    },
    store: {
      read: vi.fn(() => state),
      save: vi.fn((next: SharedAccessibilityState) => {
        state = next
      }),
      applySaved: vi.fn(),
    },
  }
})

const mode = vi.hoisted(() => ({ value: "default" as "default" | "white-label" | null }))
vi.mock("@/lib/site-header-mode", () => ({
  siteHeaderMode: () => mode.value,
  siteHeaderCookieOptions: () => (mode.value === "white-label" ? { cookieDomain: null } : {}),
}))
const { STYLESHEET } = vi.hoisted(() => ({ STYLESHEET: "/assets/a11y-0123abcd.css" }))
vi.mock("virtual:site-a11y", () => ({ sharedAccessibility: shared.store, a11yStylesheet: STYLESHEET }))
vi.mock("@/lib/accessibility-statement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accessibility-statement")>()),
  accessibilityStatementShown: () => true,
}))

import {
  applySavedPreferences,
  HIDE_KEY,
  linkSharedAccessibilityStylesheet,
  loadHiddenUntil,
  loadPreferences,
  resetSharedAccessibilityStylesheetForTests,
  saveHiddenUntil,
  savePreferences,
  STORAGE_KEY,
} from "@/lib/accessibility-preferences"
import { markSharedHeaderMounted } from "@/lib/shared-header"
import { AccessibilityMenuRoot } from "../accessibility-menu-root"

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000

beforeEach(() => {
  window.localStorage.clear()
  shared.set({ prefs: shared.none, hiddenUntil: null })
  vi.clearAllMocks()
  mode.value = "default"
  resetSharedAccessibilityStylesheetForTests()
})

const linked = () => [...document.querySelectorAll<HTMLLinkElement>("link[data-site-a11y]")]

describe("the choices on a shared-header build", () => {
  it("are read from and kept in the shared store, never this browser's storage", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ contrast: true }))
    expect(loadPreferences()).toEqual(shared.none)

    savePreferences({ ...shared.none, links: true })
    expect(shared.state).toEqual({ prefs: { ...shared.none, links: true }, hiddenUntil: null })
    saveHiddenUntil(FUTURE)
    expect(shared.state).toEqual({ prefs: { ...shared.none, links: true }, hiddenUntil: FUTURE })
    expect(loadHiddenUntil()).toBe(FUTURE)
    saveHiddenUntil(null)
    expect(loadHiddenUntil()).toBeNull()

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ contrast: true }))
    expect(window.localStorage.getItem(HIDE_KEY)).toBeNull()
  })

  it("keep the header's button place and a newer product's letters and fields when this menu saves", () => {
    const kept = { position: { x: 40, y: 60 }, unknownLetters: "z", extraFields: ["n1"] } as const
    shared.set({ prefs: shared.none, hiddenUntil: null, ...kept })

    savePreferences({ ...shared.none, strong: true })
    expect(shared.state).toEqual({ prefs: { ...shared.none, strong: true }, hiddenUntil: null, ...kept })
    saveHiddenUntil(FUTURE)
    expect(shared.state).toEqual({ prefs: { ...shared.none, strong: true }, hiddenUntil: FUTURE, ...kept })
  })

  it("apply before the first paint through the header's own call, and only that", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ contrast: true }))
    applySavedPreferences()
    expect(shared.store.applySaved).toHaveBeenCalledTimes(1)
    expect(document.documentElement.hasAttribute("data-a11y-contrast")).toBe(false)
  })
})

describe("one menu per page", () => {
  const router = {
    subscribe: () => () => {},
    state: { location: { pathname: "/projects" } },
    navigate: vi.fn(),
  } as unknown as Parameters<typeof AccessibilityMenuRoot>[0]["router"]

  let unmount: (() => void) | null = null
  afterEach(() => {
    act(() => unmount?.())
    unmount = null
  })

  it("the app's own menu steps aside while the header (with its menu) is mounted, and comes back after", () => {
    render(<AccessibilityMenuRoot router={router} />)
    expect(screen.getByRole("button", { name: "Accessibility menu" })).toBeInTheDocument()

    act(() => {
      unmount = markSharedHeaderMounted()
    })
    expect(screen.queryByRole("button", { name: "Accessibility menu" })).toBeNull()

    act(() => {
      unmount?.()
      unmount = null
    })
    expect(screen.getByRole("button", { name: "Accessibility menu" })).toBeInTheDocument()
  })

  it("the app's own menu, where it stays, shows the shared choices", () => {
    shared.set({ prefs: { ...shared.none, headings: true }, hiddenUntil: null })
    render(<AccessibilityMenuRoot router={router} />)
    expect(document.documentElement.hasAttribute("data-a11y-headings")).toBe(true)
  })
})

describe("the header's stylesheet", () => {
  it("is linked once, before the first paint, where the deployment shows the header", () => {
    applySavedPreferences()
    applySavedPreferences()
    expect(linked().map((link) => [link.rel, link.getAttribute("href")])).toEqual([["stylesheet", STYLESHEET]])
  })

  it("the header waits for it to apply, and fails when it cannot load", async () => {
    const ready = linkSharedAccessibilityStylesheet()
    linked()[0]?.dispatchEvent(new Event("load"))
    await expect(ready).resolves.toBeUndefined()
    resetSharedAccessibilityStylesheetForTests()
    const broken = linkSharedAccessibilityStylesheet()
    linked()[0]?.dispatchEvent(new Event("error"))
    await expect(broken).rejects.toThrow(/did not load/)
  })
})

describe("where the deployment shows no shared header", () => {
  // The image built for deployments of their own carries the header's module;
  // a deployment that does not ask for the header gets none of it.
  beforeEach(() => {
    mode.value = null
  })

  it("this browser's own storage is the store, as on a build without the header", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ contrast: true }))
    expect(loadPreferences()).toEqual({ ...shared.none, contrast: true })
    savePreferences({ ...shared.none, links: true })
    saveHiddenUntil(FUTURE)
    expect(loadHiddenUntil()).toBe(FUTURE)
    expect(shared.store.read).not.toHaveBeenCalled()
    expect(shared.store.save).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ ...shared.none, links: true }))
  })

  it("applies the choices itself, and links no stylesheet of the header's", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ contrast: true }))
    applySavedPreferences()
    expect(shared.store.applySaved).not.toHaveBeenCalled()
    expect(document.documentElement.hasAttribute("data-a11y-contrast")).toBe(true)
    await expect(linkSharedAccessibilityStylesheet()).resolves.toBeUndefined()
    expect(linked()).toEqual([])
    document.documentElement.removeAttribute("data-a11y-contrast")
  })
})

describe("on a white-label deployment", () => {
  it("every read and write of the shared choices keeps them on this host", () => {
    mode.value = "white-label"
    loadPreferences()
    savePreferences({ ...shared.none, links: true })
    loadHiddenUntil()
    saveHiddenUntil(FUTURE)
    applySavedPreferences()
    const host = { cookieDomain: null }
    expect(shared.store.read.mock.calls.every((call) => (call as unknown[])[1] !== undefined && JSON.stringify((call as unknown[])[1]) === JSON.stringify(host))).toBe(true)
    expect(shared.store.save.mock.calls.map((call) => (call as unknown[])[1])).toEqual([host, host])
    expect(shared.store.applySaved).toHaveBeenCalledWith(host)
  })
})
