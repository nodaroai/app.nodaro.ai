import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  linkExisting: false,
  profileByEmail: null as { id: string } | null,
  userById: null as { id: string; user_metadata: Record<string, unknown> } | null,
  created: null as Record<string, unknown> | null,
  updated: null as { id: string; attrs: Record<string, unknown> } | null,
}))

vi.mock("../sso-providers.js", async (orig) => ({
  ...(await orig<typeof import("../sso-providers.js")>()),
  ssoLinkExistingEnabled: () => state.linkExisting,
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
        createUser: vi.fn(async (attrs: Record<string, unknown>) => {
          state.created = attrs
          return { data: { user: { id: "new-user", ...attrs } }, error: null }
        }),
        updateUserById: vi.fn(async (id: string, attrs: Record<string, unknown>) => {
          state.updated = { id, attrs }
          return { data: { user: { id } }, error: null }
        }),
      },
    },
  },
}))

import { resolveSsoUser } from "../sso-linking.js"
import type { SsoProviderConfig } from "../sso-providers.js"
import type { VerifiedAssertion } from "../sso-assertion.js"

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

beforeEach(() => {
  state.linkExisting = false
  state.profileByEmail = null
  state.userById = null
  state.created = null
  state.updated = null
})

describe("resolveSsoUser", () => {
  it("provisions a new user when no account exists (email lower-cased, sso metadata stamped)", async () => {
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "provisioned" })
    expect(state.created).toMatchObject({
      email: "new@example.com",
      email_confirm: true,
      user_metadata: { sso: "librechat", sso_subject: "idp-7" },
      // SAI-5/H6: the app_metadata copy is the ONLY marker the auth gate trusts
      // (user_metadata is forgeable via public signUp). Dropping it silently
      // locks every new SSO user out of an SSO-only deployment — guard it.
      app_metadata: { sso: "librechat", sso_subject: "idp-7" },
    })
  })

  it("REJECTS provisioning when the assertion email is unverified (squat guard)", async () => {
    const r = await resolveSsoUser(provider, assertion({ emailVerified: false }))
    expect(r).toEqual({ ok: false, code: "email_unverified", message: expect.any(String) })
    expect(state.created).toBeNull()
  })

  it("links an existing account already carrying sso===provider", async () => {
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", user_metadata: { sso: "librechat" } }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked", userId: "u1" })
    expect(state.updated).toBeNull() // already linked — no re-stamp needed
  })

  it("REJECTS an existing UNLINKED account when EXTERNAL_SSO_LINK_EXISTING is false (takeover guard)", async () => {
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("links an existing unlinked account only when link-existing AND email_verified", async () => {
    state.linkExisting = true
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked", userId: "u1" })
    expect(state.updated).toMatchObject({
      id: "u1",
      attrs: {
        user_metadata: { sso: "librechat", sso_subject: "idp-7" },
        app_metadata: { sso: "librechat", sso_subject: "idp-7" },
      },
    })
  })

  it("REJECTS link-existing when the email is unverified even with the flag on", async () => {
    state.linkExisting = true
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion({ emailVerified: false }))
    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
  })

  // SECURITY (SEC-2): an account already federated to provider A must never be
  // silently re-stamped to provider B by a verified provider-B assertion for the
  // same email — even with EXTERNAL_SSO_LINK_EXISTING on. It is rejected with a
  // DISTINCT code (not the generic account_exists), regardless of the flag. The
  // link-existing flag only governs adopting UN-federated local accounts.
  it("REJECTS cross-provider re-stamp: account linked to a DIFFERENT provider (flag on AND off)", async () => {
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", user_metadata: { sso: "some-other-idp" } }

    state.linkExisting = true
    const r1 = await resolveSsoUser(provider, assertion())
    expect(r1).toEqual({ ok: false, code: "account_linked_other_provider", message: expect.any(String) })
    expect(state.updated).toBeNull() // never re-stamped

    state.linkExisting = false
    const r2 = await resolveSsoUser(provider, assertion())
    expect(r2).toEqual({ ok: false, code: "account_linked_other_provider", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })
})
