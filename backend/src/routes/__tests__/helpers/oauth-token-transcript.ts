import type { FastifyInstance, InjectOptions } from "fastify"
import { appRow, type OAuthMemoryDb, type Row } from "./oauth-memory-db.js"
import { CHALLENGE, OWN_CLIENT_ID, REDIRECT, USER_JWT, VERIFIER } from "./mcp-lane-transcript.js"

/**
 * One fixed walk through `POST /v1/oauth/token`, recorded as a plain
 * transcript (status, the headers a change to the endpoint would move, the
 * body with every random value masked), so a test can hold a deployment to
 * the answers the endpoint gave before the server-to-server assertion
 * exchange existed (decided 2026-11-11): the authorization-code grant in each
 * of its shapes, the grants the endpoint does not know, and the
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` grant as a client would send
 * it. `oauth-token-grants-off-fixture.test.ts` holds the recording. Reads
 * nothing from disk.
 */

/** An obvious fake, never a real secret: the confidential client's secret in these walks. */
export const TOKEN_WALK_SECRET = "sec_test-only-not-a-real-client-secret"
/** A client the deployment set up whose codes are redeemed with its secret (no PKCE). */
export const SECRET_CLIENT_ID = `app_${"5".repeat(32)}`
export const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"
/** A placeholder, not a JWT: the endpoint must answer it without reading it. */
export const PLACEHOLDER_ASSERTION = "not-a-real-assertion"

export interface TokenAnswer {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** Headers an added limiter, cache rule or challenge would show up in. */
const KEPT_HEADERS = ["content-type", "cache-control", "pragma", "retry-after", "www-authenticate", "x-ratelimit-limit", "x-ratelimit-remaining"]

function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = k === "access_token" && typeof v === "string" && v.startsWith("ndr_app_") ? "<random>" : mask(v)
    }
    return out
  }
  return value
}

async function answer(app: FastifyInstance, opts: InjectOptions): Promise<TokenAnswer> {
  const res = await app.inject(opts)
  const headers: Record<string, string> = {}
  for (const h of KEPT_HEADERS) {
    const v = res.headers[h]
    if (v !== undefined) headers[h] = String(v)
  }
  let body: unknown = res.body
  try {
    body = mask(JSON.parse(res.body))
  } catch {
    // not JSON: kept as text
  }
  return { status: res.statusCode, headers, body }
}

/** Seeds the confidential client this walk redeems codes for with its secret; `secretHash` is the bcrypt hash of TOKEN_WALK_SECRET. */
export function seedSecretClient(db: OAuthMemoryDb, secretHash: string): Row {
  const app = appRow({ client_id: SECRET_CLIENT_ID, kind: "user", name: "Own server app", client_secret_hash: secretHash, scopes_requested: ["jobs:read", "assets:read"] })
  db.apps.push(app)
  return app
}

/**
 * Every shape, in order. `resource` is what the client names (RFC 8707) on
 * every request that carries one. Expects `seedLane` (the PKCE client
 * OWN_CLIENT_ID) and `seedSecretClient` to have run.
 */
