import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the route module
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  config: {
    EDITION: "cloud",
    PUBLIC_URL: "https://nodaro.test",
    FIGMA_PLUGIN_OAUTH_CLIENT_ID: "app_figma",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  store: new Map<string, string>(),
}))

vi.mock("@/lib/config.js", () => ({
  config: mocks.config,
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/queue.js", () => ({
  redis: {
    get: vi.fn(async (key: string) => mocks.store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      mocks.store.set(key, value)
      return "OK"
    }),
    del: vi.fn(async (key: string) => (mocks.store.delete(key) ? 1 : 0)),
  },
}))

vi.mock("@/lib/oauth-codes.js", () => ({
  issueCode: vi.fn(),
  redeemCode: vi.fn(),
}))

vi.mock("@/lib/oauth-tokens.js", () => ({
  mintAppAccessToken: vi.fn(),
}))

vi.mock("@/routes/developer-apps.js", () => ({
  findAppByClientId: vi.fn(),
  verifyClientSecret: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { oauthPluginConnectRoutes, PLUGIN_SCOPES, POLL_KEY_HEADER, pluginCallbackUrl } from "../oauth-plugin-connect.js"
import { findAppByClientId } from "../developer-apps.js"
import { redeemCode } from "../../lib/oauth-codes.js"
import { mintAppAccessToken } from "../../lib/oauth-tokens.js"
import { USER_CODE_MAX_ATTEMPTS } from "../../lib/plugin-connect.js"

const CALLBACK = "https://nodaro.test/v1/oauth/plugin/callback"

const PLUGIN_APP = {
  id: "dapp-figma",
  client_id: "app_figma",
  redirect_uris: [CALLBACK],
  scopes_requested: [...PLUGIN_SCOPES, "workflows:read"],
  kind: "user",
  status: "active",
}

const PLUGIN_GRANT = { appId: PLUGIN_APP.id, userId: "user-1", scopes: [...PLUGIN_SCOPES], redirectUri: CALLBACK }

const MINTED = {
  ok: true as const,
  accessToken: "ndr_app_minted",
  tokenType: "Bearer" as const,
  scope: PLUGIN_SCOPES.join(" "),
  expiresIn: 7776000,
}

let app: FastifyInstance

interface Session {
  sessionId: string
  pollKey: string
  userCode: string
  authorizeUrl: string
  expiresIn: number
}

async function openSession(): Promise<Session> {
  const res = await app.inject({ method: "POST", url: "/v1/oauth/plugin/session", payload: { client: "figma" } })
  expect(res.statusCode).toBe(200)
  return res.json() as Session
}

function callback(query: string) {
  return app.inject({ method: "GET", url: `/v1/oauth/plugin/callback?${query}` })
}

function confirm(state: string, code: string) {
  return app.inject({ method: "POST", url: "/v1/oauth/plugin/confirm", payload: { state, code } })
}

function poll(sessionId: string, pollKey: string) {
  return app.inject({ method: "GET", url: `/v1/oauth/plugin/session/${sessionId}`, headers: { [POLL_KEY_HEADER]: pollKey } })
}

/** Walks a session through consent to the code form, with a code issued to the plugin's app. */
async function consented(): Promise<Session> {
  const session = await openSession()
  vi.mocked(redeemCode).mockReturnValue({ ...PLUGIN_GRANT })
  const res = await callback(`state=${session.sessionId}&code=ndr_code_good`)
  expect(res.statusCode).toBe(200)
  expect(res.body).toContain('name="code"')
  return session
}

const expectHtml = (res: { headers: Record<string, unknown> }) => {
  expect(String(res.headers["content-type"])).toContain("text/html")
  expect(String(res.headers["cache-control"])).toBe("no-store")
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.store.clear()
  mocks.config.FIGMA_PLUGIN_OAUTH_CLIENT_ID = "app_figma"
  vi.mocked(findAppByClientId).mockResolvedValue(PLUGIN_APP as never)
  vi.mocked(mintAppAccessToken).mockResolvedValue(MINTED)

  app = Fastify({ logger: false })
  await app.register(oauthPluginConnectRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("POST /v1/oauth/plugin/session", () => {
  it("answers 503 plugin_connect_not_configured when no client id is set, before any lookup", async () => {
    mocks.config.FIGMA_PLUGIN_OAUTH_CLIENT_ID = ""
    const res = await app.inject({ method: "POST", url: "/v1/oauth/plugin/session", payload: { client: "figma" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("plugin_connect_not_configured")
    expect(findAppByClientId).not.toHaveBeenCalled()
  })

  it("rejects an unknown client name", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/oauth/plugin/session", payload: { client: "sketch" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it.each([
    ["the app is unknown or suspended", null],
    ["the callback is not in redirect_uris", { ...PLUGIN_APP, redirect_uris: ["https://elsewhere.test/cb"] }],
    ["a plugin scope is not in scopes_requested", { ...PLUGIN_APP, scopes_requested: ["jobs:read"] }],
    ["a DCR-registered app is missing a scope — no exemption", { ...PLUGIN_APP, kind: "dynamic_mcp", scopes_requested: ["jobs:read"] }],
  ])("answers 503 plugin_connect_misconfigured when %s, and says nothing about why", async (_why, dApp) => {
    vi.mocked(findAppByClientId).mockResolvedValue(dApp as never)
    const res = await app.inject({ method: "POST", url: "/v1/oauth/plugin/session", payload: { client: "figma" } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("plugin_connect_misconfigured")
    expect(res.body).not.toContain("redirect_uris")
    expect(res.body).not.toContain("scopes_requested")
    expect(mocks.store.size).toBe(0)
  })

  it("opens a session and points the user at the consent screen with the session as state", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/oauth/plugin/session", payload: { client: "figma" } })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers["cache-control"])).toBe("no-store")
    const session = res.json() as Session
    expect(session.sessionId).toMatch(/^pcs_[0-9a-f]{48}$/)
    expect(session.pollKey).toBeTruthy()
    expect(session.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(session.expiresIn).toBe(600)

    const url = new URL(session.authorizeUrl)
    expect(`${url.origin}${url.pathname}`).toBe("https://nodaro.test/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("app_figma")
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("scope")).toBe(PLUGIN_SCOPES.join(" "))
    expect(url.searchParams.get("state")).toBe(session.sessionId)
    expect(url.searchParams.has("code_challenge")).toBe(false)
    expect(pluginCallbackUrl()).toBe(CALLBACK)
  })
})

describe("GET /v1/oauth/plugin/session/:id", () => {
  it("requires the poll key header and a well-formed id", async () => {
    const session = await openSession()
    expect((await app.inject({ method: "GET", url: `/v1/oauth/plugin/session/${session.sessionId}` })).statusCode).toBe(400)
    expect((await poll("not-a-session-id", session.pollKey)).statusCode).toBe(400)
  })

  it("answers 404 for a wrong key and for an unknown session alike, and pending otherwise", async () => {
    const session = await openSession()
    expect((await poll(session.sessionId, "wrong")).statusCode).toBe(404)
    expect((await poll("pcs_" + "0".repeat(48), session.pollKey)).statusCode).toBe(404)
    const pending = await poll(session.sessionId, session.pollKey)
    expect(pending.json()).toEqual({ status: "pending" })
    expect(String(pending.headers["cache-control"])).toBe("no-store")
  })
})

describe("GET /v1/oauth/plugin/callback", () => {
  it("shows the expired page for an unknown state, and touches neither the code nor a token", async () => {
    const res = await callback(`state=pcs_${"0".repeat(48)}&code=ndr_code_x`)
    expect(res.statusCode).toBe(400)
    expectHtml(res)
    expect(res.body).toContain("expired")
    expect(redeemCode).not.toHaveBeenCalled()
    expect(mintAppAccessToken).not.toHaveBeenCalled()
  })

  it("rejects a malformed state without reaching the store", async () => {
    const res = await callback(`state=<script>&code=ndr_code_x`)
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain("<script>")
  })

  it("records a declined consent, and the plugin learns it once", async () => {
    const session = await openSession()
    const res = await callback(`state=${session.sessionId}&error=access_denied&error_description=User+cancelled`)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain("declined")
    expect(res.body).not.toContain("User cancelled")
    expect(redeemCode).not.toHaveBeenCalled()
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "denied" })
    expect((await poll(session.sessionId, session.pollKey)).statusCode).toBe(404)
  })

  it("shows the expired page when the code cannot be redeemed against the callback URL", async () => {
    const session = await openSession()
    vi.mocked(redeemCode).mockReturnValue(null)
    const res = await callback(`state=${session.sessionId}&code=ndr_code_stale`)
    expect(res.statusCode).toBe(400)
    expect(redeemCode).toHaveBeenCalledWith("ndr_code_stale", CALLBACK)
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "pending" })
  })

  it("refuses a code issued to a different app, even one that registered our callback", async () => {
    const session = await openSession()
    vi.mocked(redeemCode).mockReturnValue({ ...PLUGIN_GRANT, appId: "dapp-other" })
    const res = await callback(`state=${session.sessionId}&code=ndr_code_other`)
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("not right")
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "pending" })
  })

  it("refuses a code carrying scopes outside the plugin's set — a hand-built consent URL", async () => {
    const session = await openSession()
    vi.mocked(redeemCode).mockReturnValue({ ...PLUGIN_GRANT, scopes: [...PLUGIN_SCOPES, "workflows:read"] })
    const res = await callback(`state=${session.sessionId}&code=ndr_code_wide`)
    expect(res.statusCode).toBe(400)
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "pending" })
    expect((await confirm(session.sessionId, session.userCode)).statusCode).toBe(400)
  })

  it("refuses a code that carries a PKCE challenge this flow never set", async () => {
    const session = await openSession()
    vi.mocked(redeemCode).mockReturnValue({ ...PLUGIN_GRANT, codeChallenge: "x".repeat(43), codeChallengeMethod: "S256" })
    const res = await callback(`state=${session.sessionId}&code=ndr_code_pkce`)
    expect(res.statusCode).toBe(400)
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "pending" })
  })

  it("holds the grant and asks for the code; nothing is minted and the plugin still sees pending", async () => {
    const session = await consented()
    expect(mintAppAccessToken).not.toHaveBeenCalled()
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "pending" })
  })

  it("does not burn a fresh code for a session that already reached the code form", async () => {
    const session = await consented()
    vi.mocked(redeemCode).mockClear()
    const res = await callback(`state=${session.sessionId}&code=ndr_code_second`)
    expect(res.statusCode).toBe(400)
    expect(res.body).toContain("expired")
    expect(redeemCode).not.toHaveBeenCalled()
  })
})

