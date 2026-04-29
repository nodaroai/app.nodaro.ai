import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { findAppByClientId, verifyClientSecret } from "./developer-apps.js"
import { issueCode, redeemCode } from "../lib/oauth-codes.js"
import { ALL_SCOPES, formatScopeString } from "../lib/scopes.js"

const ACCESS_TOKEN_TTL_DAYS = 90

const authorizeBody = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.enum(ALL_SCOPES)).min(1),
  state: z.string().optional(),
  // PKCE (RFC 7636) — optional; required when caller is a public client.
  codeChallenge: z.string().min(43).max(128).optional(),
  codeChallengeMethod: z.enum(["S256"]).optional(),
})

const tokenBody = z.object({
  grant_type: z.literal("authorization_code"),
  client_id: z.string().min(1),
  // client_secret is optional when PKCE is used (RFC 7636 — public clients).
  // If present, we still verify it; if absent and PKCE was used, that's fine.
  client_secret: z.string().min(1).optional(),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  // PKCE verifier — required iff the issued code carried a code_challenge.
  code_verifier: z.string().min(43).max(128).optional(),
})

const revokeBody = z.object({
  token: z.string().min(1),
})

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

/**
 * RFC 7636 PKCE verification: SHA256(code_verifier) base64url-encoded must equal code_challenge.
 * Timing-safe equality is used to compare.
 */
function verifyPkce(codeVerifier: string, storedChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url")
  if (computed.length !== storedChallenge.length) return false
  return timingSafeEqual(Buffer.from(computed), Buffer.from(storedChallenge))
}

