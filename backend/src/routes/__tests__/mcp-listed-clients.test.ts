import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import type { FastifyInstance } from "fastify"

/**
 * Only listed clients on the MCP lane (decided 2026-11-11), booted for real on
 * the dedicated lane: `MCP_ALLOWED_CLIENT_IDS` names the one client the
 * deployment set up for its own chat application. The endpoint takes a token
 * issued to it and refuses every other credential; the sign-in refuses any
 * other client that asks for MCP before the consent screen, and again where a
 * code or a token would be issued; self-registration answers as `off` (here
 * over `MCP_DYNAMIC_REGISTRATION=open`); the listed client's whole flow works;
 * removal from the list stops a token at its next call; the in-app Copilot's
 * in-process server is untouched.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.MCP_DYNAMIC_REGISTRATION = "open"
  process.env.PUBLIC_URL = "https://app.example.com"
  process.env.MCP_PUBLIC_URL = "https://mcp.example.com"
  process.env.COMMUNITY_CONNECT_ENABLED = "true"
  process.env.MCP_ALLOWED_CLIENT_IDS = ` app_${"1".repeat(32)} `
  delete process.env.NODARO_SURFACE_PROFILE
})

const fake = vi.hoisted(() => ({ db: null as unknown }))

vi.mock("../../lib/supabase.js", async () => {
  const { newOAuthMemoryDb, oauthMemorySupabase } = await import("./helpers/oauth-memory-db.js")
  const db = newOAuthMemoryDb()
  fake.db = db
  return { supabase: oauthMemorySupabase(db) }
})

import { buildApp } from "../../app.js"
import { config } from "../../lib/config.js"
import { buildMcpServer } from "../../lib/mcp/server.js"
import { createMcpInvoker } from "../../lib/mcp/invoke.js"
import { issueCode } from "../../lib/oauth-codes.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"
import { appRow, seedAppToken, type OAuthMemoryDb } from "./helpers/oauth-memory-db.js"
import {
  ADMIN,
  CHALLENGE,
  DCR_CLIENT_ID,
  INIT,
  INTERNAL_SECRET,
  MCP_HEADERS,
  OWN_CLIENT_ID,
  REDIRECT,
  USER,
  USER_JWT,
  VERIFIER,
  seedLane,
  type Seeded,
} from "./helpers/mcp-lane-transcript.js"

const MCP_RESOURCE = "https://mcp.example.com/mcp"
const REFUSED_BODY = {
  error: {
    code: "mcp_client_not_allowed",
    message: "This deployment accepts MCP connections only from the clients it has set up. Connect through the deployment's own app.",
  },
}
/** A developer app the deployment did not list (one a person made, or an admin made for the REST API). */
const UNLISTED_CLIENT_ID = `app_${"3".repeat(32)}`

