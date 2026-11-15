import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The exchange's on/off rule (lib/mcp-assertion-exchange.ts, decided
 * 2026-11-11): on for a client only when the MCP list is set, the client is
 * named for the exchange and may use MCP, and one provider has an exchange
 * audience. Every half-configuration is "off".
 */

const providers = vi.hoisted(() => ({ exchange: null as unknown }))
vi.mock("../sso-providers.js", async (orig) => {
  const actual = await orig<typeof import("../sso-providers.js")>()
  return { ...actual, exchangeProvider: () => providers.exchange }
})

import { config } from "../config.js"
import {
  assertionExchangeBootProblem,
  assertionExchangeOn,
  assertionExchangeProvider,
  assertionExchangeTokenTtlSeconds,
  clientIdNamedForExchange,
  clientMayExchange,
  mcpEndpointOfRequest,
  resourceNamesThisMcpEndpoint,
} from "../mcp-assertion-exchange.js"

const OWN = `app_${"1".repeat(32)}`
const OTHER = `app_${"2".repeat(32)}`
const PROVIDER = { id: "chat", kind: "assertion", exchangeAudience: "nodaro-mcp-exchange" }
const ROW = { client_id: OWN, kind: "user", status: "active" }

const saved = { list: config.MCP_ALLOWED_CLIENT_IDS, exchange: config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS, ttl: config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS }

beforeEach(() => {
  config.MCP_ALLOWED_CLIENT_IDS = `${OWN},${OTHER}`
  config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = OWN
  providers.exchange = PROVIDER
})

afterEach(() => {
  config.MCP_ALLOWED_CLIENT_IDS = saved.list
  config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = saved.exchange
  config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS = saved.ttl
})

describe("on, and only for the named client", () => {
  it("fully configured: on for the named, listed, active client the deployment set up", () => {
    expect(assertionExchangeOn()).toBe(true)
    expect(assertionExchangeProvider()).toBe(PROVIDER)
    expect(clientIdNamedForExchange(OWN)).toBe(true)
    expect(clientMayExchange(ROW)).toBe(true)
  })

  it("a second listed client is not named: off for it", () => {
    expect(clientIdNamedForExchange(OTHER)).toBe(false)
    expect(clientMayExchange({ ...ROW, client_id: OTHER })).toBe(false)
  })

  it("the named client's row may not use MCP (suspended, self-registered kind): off for it", () => {
    for (const change of [{ status: "suspended" }, { kind: "dynamic_mcp" }, { kind: "community_instance" }]) {
      expect(clientMayExchange({ ...ROW, ...change }), JSON.stringify(change)).toBe(false)
    }
  })

  it.each([
    ["no exchange client named", () => { config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = "" }],
    ["no MCP client list", () => { config.MCP_ALLOWED_CLIENT_IDS = "" }],
    ["no provider with an exchange audience", () => { providers.exchange = null }],
    ["a named client the MCP list dropped", () => { config.MCP_ALLOWED_CLIENT_IDS = OTHER }],
  ])("%s: off", (_label, change) => {
    change()
    expect(clientMayExchange(ROW)).toBe(false)
  })

  it("off at the deployment level whenever a deployment-wide lever is missing", () => {
    config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = ""
    expect(assertionExchangeOn()).toBe(false)
    config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = OWN
    config.MCP_ALLOWED_CLIENT_IDS = ""
    expect(assertionExchangeOn()).toBe(false)
    config.MCP_ALLOWED_CLIENT_IDS = OWN
    providers.exchange = null
    expect(assertionExchangeOn()).toBe(false)
    expect(clientIdNamedForExchange(42)).toBe(false)
  })
})

describe("boot", () => {
  it("named clients without a provider stop the boot; a provider without named clients is a valid off", () => {
    providers.exchange = null
    expect(assertionExchangeBootProblem()).toMatch(/no EXTERNAL_SSO_PROVIDERS entry of kind "assertion" sets an "exchangeAudience"/)
    config.MCP_ASSERTION_EXCHANGE_CLIENT_IDS = ""
    expect(assertionExchangeBootProblem()).toBeNull()
    providers.exchange = PROVIDER
    expect(assertionExchangeBootProblem()).toBeNull()
  })
})

describe("the token's lifetime", () => {
  it("reads the setting, and falls back to one hour on a value the boot would refuse", () => {
    config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS = 900
    expect(assertionExchangeTokenTtlSeconds()).toBe(900)
    config.MCP_ASSERTION_EXCHANGE_TOKEN_TTL_SECONDS = 90 * 24 * 3600
    expect(assertionExchangeTokenTtlSeconds()).toBe(3600)
  })
})

describe("resource", () => {
  const req = { headers: {} }
  it("names the MCP endpoint the request's lane states, a trailing slash aside", () => {
    const endpoint = mcpEndpointOfRequest(req)
    expect(resourceNamesThisMcpEndpoint(req, endpoint)).toBe(true)
    expect(resourceNamesThisMcpEndpoint(req, `${endpoint}/`)).toBe(true)
    expect(resourceNamesThisMcpEndpoint(req, [endpoint, `${endpoint}/`])).toBe(true)
  })

  it("refuses anything else: missing, another path or host, a query or fragment, credentials, not a URL, a mixed list", () => {
    const endpoint = mcpEndpointOfRequest(req)
    const url = new URL(endpoint)
    for (const value of [
      undefined,
      "",
      [],
      `${url.origin}/v1`,
      `${url.origin}${url.pathname}x`,
      `https://elsewhere.example${url.pathname}`,
      `${endpoint}?a=1`,
      `${endpoint}#x`,
      `${url.protocol}//user:pw@${url.host}${url.pathname}`,
      "not a url",
      [endpoint, `${url.origin}/v1`],
      42,
    ]) {
      expect(resourceNamesThisMcpEndpoint(req, value), JSON.stringify(value)).toBe(false)
    }
  })
})
