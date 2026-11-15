import { createHash } from "node:crypto"
import type { FastifyInstance, InjectOptions } from "fastify"
import { appRow, newOAuthMemoryDb, seedApiToken, seedAppToken, type OAuthMemoryDb, type Row } from "./oauth-memory-db.js"

/**
 * One fixed walk through every door of the MCP lane and its sign-in, recorded
 * as a plain transcript (status, the headers that matter, the body with every
 * random value masked), so a test can compare a whole deployment's answers at
 * once: `mcp-listed-clients-off-fixture.test.ts` holds a deployment that sets
 * nothing to the answers the code gave before the listed-clients lever
 * existed. Reads nothing from disk.
 */

export const USER = "00000000-0000-4000-8000-0000000000a1"
export const ADMIN = "00000000-0000-4000-8000-0000000000a2"
export const USER_JWT = "jwt-session-of-user"
export const ADMIN_JWT = "jwt-session-of-admin"
/** A client the deployment registered itself, through POST /v1/developer-apps. */
export const OWN_CLIENT_ID = `app_${"1".repeat(32)}`
/** A client that registered itself (RFC 7591), named "Claude". */
export const DCR_CLIENT_ID = `ndr_dcr_${"2".repeat(32)}`
export const REDIRECT = "https://client.example/cb"
export const VERIFIER = "v".repeat(64)
export const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url")
export const INTERNAL_SECRET = "0".repeat(64)

export const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "transcript", version: "1.0.0" } },
}
export const MCP_HEADERS = { accept: "application/json, text/event-stream", "content-type": "application/json" }

export interface Seeded {
  db: OAuthMemoryDb
  ownApp: Row
  dcrApp: Row
  ownToken: string
  dcrToken: string
  apiToken: string
}

export function seedLane(db: OAuthMemoryDb = newOAuthMemoryDb()): Seeded {
  db.profiles.push({ id: USER, role: null }, { id: ADMIN, role: "admin" })
  db.sessions.set(USER_JWT, USER)
  db.sessions.set(ADMIN_JWT, ADMIN)
  const ownApp = appRow({ client_id: OWN_CLIENT_ID, kind: "user", name: "Own chat", owner_user_id: ADMIN })
  const dcrApp = appRow({ client_id: DCR_CLIENT_ID, kind: "dynamic_mcp", name: "Claude", owner_user_id: USER })
  db.apps.push(ownApp, dcrApp)
  // Another person's published work: one listed app and one listed component.
  const published = (over: Row): Row => ({
    id: over.slug === "listed-app" ? "00000000-0000-4000-8000-0000000000f1" : "00000000-0000-4000-8000-0000000000f2",
    name: String(over.slug),
    description: null,
    icon_url: null,
    estimated_credits: 10,
    category: "image",
    output_types: ["image"],
    tags: [],
    preview_media_url: null,
    preview_media_type: null,
    supports_remix: false,
    creator_id: ADMIN,
    creator_display_name: "Admin",
    total_run_count: 3,
    favorite_count: 1,
    created_at: "2026-11-10T00:00:00.000Z",
    monetization_enabled: false,
    component_metadata: null,
    is_listed: true,
    is_active: true,
    deleted_at: null,
    ...over,
  })
  db.extra.published_apps = [published({ slug: "listed-app", publish_type: "app" }), published({ slug: "listed-component", publish_type: "component" })]
  return {
    db,
    ownApp,
    dcrApp,
    ownToken: seedAppToken(db, ownApp, USER, ["jobs:read", "assets:read", "assets:write", "apps:read"]),
    dcrToken: seedAppToken(db, dcrApp, USER),
    apiToken: seedApiToken(db, USER),
  }
}

export interface Answer {
  status: number
  headers: Record<string, string>
  body: unknown
}

const KEPT_HEADERS = ["www-authenticate", "location", "content-type"]

function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (["code", "access_token", "client_id", "client_secret", "clientId", "clientSecret", "id", "createdAt", "updatedAt", "client_id_issued_at", "client_secret_expires_at"].includes(k) && typeof v === "string" && /^(ndr_|app_|sec_|[0-9a-f-]{36}$|\d{4}-)/.test(v)) {
        out[k] = "<random>"
      } else if (k === "client_id_issued_at" || k === "client_secret_expires_at") {
        out[k] = "<time>"
      } else if (k === "client_secret" && typeof v === "string") {
        out[k] = "<random>"
      } else {
        out[k] = mask(v)
      }
    }
    return out
  }
  return value
}

