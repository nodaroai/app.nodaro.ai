import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { findAppByClientId, verifyClientSecret } from "./developer-apps.js"
import { callerKeyHash } from "./oauth-register.js"
import { mintAppAccessToken } from "../lib/oauth-tokens.js"
import { ALL_SCOPES } from "../lib/scopes.js"
import { mcpSignInRefusal, type McpClientFacts } from "../lib/mcp-listed-clients.js"
import { redeemAssertion } from "../lib/sso-redeem.js"
import { takeClientAllowance, takeNetworkAllowance } from "../lib/assertion-exchange-limits.js"
import {
  JWT_BEARER_GRANT,
  assertionExchangeProvider,
  assertionExchangeTokenTtlSeconds,
  clientIdNamedForExchange,
  clientMayExchange,
  mcpEndpointOfRequest,
  resourceNamesThisMcpEndpoint,
} from "../lib/mcp-assertion-exchange.js"

/**
 * The MCP assertion exchange (decided 2026-11-11): `POST /v1/oauth/token` with
 * `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` (RFC 7523). The
 * deployment's own application — the one that signs its people in — sends a
 * signed assertion naming a person, authenticates as its confidential client,
 * and gets an ordinary MCP access token for that person, with no consent
 * click. The rule for when it exists is `lib/mcp-assertion-exchange.ts`.
 *
 * `answerAssertionExchange` runs first in the token route. It returns false —
 * having read nothing but the configuration and the client's row, and having
 * answered nothing — for every request that is not an exchange this
 * deployment accepts from this client; the route then answers exactly as it
 * always has, which for this grant type is the reply to a grant it does not
 * know. Byte for byte: `oauth-token-grants-off-fixture.test.ts`.
 *
 * Once it is an exchange, every step fails closed and in this order, so that
 * nothing about an assertion is revealed — and no jti is spent — before the
 * client proved its secret:
 *   1. the caller's network may make one more attempt (429);
 *   2. the request carries its parts (400 invalid_request);
 *   3. the client secret (401 invalid_client; the platform's one bcrypt
 *      comparison, `verifyClientSecret`), then the client's own allowance;
 *   4. the listed-clients rule (`mcpSignInRefusal`, the funnel every mint asks);
 *   5. `resource` names this deployment's MCP endpoint (400 invalid_target,
 *      RFC 8707) and `scope` is no wider than the client's (400 invalid_scope);
 *   6. the assertion — the sign-in's own redemption (`lib/sso-redeem.ts`):
 *      verifier, single use, account resolution, access blocks (400
 *      invalid_grant; every account outcome reads the same);
 *   7. the token (`mintAppAccessToken`, short-lived, recorded as exchanged).
 *
 * One log line per exchange: the client id and the outcome (plus the person
 * when a token was issued). Never the assertion, a token or a secret. The
 * assertion is read from the request BODY only: a query string reaches logs.
 */

/** What every account outcome answers: an unknown subject, a refused one, a blocked or a revoked one look the same. */
const NO_ACCOUNT = "The assertion does not name a person this application can obtain a token for."

const ASSERTION_MESSAGES: Record<string, string> = {
  invalid_signature: "The assertion's signature or format is invalid: it must be an HS256 JWT signed with the provider's secret.",
  invalid_claims: "The assertion's claims are invalid: its aud must be the provider's exchangeAudience (and never its sign-in audience), with an exp.",
  expired: "The assertion has expired.",
  too_long_lived: "The assertion's lifetime (exp - iat) is longer than the provider's maxLifetimeSeconds.",
  missing_jti: "The assertion has no jti: every assertion needs a unique one.",
  missing_email: "The assertion has no email claim (per the provider's claimMap).",
}

const bodySchema = z.object({
  client_secret: z.string().min(1).optional(),
  assertion: z
    .string({ error: "assertion is required, in the request body" })
    .min(1, "assertion is required, in the request body")
    .max(8192, "assertion is too long"),
  scope: z.string().max(2048).optional(),
  resource: z.union([z.string(), z.array(z.string()).max(8)]).optional(),
})

