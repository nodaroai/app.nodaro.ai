import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The free signup grant is claimed at BOOT, not on the signup page: a Google
 * OAuth signup never renders /signup, so that page is not something every new
 * account passes through. The session is — which makes loadRoleAndTier, the
 * one profile read every entry point shares, the only place the decision can
 * be made exactly once per account.
 *
 * It is a fire-and-forget dynamic import for two reasons that are both load
 * bearing: a static `@/ee/` import from core fails the check-ee-imports guard,
 * and an awaited call would put a fingerprint (canvas, WebGL, audio probes) on
 * the critical path of first paint.
 */

const h = vi.hoisted(() => ({
  hasCredits: vi.fn(() => true),
  ensureSignupGrant: vi.fn(async () => {}),
  hydrateWorkspaces: vi.fn(async () => {}),
  resetWorkspaceState: vi.fn(),
  user: null as { id: string } | null,
  freeGrantState: "unclaimed" as string | null,
}))

vi.mock("@/lib/edition", () => ({ hasCredits: h.hasCredits }))
vi.mock("@/ee/lib/ensure-signup-grant", () => ({ ensureSignupGrant: h.ensureSignupGrant }))
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
            data: {
              role: "user",
              tier: "free",
              subscription_tier: null,
              lifetime_topup_credits: 0,
              free_grant_state: h.freeGrantState,
            },
            error: null,
          }),
        }),
      }),
    })),
  }),
}))

import { refreshAuth } from "@/hooks/use-auth"

/** The claim is deliberately not awaited, so give the microtask queue a turn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  h.user = { id: "u-1" }
  h.freeGrantState = "unclaimed"
  h.hasCredits.mockReturnValue(true)
})

afterEach(() => vi.clearAllMocks())

describe("claiming the signup grant", () => {
  it("fires for a signed-in cloud user whose grant is unclaimed", async () => {
    await refreshAuth()
    await settle()
    expect(h.ensureSignupGrant).toHaveBeenCalledTimes(1)
  })

  it("does not fire once the grant has been given", async () => {
    h.freeGrantState = "granted"
    await refreshAuth()
    await settle()
    expect(h.ensureSignupGrant).not.toHaveBeenCalled()
  })

  it("does not fire for an account the grant was withheld from", async () => {
    h.freeGrantState = "withheld"
    await refreshAuth()
    await settle()
    expect(h.ensureSignupGrant).not.toHaveBeenCalled()
  })

  it("does not fire without a session", async () => {
    h.user = null
    await refreshAuth()
    await settle()
    expect(h.ensureSignupGrant).not.toHaveBeenCalled()
  })

  it("does not fire on an edition that has no credits", async () => {
    h.hasCredits.mockReturnValue(false)
    await refreshAuth()
    await settle()
    expect(h.ensureSignupGrant).not.toHaveBeenCalled()
  })

  it("never fails the sign-in over it", async () => {
    h.ensureSignupGrant.mockRejectedValueOnce(new Error("claim endpoint is down"))
    await expect(refreshAuth()).resolves.toBeUndefined()
    await settle()
  })
})
