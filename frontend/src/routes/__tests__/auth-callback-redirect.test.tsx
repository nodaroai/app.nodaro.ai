import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * Google, and the native single sign-on providers (OIDC / SAML through the
 * Supabase client), come back through /auth/callback, which goes on to the
 * destination the login page kept: one of the app's own pages in place, as
 * before; a page of another product on the same host by a full page load. A
 * destination that names another site is never followed.
 */

const nav = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))
const leaveTo = vi.hoisted(() => vi.fn())
vi.mock("@/lib/leave-page", () => ({ leaveTo }))

const session = { access_token: "a", refresh_token: "r", user: { id: "u1" } }
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      // The code exchange has finished: the session is there.
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        queueMicrotask(() => cb("SIGNED_IN", session))
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      getSession: async () => ({ data: { session } }),
    },
  }),
}))

import AuthCallback from "../auth-callback"
import { registerAppRoutes } from "@/lib/sign-in-redirect"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

beforeEach(() => {
  nav.mockClear()
  leaveTo.mockClear()
  localStorage.clear()
  registerAppRoutes([
    { path: "/auth/callback" },
    { path: "/present/:shareToken" },
    { children: [{ path: "/projects" }, { path: "/projects/:id" }] },
    { path: "*" },
  ])
})
afterEach(() => registerAppRoutes(null))

function returnFromProvider(kept: string | null) {
  if (kept !== null) localStorage.setItem(AUTH_REDIRECT_KEY, kept)
  render(
    <MemoryRouter initialEntries={["/auth/callback?code=abc"]}>
      <AuthCallback />
    </MemoryRouter>,
  )
}

describe("AuthCallback — where the sign-in goes", () => {
  it("loads the voice changer in full when the login page kept it", async () => {
    returnFromProvider("/voice-changer/convert/abc")
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/voice-changer/convert/abc"))
    expect(nav).not.toHaveBeenCalled()
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBeNull()
  })

  it("loads a tools world in full (/trends/…)", async () => {
    returnFromProvider("/trends/some-trend")
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/trends/some-trend"))
    expect(nav).not.toHaveBeenCalled()
  })

  it("opens one of the app's own pages in place, as before", async () => {
    returnFromProvider("/present/share-token")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/present/share-token", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("never leaves the site for a kept destination that names another one", async () => {
    returnFromProvider("/\t/evil.com")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("with nothing kept, opens the dashboard", async () => {
    returnFromProvider(null)
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
  })

  it("goes on once, and a full page load is not followed by the safety timeout's /login", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      returnFromProvider("/voice-changer/convert/abc")
      // The listener (a microtask) and the getSession fallback both report the session.
      await act(async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve()
      })
      expect(leaveTo).toHaveBeenCalledTimes(1)

      // The next document is slow to arrive: this page is still mounted.
      act(() => {
        vi.advanceTimersByTime(6000)
      })
      expect(nav).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
