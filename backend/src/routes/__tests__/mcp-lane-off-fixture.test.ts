// @test-watches backend/src/routes/__tests__/fixtures/mcp-lane-off.json
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The MCP lane with path mode OFF answers byte for byte what it answered before
 * path mode existed (decided 2026-11-11: the hosted product keeps its dedicated
 * MCP host and changes nothing).
 *
 * The fixture was RECORDED from the code before path mode was added, by booting
 * the whole app and asking every address an MCP client meets during sign-in —
 * the MCP endpoint without a token, both metadata documents and their
 * path-suffixed variants, the OAuth endpoints — on the dedicated `mcp.` host,
 * on the primary host, on a host the install declares as its own, and on one it
 * does not. Re-record only on purpose: `MCP_LANE_FIXTURE_RECORD=1`.
 *
 * Every case runs twice: with no surface profile, and with a profile that sets
 * other keys and `mcp.byPath: false` — neither may change a byte.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "allowlist"
  process.env.MCP_DCR_ALLOWLIST = "Claude,Cursor"
  process.env.PUBLIC_URL = "https://app.nodaro.ai"
  process.env.MCP_PUBLIC_URL = ""
  process.env.CORS_ORIGIN = "https://studio.example.com,https://alt.example.org"
  process.env.FLOW_PUBLIC_URL = ""
  process.env.FLOW_UI_ORIGIN = ""
  process.env.LEGACY_UI_HOSTS = ""
  delete process.env.NODARO_SURFACE_PROFILE
})

vi.mock("../../lib/supabase.js", () => {
  // One chain for every read: any filter returns the chain, every terminal
  // answers "no row" (an unknown client, no token row, no open registrations).
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "gte", "in", "order", "limit", "neq", "update", "overlaps"]) {
    chain[m] = vi.fn(() => chain)
  }
  chain.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: 0 })
  const insertChain = {
    select: vi.fn(() => ({
      single: vi.fn(() =>
        Promise.resolve({
          data: { id: "00000000-0000-0000-0000-000000000001", client_id: "ndr_dcr_fixture_client", created_at: "2026-11-11T00:00:00.000Z" },
          error: null,
        }),
      ),
    })),
  }
  return {
    supabase: {
      from: vi.fn(() => ({ ...chain, insert: vi.fn(() => insertChain) })),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  }
})

import { buildApp } from "../../app.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, "fixtures/mcp-lane-off.json")
const RECORD = process.env.MCP_LANE_FIXTURE_RECORD === "1"

const HOSTS = ["mcp.nodaro.ai", "app.nodaro.ai", "studio.example.com", "unlisted.example.net"] as const

interface Probe {
  name: string
  method: "GET" | "POST"
  url: string
  headers?: Record<string, string>
  payload?: unknown
}

const AUTHORIZE_QUERY =
  "?response_type=code&client_id=ndr_dcr_x&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&state=s1" +
  "&code_challenge=" + "a".repeat(43) + "&code_challenge_method=S256&resource=https%3A%2F%2Fmcp.nodaro.ai%2Fmcp"

const PROBES: Probe[] = [
  { name: "POST /mcp (no token)", method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", method: "initialize", id: 1 } },
  { name: "GET /mcp (no token)", method: "GET", url: "/mcp" },
  { name: "POST /mcp (unknown token)", method: "POST", url: "/mcp", headers: { authorization: "Bearer ndr_app_unknown" }, payload: { jsonrpc: "2.0", method: "initialize", id: 1 } },
  { name: "POST /v1/mcp (no token)", method: "POST", url: "/v1/mcp", payload: { jsonrpc: "2.0", method: "initialize", id: 1 } },
  { name: "GET /.well-known/oauth-authorization-server", method: "GET", url: "/.well-known/oauth-authorization-server" },
  { name: "GET /.well-known/oauth-protected-resource", method: "GET", url: "/.well-known/oauth-protected-resource" },
  { name: "GET /.well-known/oauth-protected-resource/mcp", method: "GET", url: "/.well-known/oauth-protected-resource/mcp" },
  { name: "GET /.well-known/oauth-authorization-server/mcp", method: "GET", url: "/.well-known/oauth-authorization-server/mcp" },
  { name: "GET /.well-known/oauth-protected-resource/v1/mcp", method: "GET", url: "/.well-known/oauth-protected-resource/v1/mcp" },
  { name: "GET /.well-known/oauth-authorization-server/v1/mcp", method: "GET", url: "/.well-known/oauth-authorization-server/v1/mcp" },
  { name: "GET /v1/oauth/authorize", method: "GET", url: `/v1/oauth/authorize${AUTHORIZE_QUERY}` },
  { name: "POST /v1/oauth/authorize (no session)", method: "POST", url: "/v1/oauth/authorize", payload: { clientId: "ndr_dcr_x", redirectUri: "https://client.example/cb", scopes: ["jobs:read"] } },
  { name: "POST /v1/oauth/register", method: "POST", url: "/v1/oauth/register", payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] } },
  { name: "POST /v1/oauth/register (not allowlisted)", method: "POST", url: "/v1/oauth/register", payload: { client_name: "Someone", redirect_uris: ["https://x.example/cb"] } },
  {
    name: "POST /v1/oauth/token (form)",
    method: "POST",
    url: "/v1/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "grant_type=authorization_code&client_id=ndr_dcr_x&code=c&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&code_verifier=" + "v".repeat(43),
  },
  { name: "POST /v1/oauth/revoke", method: "POST", url: "/v1/oauth/revoke", payload: { token: "ndr_app_x" } },
  { name: "GET /v1/oauth/app-info", method: "GET", url: "/v1/oauth/app-info?client_id=ndr_dcr_x" },
  { name: "POST /v1/upload-page (bad token)", method: "POST", url: "/v1/upload-page/not-a-token" },
  { name: "GET /v1/upload-page (bad token)", method: "GET", url: "/v1/upload-page/not-a-token" },
]

