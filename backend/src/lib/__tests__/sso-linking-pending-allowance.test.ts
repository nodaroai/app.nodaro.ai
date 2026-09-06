import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The one call migration 387 adds to the SSO path: an allowance bought for
 * somebody before they had an account is applied at their sign-in.
 *
 * Two properties, and they pull against each other, which is why they are
 * pinned here rather than assumed:
 *
 *   IT FIRES ON EVERY SUCCESSFUL SIGN-IN — the newly provisioned account AND
 *   the existing one being linked. An intent written between an account's
 *   creation and its owner's next sign-in would otherwise never apply, and an
 *   apply that failed once would strand a paid-for quota forever.
 *
 *   IT CAN NEVER DELAY OR FAIL ONE. It is not awaited and it swallows
 *   everything: a person must be able to log in while their quota is still
 *   being worked out, and a database blip on a best-effort call must not turn
 *   a working login into a 500.
 *
 * The apply is reached through a DYNAMIC import, because `lib/` may not import
 * from `ee/` (`tools/check-ee-imports.mjs`) — the same shim `lib/cancel-job
 * .ts` and `lib/deployment-payer.ts` use. `vi.mock` resolves to the same
 * module either way, so these tests exercise the real seam.
 */

const state = vi.hoisted(() => ({
  profileByEmail: null as { id: string } | null,
  userById: null as
    | { id: string; email?: string; user_metadata: Record<string, unknown>; app_metadata?: Record<string, unknown> }
    | null,
  payerId: null as string | null,
  linkExisting: false,
}))

const applyPendingAllowance = vi.fn(async () => 0)

vi.mock("../deployment-payer.js", () => ({
  deploymentPayerId: () => state.payerId,
}))

vi.mock("../sso-providers.js", async (orig) => ({
  ...(await orig<typeof import("../sso-providers.js")>()),
  ssoLinkExistingEnabled: () => state.linkExisting,
}))

vi.mock("../../ee/billing/deployment-allowance-service.js", () => ({
  applyPendingAllowance: (...a: unknown[]) => applyPendingAllowance(...(a as [])),
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: state.profileByEmail, error: null })),
        })),
      })),
    })),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: { user: state.userById && { ...state.userById, id } },
          error: null,
        })),
        createUser: vi.fn(async (attrs: Record<string, unknown>) => ({
          data: { user: { id: "new-user", ...attrs } },
          error: null,
        })),
        updateUserById: vi.fn(async (id: string) => ({ data: { user: { id } }, error: null })),
      },
    },
  },
}))

import { resolveSsoUser } from "../sso-linking.js"
import type { SsoProviderConfig } from "../sso-providers.js"
import type { VerifiedAssertion } from "../sso-assertion.js"

const PAYER = "00000000-0000-4000-8000-000000000001"

const provider: SsoProviderConfig = {
  id: "librechat",
  label: "LibreChat",
  kind: "assertion",
  secret: "x".repeat(32),
  audience: "nodaro",
  claimMap: { email: "email", emailVerified: "email_verified", subject: "sub" },
  maxLifetimeSeconds: 300,
}
const assertion = (over: Partial<VerifiedAssertion> = {}): VerifiedAssertion => ({
  email: "New@Example.com",
  emailVerified: true,
  subject: "idp-7",
  jti: "j",
  expSeconds: 120,
  ...over,
})

/** An account already federated to THIS provider — the cheap short-circuit,
 *  and the branch a returning user takes every single time. */
function alreadyLinked(id: string): void {
  state.profileByEmail = { id }
  state.userById = {
    id,
    email: "new@example.com",
    user_metadata: { sso: "librechat", sso_subject: "idp-7" },
    app_metadata: { sso: "librechat", sso_subject: "idp-7" },
  }
}