async function answer(app: FastifyInstance, opts: InjectOptions): Promise<Answer> {
  const res = await app.inject(opts)
  const headers: Record<string, string> = {}
  for (const h of KEPT_HEADERS) {
    const v = res.headers[h]
    if (v !== undefined) headers[h] = String(v).replace(/(code|access_token)=ndr_[a-z_]*[0-9a-f]+/g, "$1=<random>")
  }
  let body: unknown = res.body
  try {
    body = mask(JSON.parse(res.body))
  } catch {
    // not JSON: kept as text
  }
  return { status: res.statusCode, headers, body }
}

/** What `tools/list` answered, reduced to its status and whether `ping` is in it (the list itself is not this transcript's subject). */
async function toolList(app: FastifyInstance, path: string, bearer: string): Promise<{ status: number; hasPing: boolean; count: number }> {
  const res = await app.inject({ method: "POST", url: path, headers: { ...MCP_HEADERS, authorization: `Bearer ${bearer}` }, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } })
  if (res.statusCode !== 200) return { status: res.statusCode, hasPing: false, count: 0 }
  const tools = (res.json() as { result?: { tools?: Array<{ name: string }> } }).result?.tools ?? []
  return { status: 200, hasPing: tools.some((t) => t.name === "ping"), count: tools.length > 0 ? 1 : 0 }
}

/**
 * Every door, in order. `mcpPath` is the endpoint's path on this deployment
 * (`/mcp`, or the path of MCP by path); `resource` the MCP resource a client
 * names in its sign-in (RFC 8707).
 */
export async function laneTranscript(app: FastifyInstance, seeded: Seeded, opts: { mcpPath: string; resource: string; host?: string }) {
  const { db } = seeded
  const host = opts.host ? { host: opts.host } : {}
  const mcp = (authorization?: string, extra: Record<string, string> = {}) =>
    answer(app, { method: "POST", url: opts.mcpPath, headers: { ...host, ...MCP_HEADERS, ...(authorization ? { authorization } : {}), ...extra }, payload: INIT })

  const endpoint = {
    none: await mcp(),
    ownClientToken: await mcp(`Bearer ${seeded.ownToken}`),
    selfRegisteredClientToken: await mcp(`Bearer ${seeded.dcrToken}`),
    session: await mcp(`Bearer ${USER_JWT}`),
    personalApiToken: await mcp(`Bearer ${seeded.apiToken}`),
    internalSecret: await mcp(undefined, { "x-internal-orchestrator-secret": INTERNAL_SECRET, "x-internal-user-id": USER }),
    billingKey: await mcp(`Bearer ndr_bill_${"b".repeat(64)}`),
    ownClientToolsList: await toolList(app, opts.mcpPath, seeded.ownToken),
  }

  const authorizeQuery = (clientId: string) =>
    `?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=jobs%3Aread&state=st8&code_challenge=${CHALLENGE}&code_challenge_method=S256&resource=${encodeURIComponent(opts.resource)}`
  const readsBefore = db.calls.length
  const authorizeRedirectDcr = await answer(app, { method: "GET", url: `/v1/oauth/authorize${authorizeQuery(DCR_CLIENT_ID)}`, headers: host })
  const authorizeRedirectReads = db.calls.length - readsBefore
  const authorizeRedirectOwn = await answer(app, { method: "GET", url: `/v1/oauth/authorize${authorizeQuery(OWN_CLIENT_ID)}`, headers: host })

  const appInfo = (clientId: string) =>
    answer(app, { method: "GET", url: `/v1/oauth/app-info?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&resource=${encodeURIComponent(opts.resource)}`, headers: host })
  const appInfoDcr = await appInfo(DCR_CLIENT_ID)
  const appInfoOwn = await appInfo(OWN_CLIENT_ID)

  const consent = async (clientId: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/authorize",
      headers: { ...host, authorization: `Bearer ${USER_JWT}`, "content-type": "application/json" },
      payload: { clientId, redirectUri: REDIRECT, scopes: ["jobs:read"], state: "st8", codeChallenge: CHALLENGE, codeChallengeMethod: "S256", resource: opts.resource },
    })
    const code = res.statusCode === 200 ? (res.json() as { code: string }).code : null
    return { code, answer: { status: res.statusCode, headers: {}, body: mask(JSON.parse(res.body)) } as Answer }
  }
  const exchange = (clientId: string, code: string) =>
    answer(app, {
      method: "POST",
      url: "/v1/oauth/token",
      headers: { ...host, "content-type": "application/x-www-form-urlencoded" },
      payload: `grant_type=authorization_code&client_id=${clientId}&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_verifier=${VERIFIER}&resource=${encodeURIComponent(opts.resource)}`,
    })
  const consentDcr = await consent(DCR_CLIENT_ID)
  const tokenDcr = consentDcr.code ? await exchange(DCR_CLIENT_ID, consentDcr.code) : null
  const consentOwn = await consent(OWN_CLIENT_ID)
  const tokenOwn = consentOwn.code ? await exchange(OWN_CLIENT_ID, consentOwn.code) : null
  const refreshGrant = await answer(app, {
    method: "POST",
    url: "/v1/oauth/token",
    headers: { ...host, "content-type": "application/x-www-form-urlencoded" },
    payload: `grant_type=refresh_token&client_id=${OWN_CLIENT_ID}&refresh_token=anything&resource=${encodeURIComponent(opts.resource)}`,
  })

  const register = await answer(app, {
    method: "POST",
    url: "/v1/oauth/register",
    headers: { ...host, "content-type": "application/json" },
    payload: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
  })

  return {
    endpoint,
    authorizeRedirectDcr,
    authorizeRedirectReads,
    authorizeRedirectOwn,
    appInfoDcr,
    appInfoOwn,
    consentDcr: consentDcr.answer,
    tokenDcr,
    consentOwn: consentOwn.answer,
    tokenOwn,
    refreshGrant,
    register,
  }
}