describe("MCP lane with a client list set", () => {
  let app: FastifyInstance
  let seeded: Seeded
  let db: OAuthMemoryDb
  let unlistedToken: string

  beforeAll(async () => {
    __resetSurfaceProfileCacheForTests()
    db = fake.db as OAuthMemoryDb
    seeded = seedLane(db)
    const unlisted = appRow({ client_id: UNLISTED_CLIENT_ID, kind: "user", name: "Someone's app", owner_user_id: USER })
    db.apps.push(unlisted)
    unlistedToken = seedAppToken(db, unlisted, USER)
    app = await buildApp()
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    db.failReads.clear()
  })

  const mcp = (headers: Record<string, string>, payload: unknown = INIT) =>
    app.inject({ method: "POST", url: "/mcp", headers: { ...MCP_HEADERS, ...headers }, payload: payload as string })

  describe("the endpoint takes a token issued to a listed client and nothing else", () => {
    it("the listed client's token: initialize and tools/list", async () => {
      const init = await mcp({ authorization: `Bearer ${seeded.ownToken}` })
      expect(init.statusCode, init.body).toBe(200)
      expect(init.json().result.serverInfo).toEqual({ name: "nodaro-mcp", version: "1.0.0" })
      const list = await mcp({ authorization: `Bearer ${seeded.ownToken}` }, { jsonrpc: "2.0", id: 2, method: "tools/list" })
      expect(list.statusCode).toBe(200)
      expect((list.json().result.tools as Array<{ name: string }>).some((t) => t.name === "ping")).toBe(true)
    })

    it.each([
      ["a self-registered client's token", () => ({ authorization: `Bearer ${seeded.dcrToken}` })],
      ["an unlisted developer app's token", () => ({ authorization: `Bearer ${unlistedToken}` })],
      ["a signed-in session", () => ({ authorization: `Bearer ${USER_JWT}` })],
      ["a personal API token", () => ({ authorization: `Bearer ${seeded.apiToken}` })],
      ["the internal secret", () => ({ "x-internal-orchestrator-secret": INTERNAL_SECRET, "x-internal-user-id": USER })],
    ])("%s: 403, a coded refusal that names nothing of the list", async (_label, headers) => {
      const res = await mcp(headers())
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual(REFUSED_BODY)
      expect(res.headers["www-authenticate"]).toBeUndefined()
      expect(res.body).not.toContain(OWN_CLIENT_ID)
    })

    it("no credential, or a billing key on a deployment without a payer: the unchanged 401 challenge", async () => {
      for (const authorization of [undefined, `Bearer ndr_bill_${"b".repeat(64)}`]) {
        const res = await mcp(authorization ? { authorization } : {})
        expect(res.statusCode).toBe(401)
        expect(res.headers["www-authenticate"]).toBe('Bearer realm="mcp.example.com", resource="https://mcp.example.com/mcp"')
      }
    })

    it("a listed id whose row is not a client the deployment set up, or is suspended, is refused", async () => {
      const ownApp = seeded.ownApp
      for (const change of [{ kind: "dynamic_mcp" }, { kind: "community_instance" }, { status: "suspended" }]) {
        const before = { kind: ownApp.kind, status: ownApp.status }
        Object.assign(ownApp, change)
        try {
          const res = await mcp({ authorization: `Bearer ${seeded.ownToken}` })
          expect(res.statusCode, JSON.stringify(change)).toBe(403)
          expect(res.json()).toEqual(REFUSED_BODY)
        } finally {
          Object.assign(ownApp, before)
        }
      }
    })

    it("a client lookup that fails refuses (503), never admits", async () => {
      db.failReads.add("developer_apps")
      const res = await mcp({ authorization: `Bearer ${seeded.ownToken}` })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toEqual({ error: { code: "mcp_client_check_failed", message: "Could not check this client right now. Try again in a moment." } })
    })

    it("a client removed from the list stops at its next call, its token unexpired", async () => {
      const ok = await mcp({ authorization: `Bearer ${seeded.ownToken}` })
      expect(ok.statusCode).toBe(200)
      const listed = config.MCP_ALLOWED_CLIENT_IDS
      config.MCP_ALLOWED_CLIENT_IDS = `app_${"9".repeat(32)}`
      try {
        const res = await mcp({ authorization: `Bearer ${seeded.ownToken}` })
        expect(res.statusCode).toBe(403)
        expect(res.json()).toEqual(REFUSED_BODY)
      } finally {
        config.MCP_ALLOWED_CLIENT_IDS = listed
      }
      expect((await mcp({ authorization: `Bearer ${seeded.ownToken}` })).statusCode).toBe(200)
    })
  })

  describe("the sign-in refuses an unlisted client that asks for MCP before the consent screen", () => {
    const authorizeUrl = (clientId: string, opts: { resource?: string; redirect?: string } = {}) =>
      `/v1/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(opts.redirect ?? REDIRECT)}&scope=jobs%3Aread&state=st8&code_challenge=${CHALLENGE}&code_challenge_method=S256${opts.resource === undefined ? "" : `&resource=${encodeURIComponent(opts.resource)}`}`
    /** The refusal as RFC 6749 §4.1.2.1 sends it: to the client's own redirect_uri, with its state. */
    const expectRefusedRedirect = (location: unknown) => {
      const url = new URL(String(location))
      expect(`${url.origin}${url.pathname}`).toBe(REDIRECT)
      expect(Object.fromEntries(url.searchParams)).toEqual({ error: "unauthorized_client", error_description: REFUSED_BODY.error.message, state: "st8" })
    }

    it.each([
      ["a self-registered client naming the MCP resource", DCR_CLIENT_ID, MCP_RESOURCE],
      ["a self-registered client naming no resource (it exists to be an MCP client)", DCR_CLIENT_ID, undefined],
      ["an unlisted developer app naming the MCP resource", UNLISTED_CLIENT_ID, MCP_RESOURCE],
      ["an unlisted developer app naming the MCP resource with a trailing slash", UNLISTED_CLIENT_ID, `${MCP_RESOURCE}/`],
      ["an unlisted developer app naming an MCP path on another host (tokens carry no audience)", UNLISTED_CLIENT_ID, "https://elsewhere.example/mcp"],
      ["an unlisted developer app naming a resource that does not parse", UNLISTED_CLIENT_ID, "not a url"],
    ])("%s: straight back to the client with the refusal and its state", async (_label, clientId, resource) => {
      const res = await app.inject({ method: "GET", url: authorizeUrl(clientId, { resource }) })
      expect(res.statusCode).toBe(302)
      expectRefusedRedirect(res.headers.location)
    })

    it("the listed client, and an unlisted developer app signing in for the REST API (no MCP resource), go on to the consent page", async () => {
      for (const [clientId, resource] of [[OWN_CLIENT_ID, MCP_RESOURCE], [UNLISTED_CLIENT_ID, undefined], [UNLISTED_CLIENT_ID, "https://app.example.com/v1"]] as const) {
        const url = authorizeUrl(clientId, { resource })
        const res = await app.inject({ method: "GET", url })
        expect(res.statusCode).toBe(302)
        expect(res.headers.location).toBe(`https://app.example.com/oauth/authorize${url.slice(url.indexOf("?"))}`)
      }
    })

    it("an unknown client, or a redirect_uri not registered for the client, is never redirected to: the consent page shows its own error", async () => {
      for (const url of [authorizeUrl(`app_${"7".repeat(32)}`, { resource: MCP_RESOURCE }), authorizeUrl(DCR_CLIENT_ID, { resource: MCP_RESOURCE, redirect: "https://evil.example/cb" })]) {
        const res = await app.inject({ method: "GET", url })
        expect(String(res.headers.location)).toBe(`https://app.example.com/oauth/authorize${url.slice(url.indexOf("?"))}`)
      }
    })

    it("app-info refuses the same clients, so a consent page opened directly never shows them", async () => {
      const info = (clientId: string, resource?: string) =>
        app.inject({ method: "GET", url: `/v1/oauth/app-info?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}${resource ? `&resource=${encodeURIComponent(resource)}` : ""}` })
      for (const [clientId, resource] of [[DCR_CLIENT_ID, MCP_RESOURCE], [DCR_CLIENT_ID, undefined], [UNLISTED_CLIENT_ID, MCP_RESOURCE]] as const) {
        const res = await info(clientId, resource)
        expect(res.statusCode, `${clientId} ${resource}`).toBe(403)
        expect(res.json()).toEqual(REFUSED_BODY)
      }
      expect((await info(OWN_CLIENT_ID, MCP_RESOURCE)).statusCode).toBe(200)
      expect((await info(UNLISTED_CLIENT_ID)).json()).toMatchObject({ name: "Someone's app", redirectUriRegistered: true })
    })

    it("consent refuses them too, issues no code, and leaves a self-registered row unclaimed", async () => {
      const unclaimed = appRow({ client_id: `ndr_dcr_${"4".repeat(32)}`, kind: "dynamic_mcp", name: "Claude", owner_user_id: null })
      db.apps.push(unclaimed)
      for (const [clientId, resource] of [[unclaimed.client_id as string, undefined], [UNLISTED_CLIENT_ID, MCP_RESOURCE], [UNLISTED_CLIENT_ID, ["https://app.example.com/v1", MCP_RESOURCE]]] as const) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/oauth/authorize",
          headers: { authorization: `Bearer ${USER_JWT}`, "content-type": "application/json" },
          payload: { clientId, redirectUri: REDIRECT, scopes: ["jobs:read"], state: "st8", codeChallenge: CHALLENGE, codeChallengeMethod: "S256", ...(resource ? { resource } : {}) },
        })
        expect(res.statusCode, `${clientId} ${String(resource)}`).toBe(403)
        expect(res.json()).toEqual(REFUSED_BODY)
      }
      expect(unclaimed.owner_user_id).toBeNull()
    })
  })

  describe("the listed client's whole flow, and the token step", () => {
    async function consent(clientId: string, resource?: string): Promise<string> {
      const res = await app.inject({
        method: "POST",
        url: "/v1/oauth/authorize",
        headers: { authorization: `Bearer ${USER_JWT}`, "content-type": "application/json" },
        payload: { clientId, redirectUri: REDIRECT, scopes: ["jobs:read", "assets:read"], state: "st8", codeChallenge: CHALLENGE, codeChallengeMethod: "S256", ...(resource ? { resource } : {}) },
      })
      expect(res.statusCode, res.body).toBe(200)
      return (res.json() as { code: string }).code
    }
    const exchange = (clientId: string, code: string, resource?: string) =>
      app.inject({
        method: "POST",
        url: "/v1/oauth/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: `grant_type=authorization_code&client_id=${clientId}&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_verifier=${VERIFIER}${resource ? `&resource=${encodeURIComponent(resource)}` : ""}`,
      })

    it("authorize → consent → token → initialize → tools/list", async () => {
      const redirect = await app.inject({ method: "GET", url: `/v1/oauth/authorize?response_type=code&client_id=${OWN_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=jobs%3Aread&resource=${encodeURIComponent(MCP_RESOURCE)}` })
      expect(String(redirect.headers.location)).toMatch(/^https:\/\/app\.example\.com\/oauth\/authorize\?/)
      const code = await consent(OWN_CLIENT_ID, MCP_RESOURCE)
      const token = await exchange(OWN_CLIENT_ID, code, MCP_RESOURCE)
      expect(token.statusCode, token.body).toBe(200)
      const bearer = (token.json() as { access_token: string }).access_token
      expect(bearer).toMatch(/^ndr_app_/)
      const init = await mcp({ authorization: `Bearer ${bearer}` })
      expect(init.statusCode, init.body).toBe(200)
      const list = await mcp({ authorization: `Bearer ${bearer}` }, { jsonrpc: "2.0", id: 2, method: "tools/list" })
      expect(list.statusCode).toBe(200)
      expect((list.json().result.tools as Array<{ name: string }>).length).toBeGreaterThan(1)
    })

    it("an unlisted developer app: a REST code exchanges for a REST token, but not when the exchange names MCP", async () => {
      const code = await consent(UNLISTED_CLIENT_ID)
      const refused = await exchange(UNLISTED_CLIENT_ID, code, MCP_RESOURCE)
      expect(refused.statusCode).toBe(400)
      expect(refused.json()).toEqual({ error: "unauthorized_client", error_description: REFUSED_BODY.error.message })
      const rest = await exchange(UNLISTED_CLIENT_ID, await consent(UNLISTED_CLIENT_ID))
      expect(rest.statusCode).toBe(200)
      // …and that token is still refused on the MCP lane.
      const onMcp = await mcp({ authorization: `Bearer ${(rest.json() as { access_token: string }).access_token}` })
      expect(onMcp.statusCode).toBe(403)
    })

    it("a self-registered client's code issued before the list was set gets no token", async () => {
      const code = issueCode({ appId: seeded.dcrApp.id as string, userId: USER, scopes: ["jobs:read"], redirectUri: REDIRECT, codeChallenge: CHALLENGE, codeChallengeMethod: "S256" })
      const res = await exchange(DCR_CLIENT_ID, code)
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: "unauthorized_client" })
    })

    it("there is no refresh grant: a refresh for the MCP resource is refused", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/oauth/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: `grant_type=refresh_token&client_id=${OWN_CLIENT_ID}&refresh_token=anything&resource=${encodeURIComponent(MCP_RESOURCE)}`,
      })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toMatchObject({ error: "invalid_request" })
    })
  })

  describe("registration", () => {
    it("answers exactly as MCP_DYNAMIC_REGISTRATION=off does, whatever the variable says, and stores nothing", async () => {
      expect(config.MCP_DYNAMIC_REGISTRATION).toBe("open")
      const apps = db.apps.length
      const res = await app.inject({
        method: "POST",
        url: "/v1/oauth/register",
        headers: { "content-type": "application/json" },
        payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({
        error: {
          code: "dcr_disabled",
          message: "Dynamic client registration is disabled on this server. Contact the operator for a static client_id/client_secret.",
        },
      })
      expect(db.apps.length).toBe(apps)
    })

    it("community-instance registration keeps its own switch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/oauth/register",
        headers: { "content-type": "application/json" },
        payload: { client_name: "Nodaro instance (localhost:3000)", redirect_uris: ["http://localhost:3000/v1/nodaro-connect/callback"], software_id: "nodaro-community" },
      })
      expect(res.statusCode, res.body).toBe(201)
    })
  })

  describe("the in-app Copilot builds its server in-process: untouched", () => {
    it("a first-party in-process session lists its tools with the list set", async () => {
      const server = await buildMcpServer({ userId: ADMIN, scopes: ["workflows:read", "jobs:read"], clientName: "Nodaro Copilot", fastify: app, firstParty: true })
      const tools = await createMcpInvoker(server).listTools()
      expect(tools.some((t) => t.name === "list_workflows")).toBe(true)
    })
  })
})