beforeEach(() => {
  state.profileByEmail = null
  state.userById = null
  state.payerId = PAYER
  state.linkExisting = false
  applyPendingAllowance.mockReset()
  applyPendingAllowance.mockResolvedValue(0)
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the pending allowance is applied at sign-in", () => {
  it("fires on the PROVISIONED branch, with the settled identity", async () => {
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "provisioned", userId: "new-user" })
    await vi.waitFor(() =>
      // The lower-cased address, not the assertion's casing: it is what the
      // account was created with and what the pending row is matched against.
      expect(applyPendingAllowance).toHaveBeenCalledWith("new-user", "idp-7", "new@example.com"),
    )
  })

  it("fires on the LINKED branch too — not only at provisioning", async () => {
    alreadyLinked("existing-user")
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked", userId: "existing-user" })
    await vi.waitFor(() =>
      expect(applyPendingAllowance).toHaveBeenCalledWith("existing-user", "idp-7", "new@example.com"),
    )
  })

  it("on the short-circuit it passes the ACCOUNT's trusted subject, not the assertion's", async () => {
    // The same-provider marker is checked; the SUBJECT is not (for a
    // non-payer). An intent bought for the identity this account actually
    // carries must reach it — and one bought for the subject the assertion
    // merely claims must not.
    state.profileByEmail = { id: "existing-user" }
    state.userById = {
      id: "existing-user",
      email: "new@example.com",
      user_metadata: { sso: "librechat", sso_subject: "idp-7" },
      app_metadata: { sso: "librechat", sso_subject: "the-account-real-subject" },
    }
    const r = await resolveSsoUser(provider, assertion({ subject: "idp-7" }))
    expect(r).toMatchObject({ ok: true, action: "linked" })
    await vi.waitFor(() =>
      expect(applyPendingAllowance).toHaveBeenCalledWith("existing-user", "the-account-real-subject", "new@example.com"),
    )
  })

  it("and passes null when the account carries no trusted subject — address matching only", async () => {
    state.profileByEmail = { id: "existing-user" }
    state.userById = {
      id: "existing-user",
      email: "new@example.com",
      user_metadata: { sso: "librechat", sso_subject: "idp-7" },
      app_metadata: { sso: "librechat" },
    }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked" })
    await vi.waitFor(() => expect(applyPendingAllowance).toHaveBeenCalledWith("existing-user", null, "new@example.com"))
  })

  it("fires when an existing LOCAL account is adopted under the link-existing flag", async () => {
    state.linkExisting = true
    state.profileByEmail = { id: "local-user" }
    state.userById = { id: "local-user", email: "new@example.com", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked", userId: "local-user" })
    await vi.waitFor(() => expect(applyPendingAllowance).toHaveBeenCalledWith("local-user", "idp-7", "new@example.com"))
  })

  it("does NOT fire on a refusal — there is no settled identity to apply to", async () => {
    // An unverified assertion for an address that already has an account: the
    // refusal branch. Applying a quota here would allocate the customer's plan
    // to a claim the platform just rejected.
    state.profileByEmail = { id: "existing-user" }
    state.userById = { id: "existing-user", email: "new@example.com", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion({ emailVerified: false }))
    expect(r).toMatchObject({ ok: false })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(applyPendingAllowance).not.toHaveBeenCalled()
  })

  it("does NOT fire on a deployment with no payer — mainline never loads the billing module", async () => {
    state.payerId = null
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "provisioned" })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(applyPendingAllowance).not.toHaveBeenCalled()
  })
})

describe("the sign-in never pays for the quota", () => {
  it("still succeeds when the apply REJECTS, and logs instead of throwing", async () => {
    applyPendingAllowance.mockRejectedValue(new Error("the ledger is on fire"))
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "provisioned" })
    // The `.catch` is attached synchronously, so the rejection is handled and
    // never surfaces as an unhandled rejection that fails the process.
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled())
  })

  it("does not WAIT for it: a hanging apply does not hang the sign-in", async () => {
    applyPendingAllowance.mockImplementation(() => new Promise<number>(() => {}))
    const r = await Promise.race([
      resolveSsoUser(provider, assertion()),
      new Promise((resolve) => setTimeout(() => resolve("timed out"), 250)),
    ])
    expect(r).toMatchObject({ ok: true, action: "provisioned" })
  })
})
