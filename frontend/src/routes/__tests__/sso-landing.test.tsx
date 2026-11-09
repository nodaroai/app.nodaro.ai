import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const nav = vi.fn()
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))

const verifyOtp = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { verifyOtp } }),
}))
const leaveTo = vi.hoisted(() => vi.fn())
vi.mock("@/lib/leave-page", () => ({ leaveTo }))

import SsoLandingPage from "../sso-landing"
import { registerAppRoutes } from "@/lib/sign-in-redirect"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

beforeEach(() => {
  nav.mockClear()
  leaveTo.mockClear()
  verifyOtp.mockReset()
  localStorage.clear()
  ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = undefined
  // The router's shape: the app's own pages, then the not-found catch-all.
  registerAppRoutes([
    { path: "/sso" },
    { path: "/login" },
    { children: [{ path: "/projects" }, { path: "/library" }] },
    { path: "*" },
  ])
})
afterEach(() => registerAppRoutes(null))

function stash(next: string) {
  ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = { token: "HASH", next }
}

function land() {
  render(
    <MemoryRouter>
      <SsoLandingPage />
    </MemoryRouter>,
  )
}

describe("SsoLandingPage", () => {
  it("exchanges the stashed token (type 'email') and navigates to next on success", async () => {
    ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = { token: "HASH", next: "/library" }
    verifyOtp.mockResolvedValue({ error: null })
    render(
      <MemoryRouter>
        <SsoLandingPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "HASH", type: "email" }))
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/library", { replace: true }))
  })

  it("navigates to /login on a verify error", async () => {
    ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = { token: "HASH", next: "/library" }
    verifyOtp.mockResolvedValue({ error: { message: "bad token" } })
    render(
      <MemoryRouter>
        <SsoLandingPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login", { replace: true }))
  })

  it("navigates to /login when no token was stashed", async () => {
    render(
      <MemoryRouter>
        <SsoLandingPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login", { replace: true }))
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it("forces next to /projects when the stashed next is not a same-origin relative path", async () => {
    ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = { token: "HASH", next: "//evil.com" }
    verifyOtp.mockResolvedValue({ error: null })
    render(
      <MemoryRouter>
        <SsoLandingPage />
      </MemoryRouter>,
    )
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
  })
})

/**
 * The SSO hop forwards nothing but the provider's own `next`, so a sign-in
 * begun on the login page goes on to the destination the page kept (its
 * `?redirect=`) whenever the provider named no other page; and a page of
 * another product on the same host gets a full page load.
 */
describe("SsoLandingPage — where the sign-in goes", () => {
  it("goes on to the login page's kept destination when the provider named none", async () => {
    localStorage.setItem(AUTH_REDIRECT_KEY, "/voice-changer/convert/abc")
    stash("/projects") // what an absent next arrives as
    verifyOtp.mockResolvedValue({ error: null })
    land()
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/voice-changer/convert/abc"))
    expect(nav).not.toHaveBeenCalled()
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBeNull()
  })

  it("loads a tools world in full: the kept /image", async () => {
    localStorage.setItem(AUTH_REDIRECT_KEY, "/image")
    stash("/projects")
    verifyOtp.mockResolvedValue({ error: null })
    land()
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/image"))
  })

  it("loads a page the provider named in full when it is another product's (/video/…)", async () => {
    stash("/video/abc")
    verifyOtp.mockResolvedValue({ error: null })
    land()
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/video/abc"))
    expect(nav).not.toHaveBeenCalled()
  })

  it("the provider's own page wins over a kept one, which is still consumed", async () => {
    localStorage.setItem(AUTH_REDIRECT_KEY, "/image")
    stash("/library")
    verifyOtp.mockResolvedValue({ error: null })
    land()
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/library", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBeNull()
  })

  it("never leaves the site, whichever value names another one", async () => {
    stash("/\\evil.com")
    verifyOtp.mockResolvedValue({ error: null })
    land()
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))

    localStorage.setItem(AUTH_REDIRECT_KEY, "/.//evil.com")
    stash("/projects")
    land()
    await waitFor(() => expect(nav).toHaveBeenCalledTimes(2))
    expect(nav).toHaveBeenLastCalledWith("/projects", { replace: true })
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("a failed exchange goes back to sign in and keeps the destination for the retry", async () => {
    localStorage.setItem(AUTH_REDIRECT_KEY, "/voice-changer")
    stash("/projects")
    verifyOtp.mockResolvedValue({ error: { message: "bad token" } })
    land()
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/login", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBe("/voice-changer")
  })
})
