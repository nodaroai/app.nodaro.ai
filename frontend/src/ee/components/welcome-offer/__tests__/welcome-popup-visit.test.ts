import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The per-tab "already opened by itself in this visit" mark: per account,
 * kept across a reload of the same tab (sessionStorage), and still kept for
 * the life of the page when the browser refuses storage.
 */

const KEY = "nodaro.welcomePopup.autoShown:u1"

async function freshModule() {
  vi.resetModules()
  return import("../welcome-popup-visit")
}

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe("welcome popup visit mark", () => {
  it("starts unmarked, and marks one account only", async () => {
    const visit = await freshModule()
    expect(visit.autoShownThisVisit("u1")).toBe(false)
    visit.markAutoShownThisVisit("u1")
    expect(visit.autoShownThisVisit("u1")).toBe(true)
    expect(visit.autoShownThisVisit("u2")).toBe(false)
    expect(window.sessionStorage.getItem(KEY)).toBe("1")
  })

  it("a reload of the same tab is the same visit", async () => {
    window.sessionStorage.setItem(KEY, "1")
    const visit = await freshModule()
    expect(visit.autoShownThisVisit("u1")).toBe(true)
  })

  it("with storage refused, the page still remembers", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError")
    })
    const visit = await freshModule()
    expect(visit.autoShownThisVisit("u1")).toBe(false)
    visit.markAutoShownThisVisit("u1")
    expect(visit.autoShownThisVisit("u1")).toBe(true)
  })
})