export async function tokenTranscript(app: FastifyInstance, opts: { resource: string; host?: string }) {
  const host = opts.host ? { host: opts.host } : {}
  const form = (body: string) =>
    answer(app, { method: "POST", url: "/v1/oauth/token", headers: { ...host, "content-type": "application/x-www-form-urlencoded" }, payload: body })
  const json = (body: Record<string, unknown>) =>
    answer(app, { method: "POST", url: "/v1/oauth/token", headers: { ...host, "content-type": "application/json" }, payload: body })
  const resource = `&resource=${encodeURIComponent(opts.resource)}`

  const consent = async (clientId: string, pkce: boolean): Promise<string> => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/oauth/authorize",
      headers: { ...host, authorization: `Bearer ${USER_JWT}`, "content-type": "application/json" },
      payload: { clientId, redirectUri: REDIRECT, scopes: ["jobs:read"], state: "st8", ...(pkce ? { codeChallenge: CHALLENGE, codeChallengeMethod: "S256" } : {}), resource: opts.resource },
    })
    if (res.statusCode !== 200) throw new Error(`consent for ${clientId} answered ${res.statusCode}: ${res.body}`)
    return (res.json() as { code: string }).code
  }
  const codeGrant = (clientId: string, code: string, extra = "") =>
    `grant_type=authorization_code&client_id=${clientId}&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT)}${extra}${resource}`

  // The authorization-code grant.
  const pkceCode = await consent(OWN_CLIENT_ID, true)
  const codePkce = await form(codeGrant(OWN_CLIENT_ID, pkceCode, `&code_verifier=${VERIFIER}`))
  const codeReused = await form(codeGrant(OWN_CLIENT_ID, pkceCode, `&code_verifier=${VERIFIER}`))
  const codeWrongVerifier = await form(codeGrant(OWN_CLIENT_ID, await consent(OWN_CLIENT_ID, true), `&code_verifier=${"w".repeat(64)}`))
  const codeMissingVerifier = await form(codeGrant(OWN_CLIENT_ID, await consent(OWN_CLIENT_ID, true)))
  const codeSecret = await form(codeGrant(SECRET_CLIENT_ID, await consent(SECRET_CLIENT_ID, false), `&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}`))
  const codeSecretJson = await json({
    grant_type: "authorization_code",
    client_id: SECRET_CLIENT_ID,
    client_secret: TOKEN_WALK_SECRET,
    code: await consent(SECRET_CLIENT_ID, false),
    redirect_uri: REDIRECT,
  })
  const codeWrongSecret = await form(codeGrant(SECRET_CLIENT_ID, await consent(SECRET_CLIENT_ID, false), "&client_secret=sec_wrong"))
  const codeMissingSecret = await form(codeGrant(SECRET_CLIENT_ID, await consent(SECRET_CLIENT_ID, false)))
  const codeOtherClient = await form(codeGrant(SECRET_CLIENT_ID, await consent(OWN_CLIENT_ID, true), `&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}`))
  const codeUnknownClient = await form(codeGrant(`app_${"7".repeat(32)}`, "ndr_code_unknown", `&code_verifier=${VERIFIER}`))
  const codeUnknownCode = await form(codeGrant(OWN_CLIENT_ID, "ndr_code_unknown", `&code_verifier=${VERIFIER}`))
  const codeNoCode = await form(`grant_type=authorization_code&client_id=${OWN_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}`)
  const emptyBody = await form("")

  // Grants the endpoint does not know.
  const refreshToken = await form(`grant_type=refresh_token&client_id=${OWN_CLIENT_ID}&refresh_token=anything${resource}`)
  const password = await form(`grant_type=password&client_id=${SECRET_CLIENT_ID}&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}&username=a%40example.com&password=x`)
  const clientCredentials = await form(`grant_type=client_credentials&client_id=${SECRET_CLIENT_ID}&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}${resource}`)
  const noGrantType = await form(`client_id=${SECRET_CLIENT_ID}&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}`)

  // The jwt-bearer grant (RFC 7523), as a deployment's application would send it.
  const bearer = (clientId: string, extra = "") =>
    `grant_type=${encodeURIComponent(JWT_BEARER)}&client_id=${clientId}&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}&assertion=${PLACEHOLDER_ASSERTION}${extra}`
  const jwtBearer = await form(bearer(SECRET_CLIENT_ID, `&scope=jobs%3Aread${resource}`))
  const jwtBearerNoResource = await form(bearer(SECRET_CLIENT_ID))
  const jwtBearerPublicClient = await form(`grant_type=${encodeURIComponent(JWT_BEARER)}&client_id=${OWN_CLIENT_ID}&assertion=${PLACEHOLDER_ASSERTION}${resource}`)
  const jwtBearerUnknownClient = await form(bearer(`app_${"7".repeat(32)}`, resource))
  const jwtBearerNoClient = await form(`grant_type=${encodeURIComponent(JWT_BEARER)}&assertion=${PLACEHOLDER_ASSERTION}${resource}`)
  const jwtBearerNoAssertion = await form(`grant_type=${encodeURIComponent(JWT_BEARER)}&client_id=${SECRET_CLIENT_ID}&client_secret=${encodeURIComponent(TOKEN_WALK_SECRET)}${resource}`)
  const jwtBearerJson = await json({ grant_type: JWT_BEARER, client_id: SECRET_CLIENT_ID, client_secret: TOKEN_WALK_SECRET, assertion: PLACEHOLDER_ASSERTION, resource: opts.resource })

  const metadata = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: host })

  return {
    codePkce,
    codeReused,
    codeWrongVerifier,
    codeMissingVerifier,
    codeSecret,
    codeSecretJson,
    codeWrongSecret,
    codeMissingSecret,
    codeOtherClient,
    codeUnknownClient,
    codeUnknownCode,
    codeNoCode,
    emptyBody,
    refreshToken,
    password,
    clientCredentials,
    noGrantType,
    jwtBearer,
    jwtBearerNoResource,
    jwtBearerPublicClient,
    jwtBearerUnknownClient,
    jwtBearerNoClient,
    jwtBearerNoAssertion,
    jwtBearerJson,
    grantTypesSupported: (metadata.json() as { grant_types_supported?: unknown }).grant_types_supported,
  }
}
