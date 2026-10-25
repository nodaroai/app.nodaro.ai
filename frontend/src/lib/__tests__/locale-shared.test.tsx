import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, cleanup, act } from "@testing-library/react"
import type { LocaleId } from "@nodaro/shared/i18n"

/**
 * The language every Nodaro product shares (`virtual:site-locale`): read
 * first at startup, written on every choice the user makes and on the
 * account's language at sign-in, and only SHOWN when another product changed
 * it. The module is the header's on a cloud build and a stub elsewhere; here
 * it is a fake cookie the tests can read and set.
 */

const shared = vi.hoisted(() => ({
  value: null as string | null,
  saved: [] as string[],
  watcher: null as null | { onChange: (id: string) => void; current: () => string | null },
  unsubscribed: 0,
}))

vi.mock("virtual:site-locale", () => ({
  readSavedLocale: () => shared.value,
  saveLocale: (id: string) => {
    shared.saved.push(id)
    shared.value = id
  },
  watchSavedLocale: (onChange: (id: string) => void, current: () => string | null) => {
    shared.watcher = { onChange, current }
    return () => {
      shared.unsubscribed += 1
      shared.watcher = null
    }
  },
}))

const KEY = "nodaro:preferred-locale"

async function loadStore() {
  return import("../locale-store")
}

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  shared.value = null
  shared.saved = []
  shared.watcher = null
  shared.unsubscribed = 0
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.removeAttribute("lang")
  document.documentElement.removeAttribute("dir")
})

describe("the shared language at startup", () => {
  it("a language chosen on another product beats this device's own saved choice", async () => {
    window.localStorage.setItem(KEY, "ja")
    shared.value = "he"
    const { resolveInitialLocale, useLocaleStore } = await loadStore()
    expect(resolveInitialLocale()).toBe("he")
    expect(useLocaleStore.getState()).toMatchObject({ locale: "he", dir: "rtl" })
  })

  it("no shared choice: the device's own saved choice, as before", async () => {
    window.localStorage.setItem(KEY, "ja")
    const { resolveInitialLocale } = await loadStore()
    expect(resolveInitialLocale()).toBe("ja")
  })

  it("reading never writes: the start-up language is not saved for anyone", async () => {
    shared.value = "he"
    await loadStore()
    expect(shared.saved).toEqual([])
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it("<html lang dir> are set from it before the first render", async () => {
    shared.value = "he"
    const { applyDocumentLocale } = await import("@/components/i18n-html-dir")
    applyDocumentLocale()
    expect(document.documentElement.getAttribute("lang")).toBe("he")
    expect(document.documentElement.getAttribute("dir")).toBe("rtl")
  })
})

describe("writing the shared language", () => {
  it("a language the user picks is kept for every product and on this device", async () => {
    const { useLocaleStore } = await loadStore()
    useLocaleStore.getState().setLocale("pt-BR")
    expect(shared.saved).toEqual(["pt-BR"])
    expect(window.localStorage.getItem(KEY)).toBe("pt-BR")
  })

  it("at sign-in the account's language wins and is kept; an account without one changes nothing", async () => {
    shared.value = "ja"
    const { useLocaleStore } = await loadStore()
    useLocaleStore.getState().markHydrated(null, "no-language")
    expect(shared.saved).toEqual([])
    expect(useLocaleStore.getState().locale).toBe("ja")

    useLocaleStore.getState().markHydrated("he" as LocaleId, "user-1")
    expect(shared.saved).toEqual(["he"])
    expect(useLocaleStore.getState()).toMatchObject({ locale: "he", dir: "rtl", hydrated: true })
  })

  it("the account's language applies once per user: a remount or refetch never drags back a language chosen since", async () => {
    const { useLocaleStore } = await loadStore()
    useLocaleStore.getState().markHydrated("en" as LocaleId, "user-1")
    useLocaleStore.getState().followLocale("he") // another product changed it
    useLocaleStore.getState().markHydrated("en" as LocaleId, "user-1")
    expect(useLocaleStore.getState().locale).toBe("he")
    expect(shared.saved).toEqual(["en"])
  })

  it("a language picked before the profile answers is not taken back by it", async () => {
    const { useLocaleStore } = await loadStore()
    useLocaleStore.getState().setLocale("ko")
    useLocaleStore.getState().markHydrated("en" as LocaleId, "user-1")
    expect(useLocaleStore.getState()).toMatchObject({ locale: "ko", hydrated: true })
    expect(shared.saved).toEqual(["ko"])
  })

  it("a change another product made is shown and written nowhere", async () => {
    window.localStorage.setItem(KEY, "en")
    const { useLocaleStore } = await loadStore()
    useLocaleStore.getState().followLocale("he")
    expect(useLocaleStore.getState()).toMatchObject({ locale: "he", dir: "rtl" })
    expect(shared.saved).toEqual([])
    expect(window.localStorage.getItem(KEY)).toBe("en")
  })
})

describe("following the shared language on an open page", () => {
  it("I18nHtmlDir watches it while mounted: the page shows the new language and stops watching on unmount", async () => {
    const { useLocaleStore } = await loadStore()
    const { I18nHtmlDir } = await import("@/components/i18n-html-dir")
    const view = render(<I18nHtmlDir />)
    expect(shared.watcher?.current()).toBe(useLocaleStore.getState().locale)

    act(() => shared.watcher?.onChange("he"))
    expect(useLocaleStore.getState().locale).toBe("he")
    expect(document.documentElement.getAttribute("dir")).toBe("rtl")
    expect(shared.watcher?.current()).toBe("he")
    expect(shared.saved).toEqual([])

    view.unmount()
    expect(shared.unsubscribed).toBe(1)
  })
})
