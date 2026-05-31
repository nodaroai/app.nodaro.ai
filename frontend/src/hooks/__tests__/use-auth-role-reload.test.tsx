import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import React from "react"

// Capture the onAuthStateChange callback so we can simulate a SIGNED_IN event
// that arrives WITHOUT a full page reload (the in-SPA sign-in / account-switch
// case). Regression guard for: the handler used to only reset role/tier on
// sign-OUT, leaving them stale on sign-IN (admin loses /admin, paid user runs
// at free-tier parallelism until a hard refresh).
type AuthCb = (event: string, session: { user: { id: string } | null } | null) => void
let authCallback: AuthCb | null = null
const mockGetUser = vi.fn()
const mockSingle = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      onAuthStateChange: (cb: AuthCb) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: mockSingle }) }),
    }),
  }),
}))

import { useAuth, getCachedTier } from "../use-auth"

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(MemoryRouter, null, children)

describe("useAuth — role/tier reload on in-SPA sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authCallback = null
    // Start logged out so the initial loadUser settles tier to "free".
    mockGetUser.mockResolvedValue({ data: { user: null } })
  })

  it("reloads tier from the profile when a SIGNED_IN event fires", async () => {
    renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(authCallback).not.toBeNull())

    // A user signs in via an in-SPA flow (no full reload). Their profile is pro.
    mockSingle.mockResolvedValue({ data: { role: "admin", tier: "pro" } })
    authCallback!("SIGNED_IN", { user: { id: "u1" } })

    await waitFor(() => expect(getCachedTier()).toBe("pro"))
  })
})