/** Headers that vary per run (clock, per-request ids, rate-limit windows). */
const VOLATILE_HEADERS = new Set(["date", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after", "connection", "keep-alive"])

function scrubBody(name: string, body: string): string {
  // The one random value in any of these answers: a freshly minted client secret.
  if (name.startsWith("POST /v1/oauth/register")) return body.replace(/"client_secret":"[0-9a-f]{64}"/, '"client_secret":"<random>"')
  return body
}

interface Recorded {
  status: number
  headers: Record<string, string>
  body: string
}

async function capture(app: FastifyInstance, probe: Probe, host: string, extraHeaders: Record<string, string> = {}): Promise<Recorded> {
  const res = await app.inject({
    method: probe.method,
    url: probe.url,
    headers: { host, ...(probe.headers ?? {}), ...extraHeaders },
    ...(probe.payload === undefined ? {} : { payload: probe.payload as string }),
  })
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.headers).sort(([a], [b]) => a.localeCompare(b))) {
    if (VOLATILE_HEADERS.has(k)) continue
    headers[k] = Array.isArray(v) ? v.join(", ") : String(v)
  }
  return { status: res.statusCode, headers, body: scrubBody(probe.name, res.body) }
}

async function captureAll(app: FastifyInstance): Promise<Record<string, Recorded>> {
  const out: Record<string, Recorded> = {}
  for (const host of HOSTS) {
    for (const probe of PROBES) {
      out[`${host} ${probe.name}`] = await capture(app, probe, host)
    }
  }
  // A forwarded host never changes an answer while path mode is off.
  for (const probe of PROBES) {
    out[`app.nodaro.ai + x-forwarded-host studio.example.com ${probe.name}`] = await capture(app, probe, "app.nodaro.ai", {
      "x-forwarded-host": "studio.example.com",
    })
  }
  return out
}

describe("MCP lane with path mode off — byte-identical to before path mode", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
  })

  it("matches the recorded answers with no surface profile", async () => {
    delete process.env.NODARO_SURFACE_PROFILE
    __resetSurfaceProfileCacheForTests()
    const answers = await captureAll(app)
    if (RECORD || !existsSync(FIXTURE)) {
      if (!RECORD) throw new Error(`missing fixture ${FIXTURE}: record it with MCP_LANE_FIXTURE_RECORD=1 on the code before the change`)
      writeFileSync(FIXTURE, `${JSON.stringify(answers, null, 2)}\n`)
      return
    }
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, Recorded>
    expect(Object.keys(answers)).toEqual(Object.keys(recorded))
    for (const key of Object.keys(recorded)) expect(answers[key], key).toEqual(recorded[key])
  }, 120_000)

  // The routes are registered at boot from the profile, so each profile gets an
  // app booted with it — asking the first app again would prove nothing about
  // which routes exist.
  it("matches the recorded answers on an app booted with a profile that leaves path mode off", async () => {
    if (RECORD) return
    const profiles = [
      { brand: { productName: "Acme" } },
      { brand: { productName: "Acme" }, mcp: { byPath: false, path: "/v1/mcp" } },
      { brand: { productName: "Acme" }, mcp: { path: "/v1/mcp" } },
      { brand: { productName: "Acme" }, mcp: { byPath: "maybe" } },
    ]
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, Recorded>
    for (const profile of profiles) {
      process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
      __resetSurfaceProfileCacheForTests()
      const booted = await buildApp()
      try {
        const answers = await captureAll(booted)
        for (const key of Object.keys(recorded)) expect(answers[key], `${JSON.stringify(profile)} ${key}`).toEqual(recorded[key])
      } finally {
        await booted.close()
      }
    }
  }, 240_000)
})
