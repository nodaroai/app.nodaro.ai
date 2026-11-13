import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  STAFF_BROWSER_KEY,
  checkoutAnalyticsIds,
  resetAnalyticsStateForTests,
  syncAnalyticsIdentity,
  trackEvent,
} from "../site-analytics"

type AnalyticsGlobals = { dataLayer?: unknown[]; clarity?: unknown; __NODARO_GA__?: unknown }
const globals = window as unknown as AnalyticsGlobals

/** What reached the data layer, each entry as [kind, values]. */
function pushed(): Array<[string, unknown[]]> {
  return (globals.dataLayer ?? []).map((entry) => [
    Object.prototype.toString.call(entry),
    Array.from(entry as ArrayLike<unknown>),
  ])
}

/** What index.html's loader leaves on a page where it loaded the container (and Clarity). */
function loadAnalytics(loader: { internal?: boolean } = {}): ReturnType<typeof vi.fn> {
  globals.dataLayer = []
  globals.__NODARO_GA__ = { measurementId: "G-TEST1234", internal: loader.internal ?? false }
  const clarity = vi.fn()
  globals.clarity = clarity
  return clarity
}

const member = { userId: "user-1", staff: false, plan: "free" }
const staff = { userId: "staff-1", staff: true, plan: "pro" }

beforeEach(() => {
  resetAnalyticsStateForTests()
  localStorage.clear()
})

afterEach(() => {
  delete globals.dataLayer
  delete globals.clarity
  delete globals.__NODARO_GA__
  Reflect.deleteProperty(document, "prerendering")
})

describe("trackEvent", () => {
  it("addresses a gtag-style command to the loaded measurement id, as a real arguments object", () => {
    const clarity = loadAnalytics()
    trackEvent("begin_checkout", { checkout_type: "plan", items: [{ item_id: "price_1" }] })
    expect(pushed()).toEqual([
      ["[object Arguments]", ["event", "begin_checkout", { checkout_type: "plan", items: [{ item_id: "price_1" }], send_to: "G-TEST1234" }]],
    ])
    expect(clarity).toHaveBeenCalledWith("event", "begin_checkout")
  })

  it("sends nothing to the data layer when the loader exposed no measurement id", () => {
    loadAnalytics()
    delete globals.__NODARO_GA__
    trackEvent("workflow_run", { run_scope: "all" })
    expect(pushed()).toEqual([])
  })

  it("ignores a malformed measurement id", () => {
    loadAnalytics()
    globals.__NODARO_GA__ = { measurementId: "GTM-ABCDEF" }
    trackEvent("workflow_run")
    expect(pushed()).toEqual([])
  })

  it("never throws: no data layer, no Clarity, or a Clarity that throws", () => {
    globals.__NODARO_GA__ = { measurementId: "G-TEST1234" }
    expect(() => trackEvent("sign_up")).not.toThrow()
    globals.clarity = () => {
      throw new Error("clarity broke")
    }
    expect(() => trackEvent("sign_up")).not.toThrow()
  })

  it("waits for a prerendered page to be shown, then reads the id the loader set by then", () => {
    Object.defineProperty(document, "prerendering", { value: true, configurable: true })
    trackEvent("workflow_run", { run_scope: "node" })
    // The loader runs on activation, before the held event.
    loadAnalytics()
    expect(pushed()).toEqual([])
    Object.defineProperty(document, "prerendering", { value: false, configurable: true })
    document.dispatchEvent(new Event("prerenderingchange"))
    expect(pushed()).toEqual([["[object Arguments]", ["event", "workflow_run", { run_scope: "node", send_to: "G-TEST1234" }]]])
  })
})

