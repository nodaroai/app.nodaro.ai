/**
 * The THIRD guard — `requireDeploymentPayer` (spec §8.1).
 *
 * The product already has two authorization gates: `requireAdmin` (a role
 * column) and `requirePlatformOperator` (an env allowlist + not-federated).
 * Neither can hold the routes this one holds, and the reason is the whole
 * point of the guard:
 *
 *   - A ROLE CANNOT. On a deployment-payer instance the CUSTOMER runs the
 *     identity provider, so the customer mints the identities `profiles.role`
 *     hangs off. Any admin we grant is one the customer can re-assert.
 *   - THE OPERATOR ALLOWLIST IS THE WRONG PRINCIPAL. These routes are the
 *     BILLING ACCOUNT's own — the account that holds the credits, buys more
 *     with its own card, and decides who gets an allowance. That is a
 *     customer-side principal, not Nodaro's operator.
 *
 * So the check is IDENTITY, not authority: `req.userId === deploymentPayerId()`,
 * a uuid resolved at boot from operator-owned configuration and redacted from
 * `/config.js`. Nothing inside the product can write it.
 *
 * THE `authKind` HALF IS NOT REDUNDANT DECORATION. Decision (6) puts a
 * payer-owned credential on developers' laptops, and `middleware/auth.ts`
 * resolves an `ndr_` personal API token to `req.userId = <owner>`. An
 * identity-only guard would let a leaked relay key mint allocations and buy
 * credits on Nodaro's Stripe — so a payer arriving by token is refused, and
 * that case is asserted below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const PAYER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const OTHER_UUID = "11111111-2222-4333-8444-555555555555"

// The guard must not drag `lib/supabase.js` (→ config.js) into route suites
// that mock config partially; it reads nothing from the database. The mock
// exists to prove that: if the guard ever grows a query, this factory is what
// it would have to be told about.
vi.mock("../../../lib/supabase.js", () => ({ supabase: {} }))

const { requireDeploymentPayer } = await import("../require-deployment-payer.js")
const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import(
  "../../../lib/deployment-payer.js"
)

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  const reply = {
    sent,
    status(code: number) {
      return {
        send: (body: unknown) => {
          sent.push({ status: code, body })
          return reply
        },
      }
    },
  }
  return reply
}

type Req = Record<string, unknown>
const req = (over: Req = {}): Req => ({
  userId: PAYER_UUID,
  authKind: "jwt",
  url: "/v1/deployment-billing/overview",
  ...over,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (r: Req, reply: ReturnType<typeof makeReply>) => requireDeploymentPayer(r as any, reply as any)

beforeEach(() => __resetDeploymentPayerForTests())
afterEach(() => __resetDeploymentPayerForTests())

describe("the payer passes", () => {
  it("the payer's own JWT is admitted with no reply written", async () => {
    __setDeploymentPayerForTests(PAYER_UUID)
    const reply = makeReply()
    await run(req(), reply)
    expect(reply.sent).toEqual([])
  })
})

describe("everyone else is refused — including every kind of admin", () => {
  beforeEach(() => __setDeploymentPayerForTests(PAYER_UUID))

  it("a super_admin JWT ⇒ 403 payer_required (a role is not the principal)", async () => {
    const reply = makeReply()
    await run(req({ userId: OTHER_UUID, userRole: "super_admin" }), reply)
    expect(reply.sent).toHaveLength(1)
    expect(reply.sent[0].status).toBe(403)
    expect(reply.sent[0].body).toMatchObject({ error: { code: "payer_required" } })
  })

  it("a platform-operator account ⇒ 403 (the operator is Nodaro's principal, not the customer's billing account)", async () => {
    const reply = makeReply()
    await run(req({ userId: OTHER_UUID, userRole: "admin", isPlatformOperator: true }), reply)
    expect(reply.sent[0].status).toBe(403)
  })

  it("THE PAYER VIA AN `ndr_` PERSONAL TOKEN ⇒ 403 — a leaked relay key mints nothing", async () => {
    const reply = makeReply()
    await run(req({ authKind: "api_token", apiToken: { userId: PAYER_UUID } }), reply)
    expect(reply.sent).toHaveLength(1)
    expect(reply.sent[0].status).toBe(403)
    expect(reply.sent[0].body).toMatchObject({ error: { code: "payer_required" } })
  })

  it("the payer via a developer-app OAuth token ⇒ 403 (no scope authorizes this)", async () => {
    const reply = makeReply()
    await run(req({ authKind: "oauth", appAuthorization: { appId: "a" } }), reply)
    expect(reply.sent[0].status).toBe(403)
  })

  it("an unauthenticated request ⇒ 401, not 403 (nothing to authorize yet)", async () => {
    const reply = makeReply()
    await run(req({ userId: undefined }), reply)
    expect(reply.sent[0].status).toBe(401)
    expect(reply.sent[0].body).toMatchObject({ error: { code: "unauthorized" } })
  })
})

describe("mainline ⇒ the routes are NOT REGISTERED (spec §12) — the real gate", () => {
  // `buildApp()` cannot be booted in a unit test (it reads config, opens the
  // DB and binds a port), so the registration CONDITION is asserted as text —
  // the `money-route-totality.test.ts` idiom. It is worth asserting because
  // this one line, not the guard, is what makes the whole billing-account
  // surface absent on every deployment without a payer: simplified to `if
  // (hasCredits())` it would register seven money routes on Nodaro Cloud,
  // where they would answer 404 only by the guard's dead branch.
  const APP_TS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app.ts")
  const source = readFileSync(APP_TS, "utf8")

  it("app.ts registers deploymentBillingRoutes ONLY under hasCredits() && deploymentPayerActive()", () => {
    expect(source).toContain(
      "if (hasCredits() && deploymentPayerActive()) await app.register(deploymentBillingRoutes)",
    )
  })

  it("there is no OTHER registration of those routes", () => {
    const registrations = source.match(/app\.register\(deploymentBillingRoutes\)/g) ?? []
    expect(registrations).toHaveLength(1)
  })
})

describe("a guard that can be mounted anywhere must be safe anywhere", () => {
  it("no payer configured ⇒ 404 even for a correct-looking caller", async () => {
    // On mainline the routes are never registered (`hasCredits() &&
    // deploymentPayerActive()` in app.ts), so this branch is unreachable in
    // production — which is exactly why it is asserted here. A future route
    // that forgets the registration condition must not become open.
    const reply = makeReply()
    await run(req(), reply)
    expect(reply.sent[0].status).toBe(404)
  })
})
