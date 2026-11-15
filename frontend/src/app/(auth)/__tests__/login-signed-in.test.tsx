import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * A visitor who is already signed in and opens the sign-in page (a "Start
 * free" or "Sign in" link on the site, a bookmark) goes on to where the link
 * was taking them. The page used to show its form to everyone, so a signed-in
 * visitor was asked to sign in again.
 *
 * It goes on only when both the app's own account state and the auth server
 * say so: a page that was just sent here because its session check failed, or
 * one whose session was ended elsewhere (another product, another device),
 * keeps the form, and its destination with it.
 */

const nav = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))
const leaveTo = vi.hoisted(() => vi.fn())
vi.mock("@/lib/leave-page", () => ({ leaveTo }))
const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  // The self-hosted page: its form needs no billing read, which is not this test's business.
  isCloud: () => false,
  hasCredits: () => edition.credits,
}))
const account = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
  stored: null as { access_token: string } | null,
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: account.user, loading: account.loading, signInWithGoogle: vi.fn(), signInWithEmail: vi.fn() }),
}))
vi.mock("@/lib/supabase", () => ({
  // What the auth server answers for the stored session: the user while it stands, none once it was ended.
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: account.stored ? { id: "u1" } : null } }) } }),
}))

import LoginPage from "../login/page"
import { registerAppRoutes } from "@/lib/sign-in-redirect"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

beforeEach(() => {
  nav.mockClear()
  leaveTo.mockClear()
  localStorage.clear()
  edition.credits = true
  account.user = { id: "u1" }
  account.loading = false
  account.stored = { access_token: "a" }
  registerAppRoutes([
    { path: "/login" },
    { path: "/pricing" },
    { path: "/oauth/authorize" },
    { children: [{ path: "/projects" }, { path: "/settings/api" }] },
    { path: "*" },
  ])
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ providers: [] }) }) as Response),
  )
})
afterEach(() => {
  registerAppRoutes(null)
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, "opener")
})

async function open(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  )
  // Let the stored-session read and the effects after it settle.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("login page — a visitor who is already signed in", () => {
  it("goes on to the projects when the link names no destination", async () => {
    await open("/login")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
  })

  it("goes on to the link's ?redirect=", async () => {
    await open("/login?redirect=%2Fsettings%2Fapi")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/settings/api", { replace: true }))
  })

  it("goes on to the link's ?return_to= (the connect screen)", async () => {
    await open("/login?return_to=%2Foauth%2Fauthorize%3Fclient_id%3Dabc")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/oauth/authorize?client_id=abc", { replace: true }))
  })

  it("loads another product's page on this site in full", async () => {
    await open("/login?redirect=%2Fvoice-changer%2Fconvert%2Fx")
    await waitFor(() => expect(leaveTo).toHaveBeenCalledWith("/voice-changer/convert/x"))
    expect(nav).not.toHaveBeenCalled()
  })

  it("never follows a destination on another site", async () => {
    await open("/login?redirect=%2F%2Fevil.example%2Fx")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("opens the plan a pricing link named", async () => {
    await open("/login?plan=pro")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/pricing?plan=pro", { replace: true }))
  })

  it("ignores a plan where nothing is sold", async () => {
    edition.credits = false
    await open("/login?plan=pro")
    await waitFor(() => expect(nav).toHaveBeenCalledWith("/projects", { replace: true }))
  })

  it("does not keep the destination for a later sign-in", async () => {
    await open("/login?redirect=%2Fsettings%2Fapi")
    await waitFor(() => expect(nav).toHaveBeenCalled())
    expect(localStorage.length).toBe(0)
  })
})

describe("login page — who keeps the form", () => {
  it("a signed-out visitor", async () => {
    account.user = null
    account.stored = null
    await open("/login?redirect=%2Fsettings%2Fapi")
    expect(nav).not.toHaveBeenCalled()
    expect(leaveTo).not.toHaveBeenCalled()
  })

  it("a visitor whose account is still being read", async () => {
    account.loading = true
    await open("/login")
    expect(nav).not.toHaveBeenCalled()
  })

  it("a page sent here because its session check failed (the stored session alone is not enough)", async () => {
    // The app's account state says signed out; going on would bounce between
    // the projects and this page for ever.
    account.user = null
    await open("/login?redirect=%2Fprojects")
    expect(nav).not.toHaveBeenCalled()
  })

  it("a visitor whose session was ended elsewhere (the account state alone is not enough)", async () => {
    // Read from the browser alone, a session ended on another device still
    // looks signed in for a while: only the auth server knows.
    account.stored = null
    await open("/login?redirect=%2Fsettings%2Fapi")
    expect(nav).not.toHaveBeenCalled()
    // The destination is still there for the sign-in that follows.
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBe("/settings/api")
  })

  it("a sign-in pop-up, which hands its session to the page that opened it", async () => {
    Object.defineProperty(window, "opener", { value: {}, configurable: true })
    await open("/login")
    expect(nav).not.toHaveBeenCalled()
  })

  it("the billing account's own sign-in lane", async () => {
    await open("/login?billing=1")
    expect(nav).not.toHaveBeenCalled()
  })
})