type Outcome = string

function send(req: FastifyRequest, reply: FastifyReply, clientId: string, outcome: Outcome, status: number, body: object, extra: { userId?: string } = {}) {
  // The one line per exchange. A failure of ours (5xx) is a warning, so an
  // operator filtering for those sees it — e.g. `mint_failed_not_migrated`:
  // the database does not have migration 651's grant-type column yet.
  req.log[status >= 500 ? "warn" : "info"]({ oauthAssertionExchange: { clientId, outcome, ...extra } }, "[oauth] assertion exchange")
  // RFC 6749 §5.1: token responses (and their errors) are never cached.
  return reply.status(status).header("Cache-Control", "no-store").header("Pragma", "no-cache").send(body)
}

function oauthError(error: string, description: string) {
  return { error, error_description: description }
}

/** The client row, if the request names a client the exchange is on for. Any read failure is "not on" — the request is then answered as it always was. */
async function exchangeClient(clientId: unknown): Promise<(McpClientFacts & { id: string; client_secret_hash: string; scopes_requested: string[] }) | null> {
  if (!clientIdNamedForExchange(clientId)) return null
  let row: Record<string, unknown> | null
  try {
    row = (await findAppByClientId(clientId)) as Record<string, unknown> | null
  } catch {
    return null
  }
  if (!row || typeof row.id !== "string" || typeof row.client_secret_hash !== "string") return null
  const facts = { client_id: String(row.client_id), kind: (row.kind as string | null) ?? null, status: (row.status as string | null) ?? null }
  if (!clientMayExchange(facts)) return null
  return { ...facts, id: row.id, client_secret_hash: row.client_secret_hash, scopes_requested: Array.isArray(row.scopes_requested) ? (row.scopes_requested as string[]) : [] }
}

async function secretMatches(hash: string, secret: string): Promise<boolean> {
  try {
    return await verifyClientSecret(hash, secret)
  } catch {
    return false
  }
}

/** The scopes asked for (RFC 6749 §3.3, space-separated), or every scope the client declared when none is asked; a description of the refusal otherwise. */
function grantedScopes(asked: string | undefined, declared: readonly string[]): { ok: true; scopes: string[] } | { ok: false; description: string } {
  const own = declared.filter((s) => (ALL_SCOPES as readonly string[]).includes(s))
  const wanted = asked === undefined ? own : [...new Set(asked.split(" ").filter(Boolean))]
  if (asked !== undefined && wanted.length === 0) return { ok: false, description: "scope is empty: omit it for every scope this client may request." }
  for (const s of wanted) if (!own.includes(s)) return { ok: false, description: `Scope ${s} is not one this client may request.` }
  return wanted.length > 0 ? { ok: true, scopes: wanted } : { ok: false, description: "This client declares no scope a token could carry." }
}

/**
 * Answers the request when it is an assertion exchange this deployment
 * accepts from the client it names, and returns true; returns false, having
 * answered nothing, for every other request.
 */
