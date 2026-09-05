/**
 * B1 — the billing account cannot authenticate today, and the fix is ONE
 * uuid-wide hole in the H6 SSO gate.
 *
 * `auth.methods: ["sso"]` makes `surfaceSsoOnly()` true, and H6 then 403s
 * `sso_required` for every JWT whose service-role `app_metadata.sso` marker is
 * unset. `support@acme.example` is a password account with no marker: GoTrue
 * authenticates it happily and its very first API request is refused. The
 * account that holds Nodaro's money cannot reach a single route.
 *
 * WHY NOT WIDEN `auth.methods`. Adding `"email"` to the profile flips
 * `surfaceSsoOnly()` to FALSE, which disables the gate for the ENTIRE instance
 * — re-opening self-registration against the publicly reachable GoTrue for
 * every account, so anyone could sign up and spend the tenant's prepaid
 * credits. The gate is worth more than the exemption; the exemption must
 * therefore be as narrow as a single uuid.
 *
 * WHY THIS EXEMPTION CANNOT BE WIDENED FROM INSIDE THE PRODUCT.
 * `deploymentPayerId()` is resolved at boot from `billing.payerAccount`, which
 * is operator-owned surface-profile configuration, redacted from `/config.js`,
 * and null on mainline. There is no route, role or IdP assertion that changes
 * what it answers.
 *
 * The two assertions that matter are therefore the pair: the payer gets in
 * WITHOUT a marker, and EVERY other non-marker account still does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const PAYER_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

const getUser = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: null }, error: null }),
    })),
    auth: { getUser: (...a: unknown[]) => getUser(...a) },
  },
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isBusiness: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

import { registerAuthHook } from "../auth.js"
import { SSO_APP_METADATA_KEY } from "../../lib/sso-linking.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } from "../../lib/deployment-payer.js"

const SSO_ONLY = JSON.stringify({ auth: { methods: ["sso"], ssoLabel: "Acme" } })

function setProfile(json: string | null): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = json
  __resetSurfaceProfileCacheForTests()
}

function userResult(id: string, app: Record<string, unknown> = {}) {
  return { data: { user: { id, app_metadata: app, user_metadata: {} } }, error: null }
}

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerAuthHook(app)
  app.get("/v1/echo", async (req) => ({ userId: req.userId ?? null }))
  await app.ready()
  return app
}

/** A UNIQUE token per case — the auth module caches by token hash, so a reused
 *  token serves a previous case's decision. */
function inject(app: FastifyInstance, token: string) {
  return app.inject({ method: "GET", url: "/v1/echo", headers: { authorization: `Bearer ${token}` } })
}

let app: FastifyInstance
beforeEach(async () => {
  vi.clearAllMocks()
  app = await build()
})
afterEach(() => {
  setProfile(null)
  __resetDeploymentPayerForTests()
})

describe("the marker key does not drift", () => {
  it("`lib/deployment-payer.ts`'s SSO_MARKER_KEY literal still matches its home", () => {
    // The boot-time federated-payer refusal (D15.1) reads `app_metadata.sso`
    // from a LITERAL in `lib/deployment-payer.ts`, not from this constant —
    // that module may not import `sso-linking.js`, which drags `supabase.js`
    // and `config.js` into the import graph of every money route. This is the
    // guard that keeps the copy honest: rename the key here and the payer's
    // federation check would silently start answering "not federated" for
    // every account, admitting exactly the identity D15.1 exists to refuse.
    expect(SSO_APP_METADATA_KEY).toBe("sso")
  })
})

describe("the exemption", () => {
  it("the payer passes H6 with NO app_metadata.sso marker", async () => {
    setProfile(SSO_ONLY)
    __setDeploymentPayerForTests(PAYER_UUID)
    getUser.mockResolvedValue(userResult(PAYER_UUID))

    const res = await inject(app, "tok-payer-no-marker")

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ userId: PAYER_UUID })
  })
})

describe("the exemption is exactly one uuid wide", () => {
  it("EVERY other non-marker account is still sso_required", async () => {
    setProfile(SSO_ONLY)
    __setDeploymentPayerForTests(PAYER_UUID)
    getUser.mockResolvedValue(userResult("22222222-3333-4444-8555-666666666666"))

    const res = await inject(app, "tok-other-no-marker")

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("sso_required")
  })

  it("a marked SSO account still passes (the gate's normal path is unchanged)", async () => {
    setProfile(SSO_ONLY)
    __setDeploymentPayerForTests(PAYER_UUID)
    getUser.mockResolvedValue(userResult("33333333-4444-4555-8666-777777777777", { sso: { provider: "sai" } }))

    const res = await inject(app, "tok-marked-sso")

    expect(res.statusCode).toBe(200)
  })

  it("with NO payer configured the gate is untouched — the payer's own uuid is refused too", async () => {
    // R2: `deploymentPayerId()` is null on mainline, and `userId !== null` is
    // true for every account, so the condition reduces to today's `if
    // (surfaceSsoOnly())` exactly.
    setProfile(SSO_ONLY)
    getUser.mockResolvedValue(userResult(PAYER_UUID))

    const res = await inject(app, "tok-payer-but-no-payer-configured")

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("sso_required")
  })

  it("with no SSO-only profile the gate never runs, payer or not", async () => {
    setProfile(null)
    __setDeploymentPayerForTests(PAYER_UUID)
    getUser.mockResolvedValue(userResult("44444444-5555-4666-8777-888888888888"))

    const res = await inject(app, "tok-mainline-profile")

    expect(res.statusCode).toBe(200)
  })
})
