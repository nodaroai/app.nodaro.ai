import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isFirstSignIn, reportSignIn, signInMethodOf } from "../sign-in-events"

type AnalyticsGlobals = { dataLayer?: unknown[]; __NODARO_GA__?: unknown }
const globals = window as unknown as AnalyticsGlobals

/** The event names that reached the data layer, in order. */
function sentEvents(): unknown[] {
  return (globals.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>)).filter((c) => c[0] === "event").map((c) => [c[1], c[2]])
}

const NEW_ACCOUNT = {
  id: "user-new",
  created_at: "2026-11-13T10:00:00.000Z",
  last_sign_in_at: "2026-11-13T10:00:00.900Z",
  app_metadata: { provider: "google" },
}
const RETURNING = { ...NEW_ACCOUNT, id: "user-old", created_at: "2026-01-02T08:00:00.000Z" }

beforeEach(() => {
  localStorage.clear()
  globals.dataLayer = []
  globals.__NODARO_GA__ = { measurementId: "G-TEST1234" }
})

afterEach(() => {
  delete globals.dataLayer
  delete globals.__NODARO_GA__
})

describe("isFirstSignIn", () => {
  it("is the sign-in stamped within two minutes of the account's creation", () => {
    expect(isFirstSignIn(NEW_ACCOUNT)).toBe(true)
    expect(isFirstSignIn({ ...NEW_ACCOUNT, last_sign_in_at: "2026-11-13T10:01:59.000Z" })).toBe(true)
    expect(isFirstSignIn({ ...NEW_ACCOUNT, last_sign_in_at: "2026-11-13T10:02:01.000Z" })).toBe(false)
    expect(isFirstSignIn(RETURNING)).toBe(false)
  })

  it("falls back to now when the sign-in time is missing, and is never true without a creation time", () => {
    const now = Date.parse(NEW_ACCOUNT.created_at) + 30_000
    expect(isFirstSignIn({ id: "u", created_at: NEW_ACCOUNT.created_at }, now)).toBe(true)
    expect(isFirstSignIn({ id: "u", created_at: NEW_ACCOUNT.created_at }, now + 3_600_000)).toBe(false)
    expect(isFirstSignIn({ id: "u" })).toBe(false)
    expect(isFirstSignIn({ id: "u", created_at: "not a date" })).toBe(false)
  })
})

describe("signInMethodOf", () => {
  it("names the identity provider, or other", () => {
    expect(signInMethodOf(NEW_ACCOUNT)).toBe("google")
    expect(signInMethodOf({ id: "u", app_metadata: { provider: "email" } })).toBe("email")
    expect(signInMethodOf({ id: "u", app_metadata: { provider: "Not A Provider!" } })).toBe("other")
    expect(signInMethodOf({ id: "u" })).toBe("other")
  })
})

describe("reportSignIn", () => {
  it("reports an account's first sign-in as its sign-up, once per browser", () => {
    reportSignIn(NEW_ACCOUNT)
    reportSignIn(NEW_ACCOUNT)
    expect(sentEvents()).toEqual([
      ["sign_up", { method: "google", send_to: "G-TEST1234" }],
      ["login", { method: "google", send_to: "G-TEST1234" }],
    ])
  })

  it("remembers the sign-up across page loads on the same browser", async () => {
    const account = { ...NEW_ACCOUNT, id: "user-reloaded" }
    reportSignIn(account)
    // A new page: the module (and its in-page note) is loaded afresh; the browser's storage stays.
    vi.resetModules()
    const reloaded = await import("../sign-in-events")
    reloaded.reportSignIn(account)
    expect(sentEvents()).toEqual([
      ["sign_up", { method: "google", send_to: "G-TEST1234" }],
      ["login", { method: "google", send_to: "G-TEST1234" }],
    ])
  })

  it("reports a returning account's sign-in as a login, with the method it is given", () => {
    reportSignIn(RETURNING, "sso")
    expect(sentEvents()).toEqual([["login", { method: "sso", send_to: "G-TEST1234" }]])
  })

  it("never throws, whatever storage does — and still reports a sign-up only once on this page", () => {
    const original = { getItem: Storage.prototype.getItem, setItem: Storage.prototype.setItem }
    Storage.prototype.getItem = () => {
      throw new Error("storage blocked")
    }
    Storage.prototype.setItem = () => {
      throw new Error("storage full")
    }
    try {
      const account = { ...NEW_ACCOUNT, id: "user-no-storage" }
      expect(() => reportSignIn(account)).not.toThrow()
      expect(() => reportSignIn(account)).not.toThrow()
      expect(sentEvents()).toEqual([
        ["sign_up", { method: "google", send_to: "G-TEST1234" }],
        ["login", { method: "google", send_to: "G-TEST1234" }],
      ])
    } finally {
      Storage.prototype.getItem = original.getItem
      Storage.prototype.setItem = original.setItem
    }
  })

  it("never throws for a session that carries no user", () => {
    expect(() => reportSignIn(undefined as never)).not.toThrow()
    expect(() => reportSignIn(null as never, "sso")).not.toThrow()
    expect(sentEvents()).toEqual([])
  })
})