describe("syncAnalyticsIdentity", () => {
  it("sets the user id and plan for a member, and tells Clarity who it is", () => {
    const clarity = loadAnalytics()
    syncAnalyticsIdentity(member)
    expect(pushed().map(([, values]) => values)).toEqual([
      ["set", { user_id: "user-1" }],
      ["set", "user_properties", { plan: "free" }],
    ])
    expect(clarity.mock.calls).toEqual([
      ["identify", "user-1"],
      ["set", "plan", "free"],
    ])
    expect(localStorage.getItem(STAFF_BROWSER_KEY)).toBeNull()
  })

  it("marks a staff account's traffic internal and remembers the browser for the loader", () => {
    const clarity = loadAnalytics()
    syncAnalyticsIdentity(staff)
    expect(pushed().map(([, values]) => values)).toEqual([
      ["set", { traffic_type: "internal" }],
      ["set", { user_id: "staff-1" }],
      ["set", "user_properties", { plan: "pro" }],
    ])
    expect(clarity).toHaveBeenCalledWith("set", "staff", "yes")
    expect(localStorage.getItem(STAFF_BROWSER_KEY)).toBe("1")
  })

  it("does not mark again what the loader already marked", () => {
    loadAnalytics({ internal: true })
    syncAnalyticsIdentity(staff)
    expect(pushed().map(([, values]) => values)).not.toContainEqual(["set", { traffic_type: "internal" }])
  })

  it("goes by what the loader pushed, not by the key another tab changed since", () => {
    // Another tab marked the browser after this page loaded unmarked.
    localStorage.setItem(STAFF_BROWSER_KEY, "1")
    loadAnalytics({ internal: false })
    syncAnalyticsIdentity(staff)
    expect(pushed()[0]?.[1]).toEqual(["set", { traffic_type: "internal" }])
  })

  it("clears the internal mark when a member signs in on a page the loader marked", () => {
    localStorage.setItem(STAFF_BROWSER_KEY, "1")
    loadAnalytics({ internal: true })
    syncAnalyticsIdentity(member)
    expect(pushed()[0]?.[1]).toEqual(["set", { traffic_type: null }])
    expect(localStorage.getItem(STAFF_BROWSER_KEY)).toBeNull()
  })

  it("pushes nothing for the same identity again (token refresh, tab focus)", () => {
    loadAnalytics()
    syncAnalyticsIdentity(member)
    const after = pushed().length
    syncAnalyticsIdentity({ ...member })
    expect(pushed()).toHaveLength(after)
  })

  it("clears the user id on sign-out, keeps the staff browser mark, and says nothing for a visitor never signed in", () => {
    loadAnalytics()
    syncAnalyticsIdentity(null)
    expect(pushed()).toEqual([])
    syncAnalyticsIdentity(staff)
    const before = pushed().length
    syncAnalyticsIdentity(null)
    expect(pushed().slice(before).map(([, values]) => values)).toEqual([["set", { user_id: null }]])
    expect(localStorage.getItem(STAFF_BROWSER_KEY)).toBe("1")
  })

  it("without the measurement id nothing reaches the data layer nor the staff key; a loaded Clarity still hears who it is", () => {
    const clarity = loadAnalytics()
    delete globals.__NODARO_GA__
    syncAnalyticsIdentity(staff)
    expect(pushed()).toEqual([])
    expect(localStorage.getItem(STAFF_BROWSER_KEY)).toBeNull()
    expect(clarity).toHaveBeenCalledWith("identify", "staff-1")
  })
})

describe("checkoutAnalyticsIds", () => {
  afterEach(() => {
    document.cookie = "_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT"
    document.cookie = "_ga_TEST1234=; expires=Thu, 01 Jan 1970 00:00:00 GMT"
  })

  it("reads the visit's ids from the GA cookies once the container is loaded", () => {
    document.cookie = "_ga=GA1.1.1234567890.1700000000"
    document.cookie = "_ga_TEST1234=GS2.1.s1700000500$o3$g1$t1700000900$j0$l0$h0"
    expect(checkoutAnalyticsIds()).toEqual({})
    loadAnalytics()
    expect(checkoutAnalyticsIds()).toEqual({ gaClientId: "1234567890.1700000000", gaSessionId: "1700000500" })
  })
})
