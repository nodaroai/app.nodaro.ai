import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The free signup grant is claimed at BOOT, not on the signup page: a Google
 * OAuth signup never renders /signup, so that page is not something every new
 * account passes through. The session is — which makes loadRoleAndTier, the
 * one code path every entry point shares, the place the decision anchors.
 *
 * The decision rides its OWN best-effort profile read, decoupled from the
 * boot-critical role/tier select: migrations reach the shared database only
 * on a push to main, so a dev deploy runs ahead of the column for the whole
 * staging soak — a widened shared select would 400 and collapse every
 * staging user to user/free. And it is a fire-and-forget dynamic import: a
 * static `@/ee/` import from core fails the check-ee-imports guard, and an
 * awaited call would put a fingerprint (canvas, WebGL probes) on the
 * critical path of first paint.
 */

const h = vi.hoisted(() => ({
  hasCredits: vi.fn(() => true),
  ensureSignupGrant: vi.fn(async () => {}),
  hydrateWorkspaces: vi.fn(async () => {}),
  resetWorkspaceState: vi.fn(),
  user: null as { id: string } | null,
  freeGrantState: "unclaimed" as string | null,
  /** Simulates a deploy running ahead of migration 365 (staging's soak). */
  grantColumnMissing: false,
  selects: [] as string[],
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
      select: (cols: string) => {
        h.selects.push(cols)
        return {
          eq: () => ({
            single: async () => {
              if (cols.includes("free_grant_state")) {
                // PostgREST answers an unknown column with 42703 for the
                // WHOLE request — exactly what a pre-migration deploy sees.
                if (h.grantColumnMissing) {
                  return {
                    data: null,
                    error: { code: "42703", message: "column profiles.free_grant_state does not exist" },
                  }
                }
                return { data: { free_grant_state: h.freeGrantState }, error: null }
              }
              return {
                data: { role: "user", tier: "free", subscription_tier: null, lifetime_topup_credits: 0 },
                error: null,
              }
            },
          }),
        }
      },
    })),
  }),
}))

import { refreshAuth } from "@/hooks/use-auth"

/** The claim is deliberately not awaited, so give the microtask queue a turn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  h.user = { id: "u-1" }
  h.freeGrantState = "unclaimed"
  h.grantColumnMissing = false
  h.selects.length = 0
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

  it("keeps free_grant_state OUT of the boot-critical role/tier select", async () => {
    // A deploy running ahead of migration 365 (staging's whole dev→main
    // soak) 400s any select naming the missing column. Widened into the
    // shared read, that would collapse every staging user to user/free —
    // the grant check must ride its own query.
    await refreshAuth()
    await settle()
    const roleSelect = h.selects.find((s) => s.includes("role"))
    expect(roleSelect).toBeDefined()
    expect(roleSelect).not.toContain("free_grant_state")
  })

  it("stays dormant where the migration has not landed, without failing sign-in", async () => {
    h.grantColumnMissing = true
    await expect(refreshAuth()).resolves.toBeUndefined()
    await settle()
    expect(h.ensureSignupGrant).not.toHaveBeenCalled()
  })
})
