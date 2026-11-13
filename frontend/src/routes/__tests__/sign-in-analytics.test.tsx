import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The sign-in (or sign-up) for the site analytics is reported where a sign-in
 * completes — the OAuth callback and the SSO landing — once, before the page
 * goes on; never from a popup sign-in (its window closes at once), never for a
 * failed SSO exchange.
 */

const nav = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))
vi.mock("@/lib/leave-page", () => ({ leaveTo: vi.fn() }))
const { reportSignIn } = vi.hoisted(() => ({ reportSignIn: vi.fn() }))
vi.mock("@/lib/analytics/sign-in-events", () => ({ reportSignIn }))

const user = { id: "u1", created_at: "2026-11-13T10:00:00Z", last_sign_in_at: "2026-11-13T10:00:01Z" }
const session = { access_token: "a", refresh_token: "r", user }
const verifyOtp = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        queueMicrotask(() => cb("SIGNED_IN", session))
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      getSession: async () => ({ data: { session } }),
      verifyOtp,
    },
  }),
}))

import AuthCallback from "../auth-callback"
import SsoLandingPage from "../sso-landing"
import { registerAppRoutes } from "@/lib/sign-in-redirect"

beforeEach(() => {
  nav.mockClear()
  reportSignIn.mockClear()
  verifyOtp.mockReset()
  localStorage.clear()
  registerAppRoutes([{ path: "/auth/callback" }, { path: "/sso" }, { path: "/login" }, { children: [{ path: "/projects" }] }, { path: "*" }])
})
afterEach(() => {
  registerAppRoutes(null)
  Reflect.deleteProperty(window, "opener")
  ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = undefined
})

describe("the OAuth callback", () => {
  it("reports the sign-in once, though both the listener and the fallback see the session, before going on", async () => {
    const order: string[] = []
    reportSignIn.mockImplementation(() => order.push("report"))
    nav.mockImplementation(() => order.push("navigate"))
    render(
      <MemoryRouter initialEntries={["/auth/callback?code=abc"]}>
        <AuthCallback />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    expect(reportSignIn).toHaveBeenCalledTimes(1)
    expect(reportSignIn).toHaveBeenCalledWith(user)
    expect(order).toEqual(["report", "navigate"])
  })

  it("a popup sign-in reports nothing: its window hands the session over and closes", async () => {
    Object.defineProperty(window, "opener", { value: { postMessage: vi.fn() }, configurable: true })
    vi.spyOn(window, "close").mockImplementation(() => {})
    render(
      <MemoryRouter initialEntries={["/auth/callback?code=abc"]}>
        <AuthCallback />
      </MemoryRouter>,
    )
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    expect(reportSignIn).not.toHaveBeenCalled()
  })
})

describe("the SSO landing", () => {
  it("reports an SSO sign-in with its method once the token is redeemed", async () => {
    ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = { token: "HASH", next: "/projects" }
    verifyOtp.mockResolvedValue({ data: { user, session }, error: null })
    render(
      <MemoryRouter>
        <SsoLandingPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
    expect(reportSignIn).toHaveBeenCalledWith(user, "sso")
  })

  it("a failed exchange reports nothing", async () => {
    ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = { token: "HASH", next: "/projects" }
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "expired" } })
    render(
      <MemoryRouter>
        <SsoLandingPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login", { replace: true }))
    expect(reportSignIn).not.toHaveBeenCalled()
  })
})
