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

// PUBLIC_URL is per-test (a getter — the route reads it on every request);
// CORS_ORIGIN is FIXED for the whole file because allowed-origins caches the
// computed allowlist on first use. No test below sends a request from
// PUBLIC_URL's own host, so which test warms that cache never matters.
const publicUrl = vi.hoisted(() => ({ value: "" }))
vi.mock("../../lib/config.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    config: {
      ...actual.config,
      CORS_ORIGIN: "https://studio.sai-kehila.com",
      get PUBLIC_URL() {
        return publicUrl.value
      },
    },
  }
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
  publicUrl.value = ""
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

/**
 * WS-D — the origin-agnostic hosted lane. The same studio is reachable on more
 * than one hostname, and PUBLIC_URL can only name one, so the landing redirect
 * is relative for any host the operator already allow-lists (same-origin by
 * construction behind Caddy) and absolute only for a host that is not.
 *
 * CORS_ORIGIN is pinned to https://studio.sai-kehila.com in the config mock
 * above, so that host is allow-listed and any other is foreign.
 */
describe("the landing redirect is host-aware (WS-D)", () => {
  const kehila = { "x-forwarded-proto": "https", "x-forwarded-host": "studio.sai-kehila.com" }
  const foreign = { "x-forwarded-proto": "https", "x-forwarded-host": "split-origin.example.dev" }

  it("is RELATIVE from an allow-listed host even when PUBLIC_URL names another one", async () => {
    publicUrl.value = "https://app.example.com"
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}`, headers: kehila })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("/sso?sso_token=HASHED_TOKEN_123&next=%2Fprojects")
  })

  it('is RELATIVE from that host even when the edge stamped proto "http" on an https allow-list entry', async () => {
    // The production shape: a TLS-terminating platform edge, Caddy rewriting
    // x-forwarded-proto to its own http. The predicate is host-based precisely
    // so this still resolves to the same-origin form.
    publicUrl.value = "https://app.example.com"
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({
      method: "GET",
      url: `/v1/sso/librechat?assertion=${token}`,
      headers: { "x-forwarded-proto": "http", "x-forwarded-host": "studio.sai-kehila.com" },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("/sso?sso_token=HASHED_TOKEN_123&next=%2Fprojects")
  })

  it("is ABSOLUTE on PUBLIC_URL from a host that is NOT allow-listed (the split-origin dev setup)", async () => {
    publicUrl.value = "https://app.example.com"
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}`, headers: foreign })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("https://app.example.com/sso?sso_token=HASHED_TOKEN_123&next=%2Fprojects")
  })

  it("is relative from EITHER host when PUBLIC_URL is unset — today's behaviour", async () => {
    const app = await build()
    for (const headers of [kehila, foreign]) {
      const token = await mintAssertion()
      const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}`, headers })
      expect(res.headers.location).toBe("/sso?sso_token=HASHED_TOKEN_123&next=%2Fprojects")
    }
  })

  it("keeps the next param through the relative form", async () => {
    const app = await build()
    const token = await mintAssertion()
    const res = await app.inject({ method: "GET", url: `/v1/sso/librechat?assertion=${token}&next=/library`, headers: kehila })
    expect(res.headers.location).toBe("/sso?sso_token=HASHED_TOKEN_123&next=%2Flibrary")
  })
})

describe("initiateUrlByHost — the IdP bounce follows the request host (WS-D)", () => {
  const mapped = {
    ...assertionProvider,
    initiateUrlByHost: { "studio.sai-kehila.com": "https://chat.sai-kehila.com/login" },
  }

  it("bounces to the mapped IdP for the host the browser arrived on", async () => {
    providers.list = [mapped]
    const app = await build()
    const res = await app.inject({
      method: "GET",
      url: "/v1/sso/librechat",
      headers: { "x-forwarded-host": "studio.sai-kehila.com" },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("https://chat.sai-kehila.com/login")
  })

  it("matches the mapped host case-insensitively and ignores the port", async () => {
    providers.list = [mapped]
    const app = await build()
    const res = await app.inject({
      method: "GET",
      url: "/v1/sso/librechat",
      headers: { "x-forwarded-host": "Studio.SAI-Kehila.com:443" },
    })
    expect(res.headers.location).toBe("https://chat.sai-kehila.com/login")
  })

  it("falls back to initiateUrl for a host that is not in the map", async () => {
    providers.list = [mapped]
    const app = await build()
    const res = await app.inject({
      method: "GET",
      url: "/v1/sso/librechat",
      headers: { "x-forwarded-host": "app.example.com" },
    })
    expect(res.headers.location).toBe("https://idp.example/login")
  })

  it("never reads an INHERITED key — a host named `constructor` falls back", async () => {
    providers.list = [mapped]
    const app = await build()
    const res = await app.inject({
      method: "GET",
      url: "/v1/sso/librechat",
      headers: { "x-forwarded-host": "constructor" },
    })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe("https://idp.example/login")
  })

  it("400s no_assertion when neither the map nor a default initiateUrl matches", async () => {
    providers.list = [{ ...assertionProvider, initiateUrl: undefined, initiateUrlByHost: mapped.initiateUrlByHost }]
    const app = await build()
    const res = await app.inject({
      method: "GET",
      url: "/v1/sso/librechat",
      headers: { "x-forwarded-host": "app.example.com" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("no_assertion")
  })

  it("is NEVER exposed by /v1/sso/providers", async () => {
    providers.list = [mapped]
    const app = await build()
    const res = await app.inject({ method: "GET", url: "/v1/sso/providers" })
    expect(res.json().providers).toEqual([{ id: "librechat", label: "LibreChat", kind: "assertion" }])
    expect(res.body).not.toContain("chat.sai-kehila.com")
  })
})