export async function oauthRoutes(app: FastifyInstance) {
  // GET /v1/oauth/app-info?client_id=<id> — public, returns app metadata for consent screens
  app.get("/v1/oauth/app-info", async (req, reply) => {
    const clientId = (req.query as Record<string, string>)?.client_id
    if (!clientId || typeof clientId !== "string") {
      return reply.status(400).send({ error: { code: "validation_error", message: "client_id query param required" } })
    }
    const dApp = await findAppByClientId(clientId)
    if (!dApp) {
      return reply.status(404).send({ error: { code: "not_found", message: "Unknown client_id or app suspended" } })
    }
    // Return only public-safe fields — no secret, no full origin list, no owner_user_id.
    // `kind` lets the consent UI warn for self-claimed dynamic_mcp clients (RFC 7591 DCR).
    return reply.send({
      name: dApp.name ?? "Unnamed App",
      description: dApp.description ?? null,
      logoUrl: dApp.logo_url ?? null,
      homepageUrl: dApp.homepage_url ?? null,
      scopesRequested: dApp.scopes_requested,
      kind: dApp.kind ?? "user",
    })
  })

  // GET /v1/oauth/authorize?... — entry point for OAuth-spec-compliant clients
  // (Claude.ai, etc). Per RFC 6749 §3.1, the authorization endpoint must render
  // an HTML consent UI in the user-agent. We delegate that to the frontend
  // SPA at /oauth/authorize, preserving the query string verbatim.
  app.get("/v1/oauth/authorize", async (req, reply) => {
    const idx = req.url.indexOf("?")
    const queryString = idx >= 0 ? req.url.slice(idx) : ""
    const issuer = config.PUBLIC_URL || "https://app.nodaro.ai"
    return reply.redirect(`${issuer}/oauth/authorize${queryString}`, 302)
  })

  // POST /v1/oauth/authorize — frontend sends here AFTER user clicks "Allow"
  // on the consent screen. Caller must be authenticated as a Supabase user.
  app.post("/v1/oauth/authorize", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "User must be authenticated" } })
    }

    const parsed = authorizeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" } })
    }

    const { clientId, redirectUri, scopes, state, codeChallenge, codeChallengeMethod } = parsed.data

    const dApp = await findAppByClientId(clientId)
    if (!dApp) {
      return reply.status(404).send({ error: { code: "invalid_client", message: "Unknown client_id or app suspended" } })
    }

    if (!(dApp.redirect_uris as string[]).includes(redirectUri)) {
      return reply.status(400).send({ error: { code: "invalid_redirect_uri", message: "redirect_uri not registered for this app" } })
    }

    const requested = dApp.scopes_requested as string[]
    for (const s of scopes) {
      if (!requested.includes(s)) {
        return reply.status(400).send({ error: { code: "invalid_scope", message: `Scope ${s} not in app's scopes_requested` } })
      }
    }

    // PKCE: if codeChallenge is provided, codeChallengeMethod must be S256
    // (no plain method support). We refuse `plain` per current best practice.
    if (codeChallenge && codeChallengeMethod !== "S256") {
      return reply.status(400).send({ error: { code: "invalid_request", message: "code_challenge_method must be S256" } })
    }

    // Dynamic_mcp clients (RFC 7591 DCR): claim the row for this user on first
    // consent. Idempotent — re-consenting a second time is a no-op.
    if (dApp.kind === "dynamic_mcp" && dApp.owner_user_id == null) {
      await supabase
        .from("developer_apps")
        .update({ owner_user_id: req.userId })
        .eq("id", dApp.id)
        .is("owner_user_id", null)
    }

    const code = issueCode({
      appId: dApp.id as string,
      userId: req.userId,
      scopes,
      redirectUri,
      codeChallenge: codeChallenge ?? undefined,
      codeChallengeMethod: codeChallengeMethod ?? undefined,
    })

    return reply.send({ code, state: state ?? null, redirectUri })
  })

  // POST /v1/oauth/token — server-side; auth via client_id + (client_secret OR PKCE)
  app.post("/v1/oauth/token", async (req, reply) => {
    const parsed = tokenBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", error_description: parsed.error.issues[0]?.message ?? "Invalid request" })
    }
    const { client_id, client_secret, code, redirect_uri, code_verifier } = parsed.data

    const dApp = await findAppByClientId(client_id)
    if (!dApp) {
      return reply.status(401).send({ error: "invalid_client", error_description: "Unknown client" })
    }

    const grant = redeemCode(code, redirect_uri)
    if (!grant) {
      return reply.status(400).send({ error: "invalid_grant", error_description: "Code expired, used, or redirect_uri mismatch" })
    }

    if (grant.appId !== dApp.id) {
      return reply.status(400).send({ error: "invalid_grant", error_description: "Code does not belong to this client_id" })
    }

    // Authentication: PKCE if the code carried a code_challenge, otherwise client_secret.
    // Allow both being present — verify whichever path is in play.
    if (grant.codeChallenge) {
      if (!code_verifier) {
        return reply.status(400).send({ error: "invalid_request", error_description: "code_verifier required for PKCE" })
      }
      if (!verifyPkce(code_verifier, grant.codeChallenge)) {
        return reply.status(400).send({ error: "invalid_grant", error_description: "code_verifier does not match code_challenge" })
      }
    } else {
      // Non-PKCE flow — require client_secret.
      if (!client_secret) {
        return reply.status(401).send({ error: "invalid_client", error_description: "client_secret required for non-PKCE flow" })
      }
      const ok = await verifyClientSecret(dApp.client_secret_hash as string, client_secret)
      if (!ok) {
        return reply.status(401).send({ error: "invalid_client", error_description: "Bad client_secret" })
      }
    }

    const { data: auth, error: authErr } = await supabase
      .from("developer_app_authorizations")
      .upsert({
        app_id: grant.appId,
        user_id: grant.userId,
        scopes_granted: grant.scopes,
        revoked_at: null,
      }, { onConflict: "app_id,user_id" })
      .select("id")
      .single()
    if (authErr || !auth) {
      return reply.status(500).send({ error: "server_error", error_description: "Failed to create authorization" })
    }

    const plaintext = `ndr_app_${randomBytes(32).toString("hex")}`
    const tokenHash = hashToken(plaintext)
    const tokenPrefix = `${plaintext.slice(0, 12)}...`
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { error: tokErr } = await supabase
      .from("developer_app_tokens")
      .insert({
        authorization_id: auth.id,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        expires_at: expiresAt,
      })
    if (tokErr) {
      return reply.status(500).send({ error: "server_error", error_description: "Failed to mint token" })
    }

    return reply.send({
      access_token: plaintext,
      token_type: "Bearer",
      scope: formatScopeString(grant.scopes),
      expires_in: ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60,
    })
  })

  // POST /v1/oauth/revoke — RFC 7009: always 200, no info leak
  app.post("/v1/oauth/revoke", async (req, reply) => {
    const parsed = revokeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request" })
    }
    const tokenHash = hashToken(parsed.data.token)
    await supabase
      .from("developer_app_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", tokenHash)
    return reply.send({ success: true })
  })
}