/** The developer-app writes, as a signed-in person (`bearer`): create, change, rotate the secret, delete. */
export async function developerAppWrites(app: FastifyInstance, bearer: string) {
  const auth = { authorization: `Bearer ${bearer}`, "content-type": "application/json" }
  const createRes = await app.inject({
    method: "POST",
    url: "/v1/developer-apps",
    headers: auth,
    payload: { name: "My client", redirectUris: [REDIRECT], scopesRequested: ["jobs:read"] },
  })
  const created = { status: createRes.statusCode, headers: { "content-type": String(createRes.headers["content-type"]) }, body: mask(createRes.json()) } as Answer
  // The app the create made; a refused create leaves an existing app of this person's to change.
  const res = await app.inject({ method: "GET", url: "/v1/developer-apps", headers: { authorization: `Bearer ${bearer}` } })
  const list = (res.json() as { data?: Array<{ id: string; kind: string }> }).data ?? []
  const id = (createRes.statusCode === 201 ? (createRes.json() as { data: { id: string } }).data.id : list.find((a) => a.kind === "user")?.id) ?? "00000000-0000-4000-8000-00000000dead"
  const changed = await answer(app, { method: "PATCH", url: `/v1/developer-apps/${id}`, headers: auth, payload: { name: "Renamed" } })
  const rotated = await answer(app, { method: "POST", url: `/v1/developer-apps/${id}/rotate-secret`, headers: { authorization: `Bearer ${bearer}` } })
  const deleted = await answer(app, { method: "DELETE", url: `/v1/developer-apps/${id}`, headers: { authorization: `Bearer ${bearer}` } })
  return { created, listed: { status: res.statusCode, count: list.length }, changed, rotated, deleted }
}

/** The public app listing: the marketplace browse (all kinds, apps, components) and MCP `list_apps` in its public scope. */
export async function appListings(app: FastifyInstance, mcpPath: string, bearer: string) {
  const browse = await answer(app, { method: "GET", url: "/v1/apps/browse" })
  const browseApps = await answer(app, { method: "GET", url: "/v1/apps/browse?publishType=app" })
  const browseComponents = await answer(app, { method: "GET", url: "/v1/apps/browse?publishType=component" })
  const res = await app.inject({
    method: "POST",
    url: mcpPath,
    headers: { ...MCP_HEADERS, authorization: `Bearer ${bearer}` },
    payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_apps", arguments: { scope: "public" } } },
  })
  const listApps = { status: res.statusCode, text: res.statusCode === 200 ? (res.json() as { result: { content: Array<{ text: string }> } }).result.content[0]?.text : res.body }
  return { browse, browseApps, browseComponents, listApps }
}
