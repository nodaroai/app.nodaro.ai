import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { Writable } from "node:stream"

/**
 * The exchange's own decisions, with its collaborators stood in for
 * (decided 2026-11-11): every account outcome answers one body; the order of
 * the checks (the network limit before the secret, the client's allowance
 * only after it); a store that cannot be reached fails closed; a database
 * without the grant-type column issues nothing; and exactly one log line per
 * exchange, carrying the client id and the outcome and never the assertion,
 * the secret or the token. The booted flow is oauth-assertion-exchange.test.ts.
 */

const CLIENT = `app_${"5".repeat(32)}`
const SECRET = "sec_test-only-not-a-real-client-secret"
const ASSERTION = "header.payload.signature-placeholder"
const TOKEN = `ndr_app_${"ab".repeat(32)}`

const state = vi.hoisted(() => ({
  redeem: null as unknown,
  redeemThrows: false,
  network: { ok: true } as { ok: boolean; retryAfterSec?: number },
  client: { ok: true } as { ok: boolean; retryAfterSec?: number },
  limitsThrow: false,
  mint: null as unknown,
  provider: { id: "chat", kind: "assertion", exchangeAudience: "nodaro-mcp-exchange" } as unknown,
  calls: { secret: 0, client: 0, redeem: 0, mint: [] as unknown[] },
}))

vi.mock("../../lib/supabase.js", () => ({ supabase: {} }))
vi.mock("../developer-apps.js", () => ({
  findAppByClientId: async (id: string) =>
    id === `app_${"5".repeat(32)}`
      ? { id: "dapp-1", client_id: id, client_secret_hash: "bcrypt-hash-placeholder", scopes_requested: ["jobs:read", "assets:read"], status: "active", kind: "user", redirect_uris: [] }
      : null,
  verifyClientSecret: async (_hash: string, secret: string) => {
    state.calls.secret += 1
    return secret === "sec_test-only-not-a-real-client-secret"
  },
}))
vi.mock("../../lib/assertion-exchange-limits.js", () => ({
  takeNetworkAllowance: async () => {
    if (state.limitsThrow) throw new Error("redis unreachable")
    return state.network
  },
  takeClientAllowance: async () => {
    state.calls.client += 1
    if (state.limitsThrow) throw new Error("redis unreachable")
    return state.client
  },
}))
vi.mock("../../lib/sso-redeem.js", () => ({
  redeemAssertion: async () => {
    state.calls.redeem += 1
    if (state.redeemThrows) throw new Error("redis unreachable")
    return state.redeem
  },
}))
vi.mock("../../lib/oauth-tokens.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/oauth-tokens.js")>()
  return {
    ...actual,
    mintAppAccessToken: async (input: unknown) => {
      state.calls.mint.push(input)
      return state.mint
    },
  }
})
vi.mock("../../lib/sso-providers.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/sso-providers.js")>()
  return { ...actual, exchangeProvider: () => state.provider }
})

import { config } from "../../lib/config.js"
import { oauthRoutes } from "../oauth.js"
import { mcpEndpointOfRequest } from "../../lib/mcp-assertion-exchange.js"

const saved = { list: config.MCP_ALLOWED_CLIENT_IDS, exchange: config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS }
let lines: string[]
let app: FastifyInstance
const NO_ACCOUNT = { error: "invalid_grant", error_description: "The assertion does not name a person this application can obtain a token for." }

beforeEach(async () => {
  config.MCP_ALLOWED_CLIENT_IDS = CLIENT
  config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = CLIENT
  state.provider = { id: "chat", kind: "assertion", exchangeAudience: "nodaro-mcp-exchange" }
  Object.assign(state, { redeem: { ok: true, userId: "user-1", email: "a@example.com", action: "linked" }, redeemThrows: false, network: { ok: true }, client: { ok: true }, limitsThrow: false })
  state.mint = { ok: true, accessToken: TOKEN, tokenType: "Bearer", scope: "jobs:read assets:read", expiresIn: 3600 }
  state.calls = { secret: 0, client: 0, redeem: 0, mint: [] }
  lines = []
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk))
      done()
    },
  })
  app = Fastify({ logger: { level: "info", stream } })
  await app.register(oauthRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  config.MCP_ALLOWED_CLIENT_IDS = saved.list
  config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = saved.exchange
})

const resource = () => mcpEndpointOfRequest({ headers: {} })
const exchange = (over: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/v1/oauth/token",
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", client_id: CLIENT, client_secret: SECRET, assertion: ASSERTION, resource: resource(), ...over },
  })
const exchangeLines = () => lines.filter((l) => l.includes("[oauth] assertion exchange"))

