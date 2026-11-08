import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { RouteObject } from "react-router-dom"

const leaveTo = vi.hoisted(() => vi.fn())
vi.mock("@/lib/leave-page", () => ({ leaveTo }))

import {
  DEFAULT_SIGN_IN_PATH,
  followSignInRedirect,
  isAppPath,
  registerAppRoutes,
  rememberSignInRedirect,
  sameSitePath,
  takeSignInRedirect,
} from "../sign-in-redirect"
import { AUTH_REDIRECT_KEY } from "../storage-keys"

/** The router's shape: public pages, a layout whose children are the dashboard, a gated block, and the catch-all. */
const ROUTES: RouteObject[] = [
  { path: "/" },
  { path: "/auth/callback" },
  { path: "/sso" },
  { path: "/login" },
  { path: "/present/:shareToken" },
  { path: "/app/:slug" },
  {
    children: [
      { path: "/projects" },
      { path: "/projects/:id/workflows/:workflowId" },
      { path: "/settings" },
      { path: "/settings/api" },
      { path: "/library" },
      { path: "/my-files" },
    ],
  },
  { path: "/admin", children: [{ index: true }, { path: "users" }] },
  { path: "*" },
]

/** Pages of the site's other products, served beside the app from one host. */
const OTHER_PRODUCTS = [
  "/voice-changer",
  "/voice-changer/convert/abc?step=2",
  "/he/voice-changer/convert/abc",
  "/voice-changer?redirect=%2Fconvert%2Fx",
  "/image",
  "/video/abc",
  "/music",
  "/trends/some-trend",
]

/** Every way of naming another site that a character check misses. */
const HOSTILE = [
  "//evil.com",
  "///evil.com",
  "/\\evil.com",
  "/\t/evil.com",
  "/\n/evil.com",
  "/.//evil.com",
  "/x/..//evil.com",
  "https://evil.com",
  "http://evil.com/projects",
  "javascript:alert(1)",
  "evil.com",
  "",
]

beforeEach(() => {
  leaveTo.mockClear()
  localStorage.clear()
})

describe("sameSitePath", () => {
  it("keeps a path on this site with its query and hash", () => {
    expect(sameSitePath("/projects")).toBe("/projects")
    expect(sameSitePath("/library?job=1")).toBe("/library?job=1")
    expect(sameSitePath("/voice-changer/convert/abc?step=2#top")).toBe("/voice-changer/convert/abc?step=2#top")
  })

  it("refuses every way of naming another site", () => {
    for (const raw of HOSTILE) expect(sameSitePath(raw), JSON.stringify(raw)).toBeNull()
  })

  it("refuses what is not a string", () => {
    for (const raw of [null, undefined, 42, {}, ["/projects"]]) expect(sameSitePath(raw)).toBeNull()
  })
})

describe("isAppPath", () => {
  afterEach(() => registerAppRoutes(null))

  it("with no tree registered, every path is the app's (the in-place navigation of before)", () => {
    registerAppRoutes(null)
    expect(isAppPath("/image")).toBe(true)
  })

  it("is true for the app's own pages, nested and dynamic ones included", () => {
    registerAppRoutes(ROUTES)
    for (const path of ["/", "/projects", "/projects/p1/workflows/w1", "/settings/api", "/library?job=1", "/present/tok", "/admin", "/admin/users"]) {
      expect(isAppPath(path), path).toBe(true)
    }
  })

  it("is false for a path only the not-found catch-all answers: another product's page", () => {
    registerAppRoutes(ROUTES)
    for (const path of [...OTHER_PRODUCTS, "/projects/p1/unknown", "/admin/nope"]) expect(isAppPath(path), path).toBe(false)
  })
})

describe("followSignInRedirect", () => {
  beforeEach(() => registerAppRoutes(ROUTES))
  afterEach(() => registerAppRoutes(null))

  it("opens one of the app's own pages in place, replacing the sign-in", () => {
    const navigate = vi.fn()
    followSignInRedirect(navigate, "/settings/api")
    expect(navigate).toHaveBeenCalledWith("/settings/api", { replace: true })
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("loads another product's page on this site in full", () => {
    for (const path of OTHER_PRODUCTS) {
      const navigate = vi.fn()
      followSignInRedirect(navigate, path)
      expect(navigate, path).not.toHaveBeenCalled()
      expect(leaveTo).toHaveBeenLastCalledWith(path)
    }
  })

  it("never leaves the site: anything unsafe opens the dashboard in place", () => {
    for (const raw of [...HOSTILE, null, undefined]) {
      const navigate = vi.fn()
      followSignInRedirect(navigate, raw)
      expect(navigate, JSON.stringify(raw)).toHaveBeenCalledWith(DEFAULT_SIGN_IN_PATH, { replace: true })
    }
    expect(leaveTo).not.toHaveBeenCalled()
  })
})

describe("the kept destination", () => {
  it("is kept across a round trip, read once", () => {
    rememberSignInRedirect("/voice-changer/convert/abc")
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBe("/voice-changer/convert/abc")
    expect(takeSignInRedirect()).toBe("/voice-changer/convert/abc")
    expect(takeSignInRedirect()).toBeNull()
  })

  it("keeps nothing unsafe", () => {
    for (const raw of HOSTILE) {
      rememberSignInRedirect(raw)
      expect(localStorage.getItem(AUTH_REDIRECT_KEY), JSON.stringify(raw)).toBeNull()
    }
  })

  it("an unsafe value someone else stored is never followed, and is cleared", () => {
    localStorage.setItem(AUTH_REDIRECT_KEY, "/\\evil.com")
    expect(takeSignInRedirect()).toBeNull()
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBeNull()
  })
})
