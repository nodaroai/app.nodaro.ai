import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"

/**
 * A sign-in that did not complete (a cancel at the provider, an expired or
 * replayed sign-in, no session after the return) comes back to the sign-in
 * page with `?failed=1`, and the page says so. It used to come back to the
 * bare form, which read as if nothing had happened.
 */

const nav = vi.hoisted(() => vi.fn())
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => nav,
}))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  // The self-hosted page: its form needs no billing read, which is not this test's business.
  isCloud: () => false,
  hasCredits: () => true,
}))
const account = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
  stored: null as { access_token: string } | null,
}))
const signInWithEmail = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: account.user, loading: account.loading, signInWithGoogle: vi.fn(), signInWithEmail }),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: account.stored ? { id: "u1" } : null } }) } }),
}))

import LoginPage from "../login/page"
import { AUTH_REDIRECT_KEY } from "@/lib/storage-keys"

const INCOMPLETE = "Sign-in didn't complete. Please try again."

beforeEach(() => {
  nav.mockClear()
  signInWithEmail.mockReset()
  localStorage.clear()
  account.user = null
  account.loading = false
  account.stored = null
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ providers: [] }) }) as Response),
  )
})
afterEach(() => vi.unstubAllGlobals())

async function open(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LoginPage />
    </MemoryRouter>,
  )
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("login page — after a sign-in that did not complete", () => {
  it("says the sign-in did not complete", async () => {
    await open("/login?failed=1")
    expect(screen.getByText(INCOMPLETE)).toBeInTheDocument()
  })

  it("keeps the destination for the next try", async () => {
    await open("/login?failed=1&redirect=%2Fsettings%2Fapi")
    expect(screen.getByText(INCOMPLETE)).toBeInTheDocument()
    expect(localStorage.getItem(AUTH_REDIRECT_KEY)).toBe("/settings/api")
  })

  it("says nothing on an ordinary visit", async () => {
    await open("/login")
    expect(screen.queryByText(INCOMPLETE)).toBeNull()
  })

  it("says nothing while the account is still being read", async () => {
    // A signed-in visitor (a replayed sign-in from the browser's Back button)
    // is about to go on; they are never shown a failure.
    account.loading = true
    await open("/login?failed=1")
    expect(screen.queryByText(INCOMPLETE)).toBeNull()
  })

  it("steps aside while the next try is under way", async () => {
    signInWithEmail.mockReturnValue(new Promise(() => {}))
    await open("/login?failed=1")
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/email/i), "person@x.test")
    await user.type(screen.getByPlaceholderText(/password/i), "secret-pass")
    await user.click(screen.getByRole("button", { name: /^sign in$/i }))
    expect(screen.queryByText(INCOMPLETE)).toBeNull()
  })

  it("says nothing to a visitor who is signed in after all", async () => {
    account.user = { id: "u1" }
    account.stored = { access_token: "a" }
    await open("/login?failed=1")
    expect(screen.queryByText(INCOMPLETE)).toBeNull()
  })
})
