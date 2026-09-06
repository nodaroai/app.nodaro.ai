import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const state = vi.hoisted(() => ({
  linkExisting: false,
  profileByEmail: null as { id: string } | null,
  /** What the `profiles` lookup errors with — `maybeSingle()` reports a
   *  MULTI-ROW match this way, and `profiles.email` is not unique. */
  profileError: null as { message: string } | null,
  /** The auth record `getUserById` answers. `email` is now load-bearing:
   *  `resolveSsoUser` cross-checks it against the assertion, so a profile row
   *  can never speak for an auth identity that does not carry the address. */
  userById: null as
    | { id: string; email?: string; user_metadata: Record<string, unknown>; app_metadata?: Record<string, unknown> }
    | null,
  created: null as Record<string, unknown> | null,
  updated: null as { id: string; attrs: Record<string, unknown> } | null,
  /** What `deploymentPayerId()` answers — null on mainline (no payer). */
  payerId: null as string | null,
}))

// The ONE thing this module needs from the payer seam: which uuid holds the
// deployment's money. Mocked (not imported for real) so the SSO tests stay
// clear of `surface-profile.js` / `config.js`.
vi.mock("../deployment-payer.js", () => ({
  deploymentPayerId: () => state.payerId,
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
          maybeSingle: vi.fn(async () => ({
            data: state.profileError ? null : state.profileByEmail,
            error: state.profileError,
          })),
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
  state.profileError = null
  state.userById = null
  state.created = null
  state.updated = null
  state.payerId = null
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
    state.userById = { id: "u1", email: "new@example.com", user_metadata: { sso: "librechat" } }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked", userId: "u1" })
    expect(state.updated).toBeNull() // already linked — no re-stamp needed
  })

  it("REJECTS an existing UNLINKED account when EXTERNAL_SSO_LINK_EXISTING is false (takeover guard)", async () => {
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", email: "new@example.com", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("links an existing unlinked account only when link-existing AND email_verified", async () => {
    state.linkExisting = true
    state.profileByEmail = { id: "u1" }
    state.userById = { id: "u1", email: "new@example.com", user_metadata: {} }
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
    state.userById = { id: "u1", email: "new@example.com", user_metadata: {} }
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
    state.userById = { id: "u1", email: "new@example.com", user_metadata: { sso: "some-other-idp" } }

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

/**
 * D15.2 (2026-09-05) — the deployment's BILLING ACCOUNT is an identity of the
 * customer's own provider, and links on its first VERIFIED sign-in whatever
 * EXTERNAL_SSO_LINK_EXISTING says.
 *
 * The superseded rule (D15.1) refused a federated payer outright, to keep the
 * customer's IdP away from the account holding the credits. That guard was
 * protecting the DEPLOYMENT's own pool from the DEPLOYMENT's own provider — its
 * money, its call. The platform's money is guarded elsewhere and unchanged:
 * `requirePlatformOperator` still refuses a federated account on every grant
 * route.
 *
 * What must NOT move: an unverified claim never takes the money account, a
 * payer already federated to a DIFFERENT provider is still refused, and every
 * NON-payer local account keeps the flag-gated rule exactly as it was.
 */
describe("resolveSsoUser — the deployment payer (D15.2)", () => {
  const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

  it("LINKS the payer on a verified assertion with EXTERNAL_SSO_LINK_EXISTING OFF, stamping both metadata copies", async () => {
    state.linkExisting = false // the flag is irrelevant for this one account
    state.payerId = PAYER
    state.profileByEmail = { id: PAYER }
    state.userById = { id: PAYER, email: "new@example.com", user_metadata: {} }

    const r = await resolveSsoUser(provider, assertion())

    expect(r).toMatchObject({ ok: true, action: "linked", userId: PAYER })
    expect(state.updated).toMatchObject({
      id: PAYER,
      attrs: {
        user_metadata: { sso: "librechat", sso_subject: "idp-7" },
        // app_metadata is the copy the H6 gate trusts — once stamped, the
        // billing account passes that gate like any other SSO user.
        app_metadata: { sso: "librechat", sso_subject: "idp-7" },
      },
    })
  })

  it("REJECTS an UNVERIFIED assertion for the payer with email_unverified (never account_exists)", async () => {
    state.linkExisting = true // even with the flag on
    state.payerId = PAYER
    state.profileByEmail = { id: PAYER }
    state.userById = { id: PAYER, email: "new@example.com", user_metadata: {} }

    const r = await resolveSsoUser(provider, assertion({ emailVerified: false }))

    expect(r).toEqual({ ok: false, code: "email_unverified", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("REJECTS the payer when it is already linked to a DIFFERENT provider (the cross-IdP rule wins)", async () => {
    state.payerId = PAYER
    state.profileByEmail = { id: PAYER }
    state.userById = { id: PAYER, email: "new@example.com", user_metadata: { sso: "some-other-idp" } }

    const r = await resolveSsoUser(provider, assertion())

    expect(r).toEqual({ ok: false, code: "account_linked_other_provider", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("leaves every NON-payer local account on today's rule: account_exists with the flag off", async () => {
    // A payer IS configured — this is the discriminating case: the exemption is
    // exactly one uuid wide, not "any account on a payer instance".
    state.linkExisting = false
    state.payerId = PAYER
    state.profileByEmail = { id: "someone-else" }
    state.userById = { id: "someone-else", email: "new@example.com", user_metadata: {} }

    const r = await resolveSsoUser(provider, assertion())

    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })
})

/**
 * D15.2, THE SECOND ASSERTION ONWARDS. The rules above are only worth what they
 * are worth on EVERY pass. The same-provider short-circuit answers `linked` on
 * the marker alone, and `routes/sso.ts:117` then mints the session BY EMAIL —
 * so without the re-checks below "an unverified claim never takes the money
 * account" would hold exactly once, for the assertion that links it, and any
 * later principal of the same IdP able to put the billing address in an
 * unverified `email` claim would get a payer session: `/billing-admin`, the
 * allowance levers, the card on file.
 *
 * The re-check is the PAYER's alone, deliberately: widening it to every account
 * would lock out every user whose IdP stops asserting `email_verified` on
 * repeat logins, which is a separate decision with a separate blast radius.
 */
describe("resolveSsoUser — the payer re-checks on EVERY assertion, not only the linking one", () => {
  const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  const linkedPayer = (over: Record<string, unknown> = {}) => {
    state.payerId = PAYER
    state.profileByEmail = { id: PAYER }
    state.userById = {
      id: PAYER,
      email: "new@example.com",
      user_metadata: { sso: "librechat", sso_subject: "idp-7" },
      // The TRUSTED copy — service-role-only. `user_metadata` is rewritable by
      // the account owner, so the subject compare must not read it.
      app_metadata: { sso: "librechat", sso_subject: "idp-7" },
      ...over,
    }
  }

  it("an already-linked payer with a matching subject and a verified email still signs in (no re-stamp)", async () => {
    linkedPayer()
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toMatchObject({ ok: true, action: "linked", userId: PAYER })
    expect(state.updated).toBeNull()
  })

  it("REJECTS an UNVERIFIED assertion for an ALREADY-LINKED payer (the one-shot bug)", async () => {
    linkedPayer()
    const r = await resolveSsoUser(provider, assertion({ emailVerified: false }))
    expect(r).toEqual({ ok: false, code: "email_unverified", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("REJECTS a DIFFERENT subject at the same provider — a second IdP principal claiming the billing address", async () => {
    linkedPayer()
    const r = await resolveSsoUser(provider, assertion({ subject: "idp-99" }))
    expect(r).toEqual({ ok: false, code: "account_linked_other_subject", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("FAILS CLOSED when the trusted subject copy is absent — the break-glass password is the recovery door", async () => {
    linkedPayer({ app_metadata: { sso: "librechat" } })
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toEqual({ ok: false, code: "account_linked_other_subject", message: expect.any(String) })
  })

  it("does NOT read the forgeable copy: user_metadata.sso_subject alone does not satisfy the compare", async () => {
    linkedPayer({ app_metadata: { sso: "librechat", sso_subject: "idp-OTHER" } })
    const r = await resolveSsoUser(provider, assertion({ subject: "idp-7" }))
    expect(r).toEqual({ ok: false, code: "account_linked_other_subject", message: expect.any(String) })
  })

  it("leaves a NON-payer already-linked account on the cheap short-circuit (unverified still signs in)", async () => {
    // The discriminating half of the scoping decision: same shape, different
    // uuid, opposite answer.
    state.payerId = PAYER
    state.profileByEmail = { id: "someone-else" }
    state.userById = { id: "someone-else", email: "new@example.com", user_metadata: { sso: "librechat" } }
    const r = await resolveSsoUser(provider, assertion({ emailVerified: false, subject: "idp-99" }))
    expect(r).toMatchObject({ ok: true, action: "linked", userId: "someone-else" })
  })
})

/**
 * The account the assertion resolves to must be the account that CARRIES the
 * address. `profiles.email` is a hint, not an identity: the column is not
 * unique (`099_admin_usage_users_indexes.sql:52`), the "own safe columns"
 * UPDATE policy does not deny it (`365_…:264-278` is a denylist without
 * `email`), and nothing re-syncs it when an auth email changes
 * (`001_initial_schema.sql:399` only INSERTs). So an ordinary user can write
 * the billing address into their own row — and if the payer's own row is stale,
 * theirs is the SOLE match, after which `routes/sso.ts` mints the session by
 * email and hands over the payer's session.
 */
describe("resolveSsoUser — a profiles row never speaks for an auth identity it does not own", () => {
  it("REFUSES when the resolved account's auth email is not the asserted address", async () => {
    state.linkExisting = true
    state.profileByEmail = { id: "squatter" }
    state.userById = { id: "squatter", email: "someone.else@example.com", user_metadata: {} }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.updated).toBeNull()
    expect(state.created).toBeNull()
  })

  it("REFUSES on a multi-row lookup instead of falling through to provisioning a second account", async () => {
    state.profileError = { message: "JSON object requested, multiple (or no) rows returned" }
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.created).toBeNull()
  })

  it("REFUSES when the auth record behind the row cannot be read (fail closed)", async () => {
    state.profileByEmail = { id: "u1" }
    state.userById = null // getUserById answers no user
    const r = await resolveSsoUser(provider, assertion())
    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.created).toBeNull()
  })
})

/**
 * The half of the retired `payerSsoLinkConflict` boot refusal that was worth
 * keeping. Its stated hazard was never the payer — it was that the customer's
 * IdP could assert a LOCAL ADMIN's email and assume that account, "including
 * the one the platform-operator allowlist names". Federating an operator
 * address does not hand the IdP the money routes (a linked account IS federated
 * from the same write, and `requirePlatformOperator` refuses federated
 * accounts) — it CLOSES them, permanently, for the operator's own password
 * session too, with no product route that strips the marker without also
 * banning. So the NEW link is refused instead, on a payer instance only — and
 * only the new one: an operator account already federated to this provider went
 * through the short-circuit long before this guard and still signs in, because
 * refusing it would lock out a session that works today without un-creating the
 * state that worries us.
 */
describe("resolveSsoUser — a platform-operator address is never federated on a payer instance", () => {
  const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  const OPERATOR = "ops@nodaro.example"
  let savedOperators: string | undefined
  let savedOwner: string | undefined

  beforeEach(() => {
    savedOperators = process.env.PLATFORM_OPERATOR_EMAILS
    savedOwner = process.env.PLATFORM_OWNER_EMAIL
  })
  afterEach(() => {
    if (savedOperators === undefined) delete process.env.PLATFORM_OPERATOR_EMAILS
    else process.env.PLATFORM_OPERATOR_EMAILS = savedOperators
    if (savedOwner === undefined) delete process.env.PLATFORM_OWNER_EMAIL
    else process.env.PLATFORM_OWNER_EMAIL = savedOwner
  })

  it("refuses account_exists with the flag ON, and stamps nothing", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = ` OPS@Nodaro.Example , other@nodaro.example `
    state.linkExisting = true
    state.payerId = PAYER
    state.profileByEmail = { id: "operator-uuid" }
    state.userById = { id: "operator-uuid", email: OPERATOR, user_metadata: {} }

    const r = await resolveSsoUser(provider, assertion({ email: OPERATOR }))

    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.updated).toBeNull()
  })

  it("refuses BEFORE provisioning too — a JIT-created operator account would be born federated", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = ""
    process.env.PLATFORM_OWNER_EMAIL = OPERATOR // the documented fallback
    state.payerId = PAYER
    state.profileByEmail = null

    const r = await resolveSsoUser(provider, assertion({ email: OPERATOR }))

    expect(r).toEqual({ ok: false, code: "account_exists", message: expect.any(String) })
    expect(state.created).toBeNull()
  })

  it("does NOT touch an operator account already linked to this provider — the guard stops the state being created, not used", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR
    state.payerId = PAYER
    state.profileByEmail = { id: "operator-uuid" }
    state.userById = { id: "operator-uuid", email: OPERATOR, user_metadata: { sso: "librechat" } }

    const r = await resolveSsoUser(provider, assertion({ email: OPERATOR }))

    expect(r).toMatchObject({ ok: true, action: "linked", userId: "operator-uuid" })
  })

  it("is INERT on mainline: with no payer the allowlist address links exactly as before", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = OPERATOR
    state.linkExisting = true
    state.payerId = null // mainline — the operator gate is the ordinary admin check here
    state.profileByEmail = { id: "operator-uuid" }
    state.userById = { id: "operator-uuid", email: OPERATOR, user_metadata: {} }

    const r = await resolveSsoUser(provider, assertion({ email: OPERATOR }))

    expect(r).toMatchObject({ ok: true, action: "linked", userId: "operator-uuid" })
  })
})

/**
 * The refusal must not tell the browser WHICH address is the billing account.
 * `routes/sso.ts:114` forwards `message` verbatim, so a payer-specific wording
 * would let anyone probe candidate addresses with an unverified assertion — the
 * reconnaissance step for every attack above.
 */
describe("resolveSsoUser — the refusals are not an oracle", () => {
  const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

  it("the payer's email_unverified message is byte-identical to the ordinary one", async () => {
    state.payerId = PAYER
    state.profileByEmail = { id: PAYER }
    state.userById = { id: PAYER, email: "new@example.com", user_metadata: {} }
    const payerRefusal = await resolveSsoUser(provider, assertion({ emailVerified: false }))

    state.payerId = null
    state.profileByEmail = null
    state.userById = null
    const ordinaryRefusal = await resolveSsoUser(provider, assertion({ emailVerified: false }))

    expect(payerRefusal).toEqual({ ok: false, code: "email_unverified", message: expect.any(String) })
    expect(ordinaryRefusal).toEqual({ ok: false, code: "email_unverified", message: expect.any(String) })
    expect(payerRefusal.ok === false && payerRefusal.message).toBe(
      ordinaryRefusal.ok === false && ordinaryRefusal.message,
    )
  })
})
