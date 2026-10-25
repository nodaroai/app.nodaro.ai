import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SharedAccessibilityState } from "virtual:site-a11y"

/**
 * A build with the shared site header: the accessibility choices live in the
 * store every Nodaro product shares (`virtual:site-a11y`, faked here), on
 * every page, and this browser's own storage is never a second source. And
 * where the header is mounted, its menu is the one on the page.
 */

const shared = vi.hoisted(() => {
  const none = {
    textScale: 0 as 0 | 1 | 2,
    contrast: false,
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

vi.mock("virtual:site-a11y", () => ({ sharedAccessibility: shared.store }))
vi.mock("@/lib/accessibility-statement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accessibility-statement")>()),
  accessibilityStatementShown: () => true,
}))

import {
  applySavedPreferences,
  HIDE_KEY,
  loadHiddenUntil,
  loadPreferences,
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
})

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
