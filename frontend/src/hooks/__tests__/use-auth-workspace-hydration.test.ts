import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The workspace selection is loaded from the SESSION, not from a page.
 *
 * Every request this client builds carries the selected workspace, so a page
 * that renders before the selection resolves would send none — and a deep
 * link straight into the editor renders no organization page at all. Anchor
 * it to the one thing every entry point has in common and the header cannot
 * be missing because of where someone landed.
 *
 * The sign-OUT half matters as much: a browser that keeps a selection after
 * sign-out hands the next person to use it a school they have never been in.
 */

const h = vi.hoisted(() => ({
  hydrateWorkspaces: vi.fn(async () => {}),
  resetWorkspaceState: vi.fn(),
  user: null as { id: string } | null,
}))

vi.mock("@/lib/workspace-context", () => ({
  hydrateWorkspaces: h.hydrateWorkspaces,
  resetWorkspaceState: h.resetWorkspaceState,
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: h.user } })),
      getSession: vi.fn(async () => ({ data: { session: h.user ? { user: h.user } : null } })),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { role: "user", tier: "pro", subscription_tier: null, lifetime_topup_credits: 0 },
            error: null,
          }),
        }),
      }),
    })),
  }),
}))

import { refreshAuth } from "@/hooks/use-auth"

beforeEach(() => {
  h.user = null
})
afterEach(() => vi.clearAllMocks())

describe("the session drives the workspace selection", () => {
  it("loads it when a session resolves", async () => {
    h.user = { id: "u-1" }
    await refreshAuth()
    expect(h.hydrateWorkspaces).toHaveBeenCalled()
    expect(h.resetWorkspaceState).not.toHaveBeenCalled()
  })

  it("forgets it when there is no session", async () => {
    h.user = null
    await refreshAuth()
    expect(h.resetWorkspaceState).toHaveBeenCalled()
    expect(h.hydrateWorkspaces).not.toHaveBeenCalled()
  })

  it("never fails the sign-in over it", async () => {
    h.user = { id: "u-1" }
    h.hydrateWorkspaces.mockRejectedValueOnce(new Error("me is down"))
    await expect(refreshAuth()).resolves.toBeUndefined()
  })
})