describe("POST /v1/oauth/plugin/confirm", () => {
  it("connects on the right code, however it was typed, and the plugin is minted a token exactly once", async () => {
    const session = await consented()
    const res = await confirm(session.sessionId, ` ${session.userCode.toLowerCase()} `)
    expect(res.statusCode).toBe(200)
    expectHtml(res)
    expect(res.body).toContain("Connected")

    const granted = await poll(session.sessionId, session.pollKey)
    expect(granted.statusCode).toBe(200)
    expect(granted.json()).toMatchObject({ status: "granted", token: "ndr_app_minted", tokenType: "Bearer" })
    expect(String(granted.headers["cache-control"])).toBe("no-store")
    expect(mintAppAccessToken).toHaveBeenCalledWith({ appId: PLUGIN_APP.id, userId: "user-1", scopes: [...PLUGIN_SCOPES] })

    expect((await poll(session.sessionId, session.pollKey)).statusCode).toBe(404)
    expect(mintAppAccessToken).toHaveBeenCalledTimes(1)
  })

  it("shows the form again with the tries left on a wrong code, and denies on the last one", async () => {
    const session = await consented()
    for (let i = 1; i < USER_CODE_MAX_ATTEMPTS; i++) {
      const res = await confirm(session.sessionId, "ZZZZ-ZZZZ")
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain('name="code"')
      expect(res.body).toContain(`${USER_CODE_MAX_ATTEMPTS - i} ${USER_CODE_MAX_ATTEMPTS - i === 1 ? "try" : "tries"} left`)
    }
    const last = await confirm(session.sessionId, "ZZZZ-ZZZZ")
    expect(last.statusCode).toBe(400)
    expect(last.body).toContain("too many times")
    expect((await confirm(session.sessionId, session.userCode)).statusCode).toBe(400)
    expect((await poll(session.sessionId, session.pollKey)).json()).toEqual({ status: "denied" })
    expect(mintAppAccessToken).not.toHaveBeenCalled()
  })

  it("answers expired for a session that is not waiting for a code", async () => {
    const fresh = await openSession()
    expect((await confirm(fresh.sessionId, fresh.userCode)).statusCode).toBe(400)
    expect((await confirm("pcs_" + "0".repeat(48), "ABCD-EFGH")).statusCode).toBe(400)
  })

  it("rejects a malformed body", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/oauth/plugin/confirm", payload: { state: "nope" } })
    expect(res.statusCode).toBe(400)
  })
})

describe("minting", () => {
  it("puts the consent back when minting fails, so the next poll retries instead of starting over", async () => {
    const session = await consented()
    await confirm(session.sessionId, session.userCode)
    vi.mocked(mintAppAccessToken).mockResolvedValueOnce({ ok: false, failed: "token" })

    const failed = await poll(session.sessionId, session.pollKey)
    expect(failed.statusCode).toBe(500)
    expect(failed.json().error.code).toBe("server_error")

    const retried = await poll(session.sessionId, session.pollKey)
    expect(retried.statusCode).toBe(200)
    expect(retried.json()).toMatchObject({ status: "granted", token: "ndr_app_minted" })
    expect(mintAppAccessToken).toHaveBeenCalledTimes(2)
  })

  it("gives exactly one of two overlapping polls the token", async () => {
    const session = await consented()
    await confirm(session.sessionId, session.userCode)
    const [a, b] = await Promise.all([poll(session.sessionId, session.pollKey), poll(session.sessionId, session.pollKey)])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 404])
    expect(mintAppAccessToken).toHaveBeenCalledTimes(1)
  })
})