export async function answerAssertionExchange(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const raw = (req.body ?? {}) as Record<string, unknown>
  if (typeof raw !== "object" || raw.grant_type !== JWT_BEARER_GRANT) return false
  const provider = assertionExchangeProvider()
  if (!provider) return false
  const client = await exchangeClient(raw.client_id)
  if (!client) return false
  const clientId = client.client_id

  // 1. The caller's network.
  try {
    const network = await takeNetworkAllowance(callerKeyHash(req as never))
    if (!network.ok) {
      reply.header("Retry-After", String(network.retryAfterSec))
      await send(req, reply, clientId, "rate_limited_network", 429, oauthError("slow_down", "Too many exchanges from this network. Try again later."))
      return true
    }
  } catch {
    await send(req, reply, clientId, "check_failed", 503, oauthError("temporarily_unavailable", "The exchange cannot be checked right now. Try again in a moment."))
    return true
  }

  // 2. The request's parts.
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    await send(req, reply, clientId, "invalid_request", 400, oauthError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid request"))
    return true
  }
  const { client_secret: secret, assertion, scope, resource } = parsed.data

  // 3. The client proves its secret (confidential clients only), then its own allowance.
  if (!secret) {
    await send(req, reply, clientId, "invalid_client", 401, oauthError("invalid_client", "client_secret is required: the exchange is only for a confidential client."))
    return true
  }
  if (!(await secretMatches(client.client_secret_hash, secret))) {
    await send(req, reply, clientId, "invalid_client", 401, oauthError("invalid_client", "Client authentication failed."))
    return true
  }
  try {
    const own = await takeClientAllowance(clientId)
    if (!own.ok) {
      reply.header("Retry-After", String(own.retryAfterSec))
      await send(req, reply, clientId, "rate_limited_client", 429, oauthError("slow_down", "Too many exchanges for this client. Try again later."))
      return true
    }
  } catch {
    await send(req, reply, clientId, "check_failed", 503, oauthError("temporarily_unavailable", "The exchange cannot be checked right now. Try again in a moment."))
    return true
  }

  // 4. The listed-clients rule, asked wherever a token is issued.
  const refusal = mcpSignInRefusal(client, resource)
  if (refusal) {
    await send(req, reply, clientId, "unauthorized_client", 400, oauthError(refusal.error, refusal.message))
    return true
  }

  // 5. What the token is for, and how much it may do.
  if (!resourceNamesThisMcpEndpoint(req, resource)) {
    await send(req, reply, clientId, "invalid_target", 400, oauthError("invalid_target", `resource must name this deployment's MCP endpoint: ${mcpEndpointOfRequest(req)}`))
    return true
  }
  const scopes = grantedScopes(scope, client.scopes_requested)
  if (!scopes.ok) {
    await send(req, reply, clientId, "invalid_scope", 400, oauthError("invalid_scope", scopes.description))
    return true
  }

  // 6. The assertion: the sign-in's own redemption.
  let redeemed
  try {
    redeemed = await redeemAssertion(provider, assertion, "exchange")
  } catch {
    await send(req, reply, clientId, "check_failed", 503, oauthError("temporarily_unavailable", "The exchange cannot be checked right now. Try again in a moment."))
    return true
  }
  if (!redeemed.ok) {
    switch (redeemed.reason) {
      case "assertion":
        await send(req, reply, clientId, `assertion_${redeemed.code}`, 400, oauthError("invalid_grant", ASSERTION_MESSAGES[redeemed.code] ?? "The assertion is invalid."))
        return true
      case "replayed":
        await send(req, reply, clientId, "assertion_replayed", 400, oauthError("invalid_grant", "This assertion was already used: each jti is accepted once."))
        return true
      case "link":
        await send(req, reply, clientId, `account_${redeemed.code}`, 400, oauthError("invalid_grant", NO_ACCOUNT))
        return true
      case "blocked":
        await send(req, reply, clientId, "account_blocked", 400, oauthError("invalid_grant", NO_ACCOUNT))
        return true
    }
  }

  // 7. The token.
  const minted = await mintAppAccessToken({ appId: client.id, userId: redeemed.userId, scopes: scopes.scopes, assertionExchange: { ttlSeconds: assertionExchangeTokenTtlSeconds() } })
  if (!minted.ok) {
    if (minted.failed === "revoked") {
      await send(req, reply, clientId, "account_revoked", 400, oauthError("invalid_grant", NO_ACCOUNT))
      return true
    }
    await send(req, reply, clientId, `mint_failed_${minted.failed}`, 500, oauthError("server_error", "Failed to issue the token."))
    return true
  }
  await send(
    req,
    reply,
    clientId,
    redeemed.action === "provisioned" ? "issued_provisioned" : "issued",
    200,
    { access_token: minted.accessToken, token_type: minted.tokenType, scope: minted.scope, expires_in: minted.expiresIn },
    { userId: redeemed.userId },
  )
  return true
}
