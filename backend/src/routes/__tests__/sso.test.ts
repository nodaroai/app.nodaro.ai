import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { SignJWT } from "jose"

const SECRET = "test-sso-hmac-secret-not-real-000"
const key = new TextEncoder().encode(SECRET)

const providers = vi.hoisted(() => ({
  list: [] as unknown[],
}))

vi.mock("../../lib/sso-providers.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/sso-providers.js")>()
  return {
    ...actual,
    getSsoProviders: () => providers.list as never,
    getSsoProvider: (id: string) => (providers.list as { id: string }[]).find((p) => p.id === id) as never,
  }
})

const linkResult = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("../../lib/sso-linking.js", () => ({
  resolveSsoUser: vi.fn(async () => linkResult.value),
}))

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    auth: {
      admin: {
        generateLink: vi.fn(async () => ({
          data: { properties: { hashed_token: "HASHED_TOKEN_123" } },
          error: null,
        })),
      },
    },
  },
}))

// Redis rate-limit counter — always fresh.
vi.mock("../../lib/queue.js", () => ({
  redis: { incr: vi.fn(async () => 1), expire: vi.fn(async () => 1), ttl: vi.fn(async () => 60), set: vi.fn(async () => "OK") },
}))

vi.mock("../../lib/config.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, PUBLIC_URL: "" } }
})

vi.mock("../../lib/sso-replay.js", () => ({ claimAssertionJti: vi.fn(async () => true) }))

import { ssoRoutes } from "../sso.js"
import { claimAssertionJti } from "../../lib/sso-replay.js"

const assertionProvider = {
  id: "librechat", label: "LibreChat", kind: "assertion", secret: SECRET, audience: "nodaro",
  claimMap: { email: "email", emailVerified: "email_verified", subject: "sub" }, maxLifetimeSeconds: 300,
  initiateUrl: "https://idp.example/login",
}

async function mintAssertion() {
  return new SignJWT({ email: "a@b.com", email_verified: true, sub: "x" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setAudience("nodaro").setExpirationTime("2m").setJti("j1").sign(key)
}

async function build() {
  const app = Fastify()
  await app.register(ssoRoutes)
  return app
}

beforeEach(() => {
  // This vitest config does not reset mock call history per test; clear it so
  // per-test call-count assertions (e.g. generateLink NOT called on a 403) see
  // only this test's calls. clearAllMocks resets call history, not the factory
  // implementations, so the resolved-value stubs below/above still apply.
  vi.clearAllMocks()
  providers.list = [assertionProvider]
  linkResult.value = { ok: true, email: "a@b.com", userId: "u1", action: "provisioned" }
  vi.mocked(claimAssertionJti).mockResolvedValue(true)
})

describe("GET /v1/sso/providers", () => {
  it("returns only public metadata (no secrets)", async () => {
    const app = await build()
    const res = await app.inject({ method: "GET", url: "/v1/sso/providers" })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.providers).toEqual([{ id: "librechat", label: "LibreChat", kind: "assertion" }])
    expect(res.body).not.toContain(SECRET)
  })
})

describe("GET /v1/sso/:provider", () => {
  it("404s an unknown provider", async () => {
    const app = await build()
    const res = await app.inject({ method: "GET", url: "/v1/sso/nope" })
    expect(res.statusCode).toBe(404)
  })

  it("302s to initiateUrl when hit WITHOUT an assertion", async () => {
    const app = await build()
    const res = await app.inject({ method: "GET", url: "/v1/sso/librechat" })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("https://idp.example/login")
  })

  it("verifies a valid assertion and 302s to /sso with the minted token", async () => {
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("/sso?sso_token=HASHED_TOKEN_123&next=%2Fprojects")
  })

  it("honours a same-origin relative next param", async () => {
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}&next=/library` })
    expect(res.headers.location).toContain("next=%2Flibrary")
  })

  it("rejects an open-redirect next (absolute URL) and falls back to /projects", async () => {
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}&next=https://evil.com` })
    expect(res.headers.location).toContain("next=%2Fprojects")
  })

  it("rejects a protocol-relative next (//evil.com)", async () => {
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}&next=//evil.com` })
    expect(res.headers.location).toContain("next=%2Fprojects")
  })

  it("401s an invalid assertion", async () => {
    const app = await build()
    const res = await app.inject({ method: "GET", url: "/v1/sso/librechat?assertion=not.a.jwt" })
    expect(res.statusCode).toBe(401)
  })

  it("401s a replayed assertion (jti already claimed)", async () => {
    vi.mocked(claimAssertionJti).mockResolvedValue(false)
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}` })
    expect(res.statusCode).toBe(401)
  })

  it("403s when linking is rejected — and mints NO token", async () => {
    linkResult.value = { ok: false, code: "account_exists", message: "exists" }
    const { supabase } = await import("../../lib/supabase.js")
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}` })
    expect(res.statusCode).toBe(403)
    expect(supabase.auth.admin.generateLink).not.toHaveBeenCalled()
  })

  it("400s a non-assertion provider hit with an assertion", async () => {
    providers.list = [{ id: "wk", label: "WorkOS", kind: "oidc", domain: "acme.com", claimMap: assertionProvider.claimMap, maxLifetimeSeconds: 300 }]
    const app = await build()
    const res = await app.inject({ method: "GET", url: "/v1/sso/wk?assertion=x" })
    expect(res.statusCode).toBe(400)
  })
})
