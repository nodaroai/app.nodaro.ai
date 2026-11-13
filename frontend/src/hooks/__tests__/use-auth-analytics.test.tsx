import { describe, it, expect, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import React from "react"

/**
 * Who is signed in reaches the site analytics from the one place every session
 * change passes (loadRoleAndTier): the internal id, the plan, and staff for an
 * admin role — and only from a profile actually read, so a failed read never
 * unmarks a staff browser.
 */

type AuthCb = (event: string, session: { user: { id: string } | null } | null) => void
let authCallback: AuthCb | null = null
const mockGetUser = vi.fn()
const mockSingle = vi.fn()
const { syncAnalyticsIdentity } = vi.hoisted(() => ({ syncAnalyticsIdentity: vi.fn() }))

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
vi.mock("@/lib/analytics/site-analytics", () => ({ syncAnalyticsIdentity }))

import { useAuth } from "../use-auth"

const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(MemoryRouter, null, children)

describe("useAuth → site analytics identity", () => {
  it("tells the analytics who is signed in, as each session change arrives", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(authCallback).not.toBeNull())
    await waitFor(() => expect(syncAnalyticsIdentity).toHaveBeenCalledWith(null))

    mockSingle.mockResolvedValueOnce({ data: { role: "admin", tier: "pro" } })
    authCallback!("SIGNED_IN", { user: { id: "staff-1" } })
    await waitFor(() => expect(syncAnalyticsIdentity).toHaveBeenLastCalledWith({ userId: "staff-1", staff: true, plan: "pro" }))

    mockSingle.mockResolvedValueOnce({ data: { role: "user", tier: "free" } })
    authCallback!("SIGNED_IN", { user: { id: "user-1" } })
    await waitFor(() => expect(syncAnalyticsIdentity).toHaveBeenLastCalledWith({ userId: "user-1", staff: false, plan: "free" }))

    // A profile that could not be read says nothing about who this is.
    const callsBefore = syncAnalyticsIdentity.mock.calls.length
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "network" } })
    authCallback!("TOKEN_REFRESHED", { user: { id: "user-1" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(syncAnalyticsIdentity.mock.calls.length).toBe(callsBefore)

    authCallback!("SIGNED_OUT", null)
    await waitFor(() => expect(syncAnalyticsIdentity).toHaveBeenLastCalledWith(null))
  })
})
