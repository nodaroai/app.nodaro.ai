import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * The MCP assertion exchange (decided 2026-11-11), booted for real on the
 * dedicated lane, with the real verifier, the real single-use store (an
 * in-memory Redis both doors share), the real account resolution and the real
 * token minting over an in-memory database.
 *
 * The deployment lists two MCP clients: its own chat application's server
 * (a confidential client, named for the exchange) and a second listed client
 * that is not. One provider signs people in with one audience and signs
 * exchange assertions with another.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "off"
  process.env.PUBLIC_URL = "https://app.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  process.env.MCP_ALLOWED_CLIENT_IDS = `app_${"1".repeat(32)},app_${"5".repeat(32)}`
  process.env.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = `app_${"5".repeat(32)}`
  process.env.EXTERNAL_SSO_PROVIDERS = JSON.stringify([
    { id: "chat", label: "Chat", kind: "assertion", secret: "test-only-sso-hmac-secret-not-real", audience: "nodaro-sign-in", exchangeAudience: "nodaro-mcp-exchange", maxLifetimeSeconds: 300 },
  ])
  delete process.env.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS
  delete process.env.NODARO_SURFACE_PROFILE
})

const fake = vi.hoisted(() => ({ db: null as unknown, harness: null as unknown, redis: null as unknown, blocked: new Set<string>() }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb } = await import("./helpers/oauth-memory-db.js")
  const { exchangeSupabase } = await import("./helpers/assertion-exchange-harness.js")
  const db = newOAuthMemoryDb()
  const harness = exchangeSupabase(db)
  fake.db = db
  fake.harness = harness
  return { supabase: harness.supabase }
})

vi.mock("../../lib/queue.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/queue.js")>()
  const { memoryRedis } = await import("./helpers/assertion-exchange-harness.js")
  const r = memoryRedis()
  fake.redis = r
  return { ...actual, redis: r.redis }
})

vi.mock("../../lib/access-blocks.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/access-blocks.js")>()
  return { ...actual, isUserBlocked: async (id: string | null | undefined) => (id ? fake.blocked.has(id) : false) || actual.isUserBlocked(id) }
})

import { buildApp } from "../../app.js"
import { config } from "../../lib/config.js"
import { hashSecret } from "../developer-apps.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import type { OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import { INIT, MCP_HEADERS, OWN_CLIENT_ID, seedLane } from "./helpers/mcp-lane-transcript.js"
import { JWT_BEARER, PLACEHOLDER_ASSERTION, SECRET_CLIENT_ID, TOKEN_WALK_SECRET, seedSecretClient, tokenTranscript } from "./helpers/oauth-token-transcript.js"
import { EXCHANGE_AUDIENCE, PROVIDERS_JSON, PROVIDER_ID, SIGN_IN_AUDIENCE, exchangeRequest, exchangedTokens, exchangeSupabase, memoryRedis, signAssertion } from "./helpers/assertion-exchange-harness.js"

const MCP_RESOURCE = "https://mcp.example.com/mcp"
/** What the endpoint answers a grant type it does not know — recorded in oauth-token-grants-off-fixture.test.ts. */
const UNKNOWN_GRANT = { error: "invalid_request", error_description: 'Invalid input: expected "authorization_code"' }
const NO_ACCOUNT = { error: "invalid_grant", error_description: "The assertion does not name a person this application can obtain a token for." }

