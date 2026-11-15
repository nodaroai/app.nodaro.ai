import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * A provider return that carries no session: the provider's own error (the
 * person cancelled, the sign-in expired or was replayed), or a code that never
 * becomes a session. Either way the person goes back to the sign-in page, is
 * told the sign-in did not complete, and keeps the destination for the next
 * try. An error used to be ignored (five seconds of spinner), and both ended
 * on a bare form with the destination gone.
 */

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
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

const start = window.location.href

beforeEach(() => {
  nav.mockClear()
  createClient.mockClear()
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState({}, "", start)
})

function returnAt(address: string) {
  window.history.replaceState({}, "", address)
  return render(
    <MemoryRouter>
      <AuthCallback />
    </MemoryRouter>,
  )
}

describe("AuthCallback — the provider returned an error", () => {
  it("goes straight back to the sign-in page, which says so (a cancel at the provider)", async () => {
    returnAt("/auth/callback?error=access_denied&error_description=")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?failed=1", { replace: true }))
    expect(createClient).not.toHaveBeenCalled()
  })

  it("reads the fragment too", async () => {
    returnAt("/auth/callback#error=server_error&error_description=Database+error+saving+new+user")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?failed=1", { replace: true }))
  })

  it("reads an error that names only its code", async () => {
    returnAt("/auth/callback?error_code=bad_oauth_state")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?failed=1", { replace: true }))
  })

  it("keeps the destination for the next try", async () => {
    localStorage.setItem(AUTH_REDIRECT_KEY, "/settings/api")
    returnAt("/auth/callback?error=access_denied")
    await waitFor(() =>
      expect(nav).toHaveBeenCalledWith("/login?failed=1&redirect=%2Fsettings%2Fapi", { replace: true }),
    )
  })

  it("reads an error that carries only its description", async () => {
    returnAt("/auth/callback?error_description=Unable+to+exchange+external+code")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?failed=1", { replace: true }))
  })

  it("still sends a blocked account to its own notice", async () => {
    returnAt("/auth/callback?error=access_denied&error_code=user_banned")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login?blocked=1", { replace: true }))
    expect(nav).not.toHaveBeenCalledWith("/login?failed=1", { replace: true })
  })
})

describe("AuthCallback — in a sign-in pop-up", () => {
  const close = vi.fn()
  const originalClose = window.close

  beforeEach(() => {
    close.mockClear()
    window.close = close
    Object.defineProperty(window, "opener", { value: { postMessage: vi.fn() }, configurable: true })
  })
  afterEach(() => {
    window.close = originalClose
    Reflect.deleteProperty(window, "opener")
  })

  it("an error return behaves as it always has: the pop-up closes after the wait, and goes nowhere", async () => {
    // The page that opened it is waiting for this window to close; a sign-in
    // page left open inside the pop-up would strand it.
    vi.useFakeTimers()
    returnAt("/auth/callback?error=access_denied")
    await vi.advanceTimersByTimeAsync(5_100)
    expect(nav).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})

describe("AuthCallback — a code that never becomes a session", () => {
  it("gives up after five seconds, says so, and keeps the destination", async () => {
    vi.useFakeTimers()
    localStorage.setItem(AUTH_REDIRECT_KEY, "/settings/api")
    returnAt("/auth/callback?code=abc")
    await vi.advanceTimersByTimeAsync(4_900)
    expect(nav).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(nav).toHaveBeenCalledWith("/login?failed=1&redirect=%2Fsettings%2Fapi", { replace: true })
  })

  it("gives up to the bare notice when the sign-in named no destination", async () => {
    vi.useFakeTimers()
    returnAt("/auth/callback?code=abc")
    await vi.advanceTimersByTimeAsync(5_100)
    expect(nav).toHaveBeenCalledWith("/login?failed=1", { replace: true })
  })
})