describe("every account outcome reads the same from outside", () => {
  it.each([
    ["an unverified address with no account", { ok: false, reason: "link", code: "email_unverified", message: "The identity provider did not assert a verified email address." }],
    ["an existing account the provider may not take", { ok: false, reason: "link", code: "account_exists", message: "An account with this email already exists and is not linked to this identity provider." }],
    ["an account linked to another provider", { ok: false, reason: "link", code: "account_linked_other_provider", message: "This email is already linked to a different identity provider." }],
    ["the billing account, asserted with another subject", { ok: false, reason: "link", code: "account_linked_other_subject", message: "This account is linked to a different identity at this identity provider." }],
    ["an operator address (refused as account_exists)", { ok: false, reason: "link", code: "account_exists", message: "An account with this email already exists and is not linked to this identity provider." }],
    ["a lost provisioning race", { ok: false, reason: "link", code: "account_exists", message: "Could not provision an account for this email." }],
    ["a blocked account", { ok: false, reason: "blocked" }],
  ])("%s", async (_label, outcome) => {
    state.redeem = outcome
    const res = await exchange()
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual(NO_ACCOUNT)
    expect(state.calls.mint).toHaveLength(0)
  })

  it("a grant the person revoked", async () => {
    state.mint = { ok: false, failed: "revoked" }
    const res = await exchange()
    expect(res.json()).toEqual(NO_ACCOUNT)
  })
})

describe("the order of the checks", () => {
  it("over the network's limit: 429 with Retry-After, before the secret is checked", async () => {
    state.network = { ok: false, retryAfterSec: 42 }
    const res = await exchange()
    expect(res.statusCode).toBe(429)
    expect(res.headers["retry-after"]).toBe("42")
    expect(res.json()).toEqual({ error: "slow_down", error_description: "Too many exchanges from this network. Try again later." })
    expect(state.calls.secret).toBe(0)
    expect(state.calls.redeem).toBe(0)
  })

  it("a wrong secret never counts against the client's allowance, nor reaches the assertion", async () => {
    const res = await exchange({ client_secret: "sec_wrong-fake" })
    expect(res.statusCode).toBe(401)
    expect(state.calls.client).toBe(0)
    expect(state.calls.redeem).toBe(0)
  })

  it("over the client's limit: 429, after the secret, before the assertion", async () => {
    state.client = { ok: false, retryAfterSec: 7 }
    const res = await exchange()
    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({ error: "slow_down", error_description: "Too many exchanges for this client. Try again later." })
    expect(state.calls.secret).toBe(1)
    expect(state.calls.redeem).toBe(0)
  })

  it("a bad scope or resource is refused before the assertion is redeemed (its jti is not spent)", async () => {
    expect((await exchange({ scope: "workflows:write" })).json()).toMatchObject({ error: "invalid_scope" })
    expect((await exchange({ resource: "https://elsewhere.example/mcp" })).json()).toMatchObject({ error: "invalid_target" })
    expect(state.calls.redeem).toBe(0)
  })

  it("the token is minted for the redeemed person, with the client's scopes and the configured lifetime", async () => {
    const res = await exchange({ scope: "jobs:read" })
    expect(res.statusCode).toBe(200)
    expect(state.calls.mint).toEqual([{ appId: "dapp-1", userId: "user-1", scopes: ["jobs:read"], assertionExchange: { ttlSeconds: 3600 } }])
  })
})

describe("fails closed", () => {
  it.each([
    ["the limiter's store", () => { state.limitsThrow = true }],
    ["the jti store", () => { state.redeemThrows = true }],
  ])("%s cannot be reached: 503 temporarily_unavailable", async (_label, fail) => {
    fail()
    const res = await exchange()
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: "temporarily_unavailable", error_description: "The exchange cannot be checked right now. Try again in a moment." })
    expect(state.calls.mint).toHaveLength(0)
  })

  it("a database without migration 651: 500, nothing issued, and the log says why", async () => {
    state.mint = { ok: false, failed: "not_migrated" }
    const res = await exchange()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: "server_error", error_description: "Failed to issue the token." })
    const [line] = exchangeLines()
    expect(JSON.parse(line!)).toMatchObject({ level: 40, oauthAssertionExchange: { clientId: CLIENT, outcome: "mint_failed_not_migrated" } })
  })
})

describe("the log", () => {
  it("one line per exchange — the client id and the outcome — and never the assertion, the secret or the token", async () => {
    const issued = await exchange()
    expect(issued.statusCode).toBe(200)
    expect(issued.json().access_token).toBe(TOKEN)
    await exchange({ client_secret: "sec_wrong-fake" })
    state.redeem = { ok: false, reason: "replayed" }
    await exchange()
    const parsed = exchangeLines().map((l) => JSON.parse(l) as { oauthAssertionExchange: Record<string, unknown> })
    expect(parsed.map((l) => l.oauthAssertionExchange)).toEqual([
      { clientId: CLIENT, outcome: "issued", userId: "user-1" },
      { clientId: CLIENT, outcome: "invalid_client" },
      { clientId: CLIENT, outcome: "assertion_replayed" },
    ])
    const all = lines.join("\n")
    for (const secret of [ASSERTION, SECRET, TOKEN, "sec_wrong-fake"]) expect(all).not.toContain(secret)
  })

  it("a request that is not an exchange logs nothing of the exchange", async () => {
    config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = ""
    const res = await exchange()
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: "invalid_request", error_description: 'Invalid input: expected "authorization_code"' })
    expect(exchangeLines()).toEqual([])
    expect(state.calls.secret).toBe(0)
  })
})

describe("boot", () => {
  it("clients named for the exchange with no provider to exchange from stop the registration", async () => {
    state.provider = null
    const fresh = Fastify()
    await expect(fresh.register(oauthRoutes)).rejects.toThrow(/no EXTERNAL_SSO_PROVIDERS entry of kind "assertion" sets an "exchangeAudience"/)
    await fresh.close()
  })
})
