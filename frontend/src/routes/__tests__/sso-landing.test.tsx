import { describe, it, expect, vi, beforeEach } from "vitest"
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

import SsoLandingPage from "../sso-landing"

beforeEach(() => {
  nav.mockClear()
  verifyOtp.mockReset()
  ;(window as unknown as { __NODARO_SSO__?: unknown }).__NODARO_SSO__ = undefined
})

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