describe("the MCP assertion exchange, on the dedicated lane", () => {
  let app: FastifyInstance
  let db: OAuthMemoryDb
  let harness: ReturnType<typeof exchangeSupabase>
  let redis: ReturnType<typeof memoryRedis>

  beforeAll(async () => {
    expect(process.env.EXTERNAL_SSO_PROVIDERS).toBe(PROVIDERS_JSON)
    __resetSurfaceProfileCacheForTests()
    db = fake.db as OAuthMemoryDb
    harness = fake.harness as ReturnType<typeof exchangeSupabase>
    redis = fake.redis as ReturnType<typeof memoryRedis>
    seedLane(db)
    seedSecretClient(db, await hashSecret(TOKEN_WALK_SECRET))
    app = await buildApp()
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    redis.state.fail = false
    fake.blocked.clear()
  })

  const exchange = async (assertion: string, extra: Record<string, string | undefined> = {}) =>
    exchangeRequest(app, { client_id: SECRET_CLIENT_ID, client_secret: TOKEN_WALK_SECRET, assertion, resource: MCP_RESOURCE, ...extra })
  const mcp = (bearer: string, payload: unknown = INIT) =>
    app.inject({ method: "POST", url: "/mcp", headers: { ...MCP_HEADERS, authorization: `Bearer ${bearer}` }, payload: payload as string })

  describe("the happy path", () => {
    it("a person with no account: provisioned exactly as the sign-in does, token issued, initialize and tools/list work", async () => {
      const before = Date.now()
      const res = await exchange(await signAssertion({ email: "New.Person@example.com", sub: "idp-new-1" }))
      expect(res.statusCode, res.body).toBe(200)
      expect(res.headers["cache-control"]).toBe("no-store")
      expect(res.headers["pragma"]).toBe("no-cache")
      const body = res.json() as { access_token: string; token_type: string; scope: string; expires_in: number }
      expect(body).toEqual({ access_token: expect.stringMatching(/^ndr_app_[0-9a-f]{64}$/), token_type: "Bearer", scope: "jobs:read assets:read", expires_in: 3600 })

      // The account: what resolveSsoUser makes for anyone the provider asserts with a verified email.
      const person = harness.created.find((u) => u.email === "new.person@example.com")
      expect(person).toBeDefined()
      expect(person!.app_metadata).toEqual({ sso: PROVIDER_ID, sso_subject: "idp-new-1" })
      expect(person!.user_metadata).toEqual({ sso: PROVIDER_ID, sso_subject: "idp-new-1" })

      // The token: an ordinary app token for (person, client), recorded as exchanged, an hour long.
      const grant = db.authorizations.find((a) => a.user_id === person!.id)
      expect(grant).toMatchObject({ scopes_granted: ["jobs:read", "assets:read"] })
      const token = exchangedTokens(db).find((t) => t.authorization_id === grant!.id)!
      expect(token).toBeDefined()
      const expires = new Date(String(token.expires_at)).getTime()
      expect(expires - before).toBeGreaterThanOrEqual(3600_000)
      expect(expires - Date.now()).toBeLessThanOrEqual(3600_000)

      const init = await mcp(body.access_token)
      expect(init.statusCode, init.body).toBe(200)
      expect(init.json().result.serverInfo).toEqual({ name: "nodaro-mcp", version: "1.0.0" })
      const list = await mcp(body.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" })
      expect(list.statusCode).toBe(200)
      expect((list.json().result.tools as Array<{ name: string }>).length).toBeGreaterThan(1)
    })

    it("a person whose account the provider already linked: the token is theirs", async () => {
      const linked = harness.seedAccount({ email: "linked@example.com", user_metadata: { sso: PROVIDER_ID, sso_subject: "idp-linked" }, app_metadata: { sso: PROVIDER_ID, sso_subject: "idp-linked" } })
      const res = await exchange(await signAssertion({ email: "linked@example.com", sub: "idp-linked" }), { scope: "jobs:read" })
      expect(res.statusCode, res.body).toBe(200)
      expect(res.json()).toMatchObject({ scope: "jobs:read", expires_in: 3600 })
      expect(db.authorizations.find((a) => a.user_id === linked.id)).toMatchObject({ scopes_granted: ["jobs:read"] })
      expect(harness.created.some((u) => u.email === "linked@example.com")).toBe(false)
    })

    it("the metadata names the grant", async () => {
      const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" })
      expect(res.json().grant_types_supported).toEqual(["authorization_code", JWT_BEARER])
    })

    it("a JSON body is read the same way", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/oauth/token",
        headers: { "content-type": "application/json" },
        payload: { grant_type: JWT_BEARER, client_id: SECRET_CLIENT_ID, client_secret: TOKEN_WALK_SECRET, assertion: await signAssertion({ email: "json@example.com", sub: "idp-json" }), resource: MCP_RESOURCE },
      })
      expect(res.statusCode, res.body).toBe(200)
    })
  })

  describe("the token, after it is issued", () => {
    async function tokenFor(email: string): Promise<string> {
      const res = await exchange(await signAssertion({ email, sub: `idp-${email}` }))
      expect(res.statusCode, res.body).toBe(200)
      return (res.json() as { access_token: string }).access_token
    }

    it("expires after its hour", async () => {
      const bearer = await tokenFor("expires@example.com")
      expect((await mcp(bearer)).statusCode).toBe(200)
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now + 3601_000)
      // An expired token is no credential: the endpoint answers its usual challenge.
      const res = await mcp(bearer)
      expect(res.statusCode).toBe(401)
      expect(res.headers["www-authenticate"]).toBe('Bearer realm="mcp.example.com", resource="https://mcp.example.com/mcp"')
    })

    it("a client removed from the MCP list loses it at the next call", async () => {
      const bearer = await tokenFor("removed@example.com")
      expect((await mcp(bearer)).statusCode).toBe(200)
      const listed = config.MCP_ALLOWED_CLIENT_IDS
      config.MCP_ALLOWED_CLIENT_IDS = OWN_CLIENT_ID
      try {
        const res = await mcp(bearer)
        expect(res.statusCode).toBe(403)
        expect(res.json().error.code).toBe("mcp_client_not_allowed")
      } finally {
        config.MCP_ALLOWED_CLIENT_IDS = listed
      }
      expect((await mcp(bearer)).statusCode).toBe(200)
    })

    it("shows in the person's Connected apps as obtained by the exchange; revoking it ends it, and the exchange does not revive it", async () => {
      await tokenFor("revoker@example.com")
      const person = harness.created.find((u) => u.email === "revoker@example.com")!
      db.sessions.set("jwt-session-of-revoker", person.id)
      const list = await app.inject({ method: "GET", url: "/v1/me/connected-apps", headers: { authorization: "Bearer jwt-session-of-revoker" } })
      expect(list.statusCode, list.body).toBe(200)
      const apps = list.json().apps as Array<{ authorizationId: string; grantedBy?: string }>
      expect(apps).toHaveLength(1)
      expect(apps[0]).toMatchObject({ grantedBy: "assertion_exchange" })

      const bearer = await tokenFor("revoker@example.com")
      const revoke = await app.inject({ method: "POST", url: `/v1/me/connected-apps/${apps[0]!.authorizationId}/revoke`, headers: { authorization: "Bearer jwt-session-of-revoker" } })
      expect(revoke.statusCode).toBe(200)
      expect((await mcp(bearer)).statusCode).toBe(401)

      const again = await exchange(await signAssertion({ email: "revoker@example.com", sub: "idp-revoker@example.com" }))
      expect(again.statusCode).toBe(400)
      expect(again.json()).toEqual(NO_ACCOUNT)
      expect(db.authorizations.find((a) => a.id === apps[0]!.authorizationId)!.revoked_at).not.toBeNull()
    })
  })

  describe("the authorization-code grant, with the exchange on", () => {
    it("answers exactly as it does with the exchange off, in every shape; only the jwt-bearer requests and the metadata differ", async () => {
      const on = await tokenTranscript(app, { resource: MCP_RESOURCE })
      const named = config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS
      config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = ""
      let off: Awaited<ReturnType<typeof tokenTranscript>>
      try {
        off = await tokenTranscript(app, { resource: MCP_RESOURCE })
      } finally {
        config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = named
      }
      const withoutExchange = (t: Record<string, unknown>) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith("jwtBearer") && k !== "grantTypesSupported"))
      expect(withoutExchange(on)).toEqual(withoutExchange(off))
      expect(off.codePkce.status).toBe(200)
      expect(off.codeSecret.status).toBe(200)
      // With it off, the jwt-bearer requests read as an unknown grant; with it on, the named client's are exchanges.
      for (const k of ["jwtBearer", "jwtBearerNoResource", "jwtBearerJson"] as const) expect(off[k].body, k).toEqual(UNKNOWN_GRANT)
      expect(on.jwtBearer.body).toMatchObject({ error: "invalid_grant" })
      // A client the exchange is not on for reads the same either way.
      expect(on.jwtBearerPublicClient).toEqual(off.jwtBearerPublicClient)
      expect(on.jwtBearerUnknownClient).toEqual(off.jwtBearerUnknownClient)
      expect(on.jwtBearerNoClient).toEqual(off.jwtBearerNoClient)
    })
  })

  describe("off for every client but the one named, answered as an unknown grant", () => {
    it.each([
      ["a second listed client, not named for the exchange", OWN_CLIENT_ID],
      ["an unlisted developer app", `app_${"3".repeat(32)}`],
      ["an unknown client", `app_${"7".repeat(32)}`],
    ])("%s", async (_label, clientId) => {
      const res = await exchangeRequest(app, { client_id: clientId, client_secret: TOKEN_WALK_SECRET, assertion: await signAssertion(), resource: MCP_RESOURCE })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual(UNKNOWN_GRANT)
    })

    it("the named client while its row is suspended", async () => {
      const row = db.apps.find((a) => a.client_id === SECRET_CLIENT_ID)!
      row.status = "suspended"
      try {
        const res = await exchange(await signAssertion())
        expect(res.json()).toEqual(UNKNOWN_GRANT)
      } finally {
        row.status = "active"
      }
    })

    it.each([
      ["no client named for the exchange", () => { config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = "" }],
      ["no MCP client list", () => { config.MCP_ALLOWED_CLIENT_IDS = "" }],
    ])("the grant off on the deployment (%s): unknown grant, and the metadata stops naming it", async (_label, turnOff) => {
      const saved = { list: config.MCP_ALLOWED_CLIENT_IDS, exchange: config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS }
      turnOff()
      try {
        const res = await exchange(await signAssertion())
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual(UNKNOWN_GRANT)
        const meta = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" })
        expect(meta.json().grant_types_supported).toEqual(["authorization_code"])
      } finally {
        config.MCP_ALLOWED_CLIENT_IDS = saved.list
        config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = saved.exchange
      }
    })
  })

  describe("refusals of an exchange", () => {
    it("a missing or wrong client secret: invalid_client, and the assertion is not spent", async () => {
      const assertion = await signAssertion({ email: "secret@example.com", sub: "idp-secret" })
      const missing = await exchange(assertion, { client_secret: undefined })
      expect(missing.statusCode).toBe(401)
      expect(missing.json()).toEqual({ error: "invalid_client", error_description: "client_secret is required: the exchange is only for a confidential client." })
      const wrong = await exchange(assertion, { client_secret: "sec_wrong-fake" })
      expect(wrong.statusCode).toBe(401)
      expect(wrong.json()).toEqual({ error: "invalid_client", error_description: "Client authentication failed." })
      expect((await exchange(assertion)).statusCode).toBe(200)
    })

    it.each([
      ["the sign-in audience", { aud: SIGN_IN_AUDIENCE }, "The assertion's claims are invalid: its aud must be the provider's exchangeAudience (and never its sign-in audience), with an exp."],
      ["both audiences in one aud", { aud: [EXCHANGE_AUDIENCE, SIGN_IN_AUDIENCE] }, "The assertion's claims are invalid: its aud must be the provider's exchangeAudience (and never its sign-in audience), with an exp."],
      ["another secret", { secret: "test-only-another-secret-not-real" }, "The assertion's signature or format is invalid: it must be an HS256 JWT signed with the provider's secret."],
      ["expired", { iat: Math.floor(Date.now() / 1000) - 120, expiresIn: Math.floor(Date.now() / 1000) - 60 }, "The assertion has expired."],
      ["a lifetime over the provider's cap", { expiresIn: "1h" }, "The assertion's lifetime (exp - iat) is longer than the provider's maxLifetimeSeconds."],
      ["no jti", { jti: null }, "The assertion has no jti: every assertion needs a unique one."],
    ])("an assertion with %s: invalid_grant", async (_label, opts, description) => {
      const res = await exchange(await signAssertion(opts as never))
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: "invalid_grant", error_description: description })
    })

    it("not a JWT at all: invalid_grant", async () => {
      const res = await exchange(PLACEHOLDER_ASSERTION)
      expect(res.json()).toMatchObject({ error: "invalid_grant" })
    })

    it("a replay: the second use is refused", async () => {
      const assertion = await signAssertion({ email: "replay@example.com", sub: "idp-replay", jti: "jti-replay-1" })
      expect((await exchange(assertion)).statusCode).toBe(200)
      const again = await exchange(assertion)
      expect(again.statusCode).toBe(400)
      expect(again.json()).toEqual({ error: "invalid_grant", error_description: "This assertion was already used: each jti is accepted once." })
    })

    it("a jti is accepted once across the sign-in and the exchange, in both orders", async () => {
      const signIn = await app.inject({ method: "GET", url: `/v1/sso/chat?assertion=${await signAssertion({ aud: SIGN_IN_AUDIENCE, email: "both@example.com", sub: "idp-both", jti: "jti-shared-1" })}` })
      expect(signIn.statusCode, signIn.body).toBe(302)
      const exchanged = await exchange(await signAssertion({ email: "both@example.com", sub: "idp-both", jti: "jti-shared-1" }))
      expect(exchanged.json()).toEqual({ error: "invalid_grant", error_description: "This assertion was already used: each jti is accepted once." })

      expect((await exchange(await signAssertion({ email: "both@example.com", sub: "idp-both", jti: "jti-shared-2" }))).statusCode).toBe(200)
      const signInAfter = await app.inject({ method: "GET", url: `/v1/sso/chat?assertion=${await signAssertion({ aud: SIGN_IN_AUDIENCE, email: "both@example.com", sub: "idp-both", jti: "jti-shared-2" })}` })
      expect(signInAfter.statusCode).toBe(401)
      expect(signInAfter.json()).toEqual({ error: { code: "assertion_replayed" } })
    })

    it("an unknown subject the sign-in would not provision, and every refused account, look the same", async () => {
      harness.seedAccount({ email: "local@example.com" })
      harness.seedAccount({ email: "elsewhere@example.com", user_metadata: { sso: "another-idp" }, app_metadata: { sso: "another-idp" } })
      const blocked = harness.seedAccount({ email: "blocked@example.com", user_metadata: { sso: PROVIDER_ID }, app_metadata: { sso: PROVIDER_ID, sso_subject: "idp-blocked" } })
      fake.blocked.add(blocked.id)
      const answers = [
        await exchange(await signAssertion({ email: "unverified.new@example.com", emailVerified: false })),
        await exchange(await signAssertion({ email: "local@example.com" })),
        await exchange(await signAssertion({ email: "elsewhere@example.com" })),
        await exchange(await signAssertion({ email: "blocked@example.com", sub: "idp-blocked" })),
      ]
      for (const res of answers) {
        expect(res.statusCode).toBe(400)
        expect(res.json()).toEqual(NO_ACCOUNT)
      }
      expect(harness.created.some((u) => u.email === "unverified.new@example.com")).toBe(false)
    })

    it("a scope wider than the client's, or not a scope: invalid_scope", async () => {
      for (const scope of ["jobs:read workflows:write", "credits:read", "nonsense", " "]) {
        const res = await exchange(await signAssertion(), { scope })
        expect(res.statusCode, scope).toBe(400)
        expect(res.json()).toMatchObject({ error: "invalid_scope" })
      }
    })

    it("a resource that is not this deployment's MCP endpoint, or none: invalid_target", async () => {
      for (const resource of [undefined, "https://app.example.com/v1", "https://elsewhere.example/mcp", `${MCP_RESOURCE}?x=1`]) {
        const res = await exchange(await signAssertion(), { resource })
        expect(res.statusCode, String(resource)).toBe(400)
        expect(res.json()).toEqual({ error: "invalid_target", error_description: `resource must name this deployment's MCP endpoint: ${MCP_RESOURCE}` })
      }
      expect((await exchange(await signAssertion({ email: "slash@example.com", sub: "idp-slash" }), { resource: `${MCP_RESOURCE}/` })).statusCode).toBe(200)
    })

    it("an assertion in the query string is never read: invalid_request", async () => {
      const assertion = await signAssertion()
      const res = await exchangeRequest(app, { client_id: SECRET_CLIENT_ID, client_secret: TOKEN_WALK_SECRET, resource: MCP_RESOURCE }, { query: `?assertion=${assertion}` })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: "invalid_request", error_description: "assertion is required, in the request body" })
    })

    it("a store that cannot be reached: 503, nothing issued", async () => {
      redis.state.fail = true
      const tokens = db.tokens.length
      const res = await exchange(await signAssertion())
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: "temporarily_unavailable", error_description: "The exchange cannot be checked right now. Try again in a moment." })
      expect(db.tokens.length).toBe(tokens)
    })
  })

  describe("the sign-in, beside it", () => {
    it("refuses an exchange assertion, and still signs a person in with its own", async () => {
      const refused = await app.inject({ method: "GET", url: `/v1/sso/chat?assertion=${await signAssertion({ aud: EXCHANGE_AUDIENCE, email: "door@example.com", sub: "idp-door" })}` })
      expect(refused.statusCode).toBe(401)
      expect(refused.json()).toEqual({ error: { code: "invalid_claims" } })
      const both = await app.inject({ method: "GET", url: `/v1/sso/chat?assertion=${await signAssertion({ aud: [SIGN_IN_AUDIENCE, EXCHANGE_AUDIENCE], email: "door@example.com", sub: "idp-door" })}` })
      expect(both.statusCode).toBe(401)
      const ok = await app.inject({ method: "GET", url: `/v1/sso/chat?assertion=${await signAssertion({ aud: SIGN_IN_AUDIENCE, email: "door@example.com", sub: "idp-door" })}` })
      expect(ok.statusCode).toBe(302)
      expect(ok.headers.location).toBe("https://app.example.com/sso?sso_token=one-time-login-token&next=%2Fprojects")
    })
  })
})
