import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"

/**
 * The email and password sign-in goes on to the login page's `?redirect=`:
 * one of the app's own pages in place, as before, and a page of another
 * product served from the same host (the voice changer, the tools' worlds) by
 * a full page load — it used to open the app's not-found page instead. A
 * destination that names another site is never followed.
 */

const nav = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))
const leaveTo = vi.hoisted(() => vi.fn())
vi.mock("@/lib/leave-page", () => ({ leaveTo }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  isCloud: () => false,
  hasCredits: () => false,
  hasAdmin: () => false,
}))
const signInWithEmail = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ signInWithGoogle: vi.fn(), signInWithEmail }),
}))
vi.mock("@/lib/surface-selectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/surface-selectors")>()),
  surfaceAuthMethods: (d: string[]) => d,
  surfaceAuthSsoLabel: () => undefined,
}))

import LoginPage from "../login/page"
import { registerAppRoutes } from "@/lib/sign-in-redirect"

beforeEach(() => {
  nav.mockClear()
  leaveTo.mockClear()
  signInWithEmail.mockReset()
  signInWithEmail.mockResolvedValue(undefined)
  localStorage.clear()
  // The router's shape: the app's own pages, then the not-found catch-all.
  registerAppRoutes([
    { path: "/login" },
    { path: "/oauth/authorize" },
    { children: [{ path: "/projects" }, { path: "/settings/api" }, { path: "/library" }] },
    { path: "*" },
  ])
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/sso/providers")) return { ok: true, json: async () => ({ providers: [] }) } as Response
      if (url.includes("/v1/setup/status")) return { ok: true, json: async () => ({ hasUsers: true }) } as Response
      return { ok: false, json: async () => ({}) } as Response
    }),
  )
})
afterEach(() => {
  registerAppRoutes(null)
  vi.unstubAllGlobals()
})

async function signInAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  )
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/email/i), "person@x.test")
  await user.type(screen.getByPlaceholderText(/password/i), "secret-pass")
  await user.click(screen.getByRole("button", { name: /^sign in$/i }))
  await waitFor(() => expect(signInWithEmail).toHaveBeenCalled())
}

describe("login page — where an email sign-in goes", () => {
  it("loads the voice changer in full when it sent the visitor here", async () => {
    await signInAt(`/login?redirect=${encodeURIComponent("/voice-changer/convert/abc?step=2")}`)
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/voice-changer/convert/abc?step=2"))
    expect(nav).not.toHaveBeenCalled()
  })

  it("loads a tools world in full: /image", async () => {
    await signInAt(`/login?redirect=${encodeURIComponent("/image")}`)
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/image"))
    expect(nav).not.toHaveBeenCalled()
  })

  it("loads a tools world in full: /video/…", async () => {
    await signInAt(`/login?redirect=${encodeURIComponent("/video/abc")}`)
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/video/abc"))
    expect(nav).not.toHaveBeenCalled()
  })

  it("opens one of the app's own pages in place, as before", async () => {
    await signInAt(`/login?redirect=${encodeURIComponent("/settings/api")}`)
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/settings/api", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("follows ?return_to= the same way (the OAuth consent page sends it)", async () => {
    await signInAt(`/login?return_to=${encodeURIComponent("/oauth/authorize?client_id=c1")}`)
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/oauth/authorize?client_id=c1", { replace: true }))
  })

  it("never leaves the site for a destination that names another one", async () => {
    await signInAt(`/login?redirect=${encodeURIComponent("/\\evil.com")}`)
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("with no destination, opens the dashboard", async () => {
    await signInAt("/login")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
  })
})
