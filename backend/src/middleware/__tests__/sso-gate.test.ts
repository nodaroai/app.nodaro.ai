import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * SAI-5 / H6 — the server-authoritative SSO gate.
 *
 * On a deployment whose surface profile restricts sign-in to SSO only
 * (auth.methods=["sso"] + an ssoLabel), a JWT account is accepted ONLY if it
 * carries app_metadata.sso — the marker sso-linking stamps through the
 * service-role admin API. A self-registered account (public signUp against the
 * reachable GoTrue) has no app_metadata.sso and is rejected, so it cannot spend
 * the tenant's prepaid credits.
 *
 * The load-bearing assertion: user_metadata.sso is NOT sufficient — a public
 * signUp can set user_metadata via options.data, so trusting it would let a
 * self-registered account forge the marker. Only app_metadata (service-role-only)
 * is trusted.
 */

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

// Cloud edition → surfaceGateOpen() true → the surface profile applies.
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  isBusiness: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  hasCredits: () => true,
  hasAdmin: () => true,
}))

import { registerAuthHook } from "../auth.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const SSO_ONLY = JSON.stringify({ auth: { methods: ["sso"], ssoLabel: "SAI" } })

function setProfile(json: string | null): void {
  if (json === null) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = json
  __resetSurfaceProfileCacheForTests()
}

function userResult(app: Record<string, unknown>, user: Record<string, unknown> = {}) {
  return { data: { user: { id: "u-1", app_metadata: app, user_metadata: user } }, error: null }
}

async function build(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  registerAuthHook(app)
  app.get("/v1/echo", async (req) => ({ userId: req.userId ?? null }))
  await app.ready()
  return app
}

// A UNIQUE token per test — the module-level auth cache keys on token hash, so
// reusing a token would serve a prior test's cached (passing) decision.
function inject(app: FastifyInstance, token: string) {
  return app.inject({ method: "GET", url: "/v1/echo", headers: { authorization: `Bearer ${token}` } })
}

let app: FastifyInstance
beforeEach(async () => {
  app = await build()
})
afterEach(async () => {
  await app.close()
  setProfile(null)
  getUser.mockReset()
})

describe("SSO-only deployment", () => {
  it("rejects a JWT account with no app_metadata.sso", async () => {
    setProfile(SSO_ONLY)
    getUser.mockResolvedValue(userResult({}))
    const res = await inject(app, "tok-no-sso")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("sso_required")
  })

  it("does NOT accept a forged user_metadata.sso — only app_metadata is trusted", async () => {
    setProfile(SSO_ONLY)
    getUser.mockResolvedValue(userResult({}, { sso: "SAI" }))
    const res = await inject(app, "tok-forged")
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("sso_required")
  })

  it("accepts a JWT account with app_metadata.sso", async () => {
    setProfile(SSO_ONLY)
    getUser.mockResolvedValue(userResult({ sso: "SAI", sso_subject: "abc" }))
    const res = await inject(app, "tok-sso")
    expect(res.statusCode).toBe(200)
    expect(res.json().userId).toBe("u-1")
  })
})

describe("gate is off (inert) unless SSO is the exclusive method", () => {
  it("no surface profile at all (mainline)", async () => {
    setProfile(null)
    getUser.mockResolvedValue(userResult({}))
    const res = await inject(app, "tok-mainline")
    expect(res.statusCode).toBe(200)
    expect(res.json().userId).toBe("u-1")
  })

  it("methods=[sso] but ssoLabel missing → refined away → gate off", async () => {
    setProfile(JSON.stringify({ auth: { methods: ["sso"] } }))
    getUser.mockResolvedValue(userResult({}))
    const res = await inject(app, "tok-nolabel")
    expect(res.statusCode).toBe(200)
  })

  it("mixed auth (email + sso) → a password account is legitimate → gate off", async () => {
    setProfile(JSON.stringify({ auth: { methods: ["email", "sso"], ssoLabel: "SAI" } }))
    getUser.mockResolvedValue(userResult({}))
    const res = await inject(app, "tok-mixed")
    expect(res.statusCode).toBe(200)
  })
})
