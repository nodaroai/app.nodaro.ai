import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const nav = vi.fn()
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))

const createClient = vi.fn(() => ({
  auth: {
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    getSession: async () => ({ data: { session: null } }),
  },
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => createClient() }))

import AuthCallback from "../auth-callback"

/**
 * GoTrue sends a blocked account back from an OAuth sign-in with
 * `error_code=user_banned`. Without this branch the callback waited out its
 * 5-second timeout and dropped the person on a bare login form.
 */
describe("AuthCallback — blocked account", () => {
  const start = window.location.href

  beforeEach(() => {
    nav.mockClear()
    createClient.mockClear()
  })

  afterEach(() => {
    window.history.replaceState({}, "", start)
  })

  it("goes straight to the login page with the blocked notice (query)", async () => {
    window.history.replaceState({}, "", "/auth/callback?error=access_denied&error_code=user_banned")
    render(
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?blocked=1", { replace: true }))
    expect(createClient).not.toHaveBeenCalled()
  })

  it("reads the fragment too (implicit flow)", async () => {
    window.history.replaceState({}, "", "/auth/callback#error=access_denied&error_code=user_banned")
    render(
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?blocked=1", { replace: true }))
  })

  it("leaves an ordinary return to the session exchange", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=abc")
    render(
      <MemoryRouter>
        <AuthCallback />
      </MemoryRouter>,
    )
    await waitFor(() => expect(createClient).toHaveBeenCalled())
    expect(nav).not.toHaveBeenCalledWith("/login?blocked=1", { replace: true })
  })
})
