import { createHash, timingSafeEqual } from "node:crypto"
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { supabase } from "../lib/supabase.js"
import { config } from "../lib/config.js"
import { warmAdminCache } from "../lib/admin-check.js"
import { firstHeaderValue } from "../lib/request-helpers.js"
import { resolveApiToken } from "../lib/api-token-resolver.js"

/**
 * Extend Fastify request with auth data.
 * After the auth hook runs, request.userId and request.userRole are available.
 */
declare module "fastify" {
  interface FastifyRequest {
    userId?: string
    userRole?: string
    isAppRun?: boolean
    creditReservation?: import("./credit-guard.js").CreditReservation
    storageSnapshot?: import("./credit-guard.js").StorageSnapshot
    /** Set when the request is authenticated via a developer-app OAuth token. */
    appAuthorization?: {
      appId: string
      authorizationId: string
      scopes: readonly string[]
    }
  }
}

// ---------------------------------------------------------------------------
// Token verification cache (5-min TTL, keyed by last 32 chars of token)
// ---------------------------------------------------------------------------

interface CachedAuth {
  userId: string
  role: string | null
  expiresAt: number
}

const AUTH_CACHE_TTL_MS = 300_000 // 5 minutes
const authCache = new Map<string, CachedAuth>()

function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32)
}

function getCached(token: string): CachedAuth | undefined {
  const key = cacheKey(token)
  const entry = authCache.get(key)
  if (!entry) return undefined
  if (Date.now() >= entry.expiresAt) {
    authCache.delete(key)
    return undefined
  }
  return entry
}

function setCache(token: string, userId: string, role: string | null): void {
  const key = cacheKey(token)
  authCache.set(key, { userId, role, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })

  // Evict stale entries periodically (keep cache bounded)
  if (authCache.size > 5000) {
    const now = Date.now()
    for (const [k, v] of authCache) {
      if (now >= v.expiresAt) authCache.delete(k)
    }
  }
}

/**
 * Invalidate auth cache entries for a specific user.
 * Call this when admin role changes to force re-verification.
 */
export function invalidateAuthCache(userId: string): void {
  for (const [key, entry] of authCache) {
    if (entry.userId === userId) authCache.delete(key)
  }
}

// ---------------------------------------------------------------------------
// Public route whitelist — no auth required
// ---------------------------------------------------------------------------

const PUBLIC_ROUTES: { method?: string; path: string; prefix?: boolean }[] = [
  { path: "/health" },
  { method: "GET", path: "/v1/gallery" },
  { method: "GET", path: "/v1/gallery/items" },
  { path: "/v1/gallery/report" },
  { path: "/v1/download", prefix: true },
  { path: "/v1/billing/stripe-webhook" },
  { path: "/v1/image-proxy" },
  { path: "/v1/credits/model-cost" },
  { path: "/v1/credits/model-costs" },
  { path: "/v1/download-video/progress", prefix: true },
  { method: "GET", path: "/v1/voices" },
  { method: "GET", path: "/v1/voices/library" },
  { path: "/v1/webhooks", prefix: true },
  { method: "POST", path: "/v1/telegram/webhook/", prefix: true },
  { method: "GET", path: "/v1/social/callback", prefix: true },
  { method: "GET", path: "/v1/present/", prefix: true },
  { method: "GET", path: "/v1/app/", prefix: true },
  { method: "GET", path: "/og/app/", prefix: true },
  { method: "GET", path: "/v1/embed/", prefix: true },
  { method: "GET", path: "/v1/apps/browse" },
  { method: "GET", path: "/v1/templates/browse" },
  { method: "GET", path: "/v1/tutorials" },
  { method: "GET", path: "/v1/nodes" },
  { method: "GET", path: "/v1/nodes/", prefix: true },
  { method: "GET", path: "/v1/openapi.json" },
  { method: "GET", path: "/v1/templates/", prefix: true },
  { method: "POST", path: "/v1/oauth/token" },
  { method: "POST", path: "/v1/oauth/revoke" },
  { method: "GET", path: "/v1/oauth/app-info" },
  { method: "POST", path: "/v1/oauth/register" },
  // GET /v1/oauth/authorize 302-redirects to the frontend consent UI.
  // OAuth-spec-compliant clients (Claude.ai etc) hit this without a Bearer
  // token, so the route must be public.
  { method: "GET", path: "/v1/oauth/authorize" },
  { method: "GET", path: "/.well-known/oauth-authorization-server" },
  { method: "GET", path: "/.well-known/oauth-protected-resource" },
  // RFC 9728 §3.1 resource-specific variants. Cursor probes these FIRST
  // for a path-suffixed resource (mcp.nodaro.ai/mcp), and a 401 here causes
  // Cursor's MCP client to flap into needsAuth state and drop every scoped
  // tool from the catalog. Must be public for discovery to work.
  { method: "GET", path: "/.well-known/oauth-protected-resource/mcp" },
  { method: "GET", path: "/.well-known/oauth-authorization-server/mcp" },
  // /mcp must be "public" so a missing/invalid token falls through to the
  // route handler, which attaches the WWW-Authenticate Bearer challenge with
  // resource="https://mcp.nodaro.ai/mcp" — required by MCP clients (RFC 9728)
  // to discover OAuth via /.well-known/oauth-protected-resource.
  // Valid ndr_app_* and Supabase JWT tokens still resolve userId in the middleware
  // (per existing public-route token-handling logic).
  { method: "POST", path: "/mcp" },
  { method: "GET", path: "/mcp" },
  // Upload proxy: token in URL path is HMAC-signed and authoritative,
  // route validates internally. No bearer-token needed.
  { method: "PUT", path: "/v1/upload-proxy/", prefix: true },
  // Upload-handoff: a user-facing browser upload page + its multipart
  // receiver. Token in URL path is HMAC-signed and authoritative; the
  // user opens this from Claude's chat without being logged into Nodaro.
  { method: "GET", path: "/v1/upload-page/", prefix: true },
  { method: "POST", path: "/v1/upload-page/", prefix: true },
  // IMPORTANT: trailing slash is deliberate — "/v1/api/" matches "/v1/api/run", "/v1/api/schema", etc.
  // but NOT "/v1/api-tokens" (CRUD routes that require JWT auth).
  // These routes authenticate via Bearer token (API token), not JWT.
  { path: "/v1/api/", prefix: true },
]

function isPublicRoute(method: string, url: string): boolean {
  const path = url.split("?")[0] ?? url
  for (const route of PUBLIC_ROUTES) {
    if (route.method && route.method !== method) continue
    if (route.prefix) {
      if (path.startsWith(route.path)) return true
    } else {
      if (path === route.path) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Auth hook registration
// ---------------------------------------------------------------------------

// Timing-safe comparison that never throws for mismatched lengths.
function constantTimeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8")
  const bBuf = Buffer.from(b, "utf8")
  if (aBuf.length !== bBuf.length) {
    // Still compare against a buffer of the same length to avoid a short-circuit
    // timing side channel. The result is discarded.
    timingSafeEqual(aBuf, Buffer.alloc(aBuf.length))
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

export function registerAuthHook(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const isPublic = isPublicRoute(req.method, req.url)

    // Internal orchestrator calls: authenticate via shared-secret header, NOT req.ip.
    // (req.ip is unreliable behind the Caddy reverse proxy — every external request
    // arrives from 127.0.0.1 because Caddy proxies from localhost, which made the
    // previous IP-based check an auth bypass.)
    const internalSecretHeader = req.headers["x-internal-orchestrator-secret"]
    const hasInternalHeader =
      req.headers["x-internal-orchestrator"] !== undefined ||
      internalSecretHeader !== undefined
    if (hasInternalHeader) {
      const provided = firstHeaderValue(internalSecretHeader)
      if (typeof provided !== "string" || !constantTimeEqualStr(provided, config.INTERNAL_ORCHESTRATOR_SECRET)) {
        reply.status(403).send({
          error: { code: "forbidden", message: "Invalid internal orchestrator secret" },
        })
        return
      }
      const body = req.body as Record<string, unknown> | undefined
      if (body?.userId && typeof body.userId === "string") {
        req.userId = body.userId
      }
      if (firstHeaderValue(req.headers["x-app-run"]) === "true") {
        req.isAppRun = true
      }
      return
    }

    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined

    // Public routes: still try to resolve userId if a token is present (for optional auth)
    if (isPublic && !token) return

    // --- OAuth access token path (developer apps) ---
    if (token?.startsWith("ndr_app_")) {
      const tokenHash = createHash("sha256").update(token).digest("hex")
      const { data } = await supabase
        .from("developer_app_tokens")
        .select(`
          id, authorization_id, expires_at, revoked_at,
          developer_app_authorizations!inner ( id, app_id, user_id, scopes_granted, revoked_at )
        `)
        .eq("token_hash", tokenHash)
        .maybeSingle()

      if (!data || data.revoked_at) {
        if (isPublic) return
        reply.status(401).send({ error: { code: "unauthorized", message: "Invalid or revoked token" } })
        return
      }
      if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
        if (isPublic) return
        reply.status(401).send({ error: { code: "unauthorized", message: "Token expired" } })
        return
      }
      const authRow = data.developer_app_authorizations as unknown as {
        id: string
        app_id: string
        user_id: string
        scopes_granted: string[]
        revoked_at: string | null
      }
      if (authRow.revoked_at) {
        if (isPublic) return
        reply.status(401).send({ error: { code: "unauthorized", message: "Authorization revoked" } })
        return
      }

      req.userId = authRow.user_id
      req.appAuthorization = {
        appId: authRow.app_id,
        authorizationId: authRow.id,
        scopes: authRow.scopes_granted,
      }

      // Touch last_used_at (fire-and-forget — could be throttled in a follow-up)
      supabase
        .from("developer_app_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", data.id)
        .then(() => {})

      return
    }

    // --- Personal API token path (ndr_<64hex>, not OAuth) ---
    if (token?.startsWith("ndr_")) {
      const resolved = await resolveApiToken(token)
      if (!resolved) {
        if (isPublic) return
        reply.status(401).send({
          error: { code: "unauthorized", message: "Invalid or revoked API token" },
        })
        return
      }
      req.userId = resolved.userId
      req.apiToken = resolved
      return
    }

    if (token) {
      // --- JWT path: verify token ---
      const cached = getCached(token)
      if (cached) {
        req.userId = cached.userId
        req.userRole = cached.role ?? undefined
        if (cached.role) warmAdminCache(cached.userId, cached.role)
        return
      }

      const { data, error } = await supabase.auth.getUser(token)

      if (error || !data.user) {
        // Public routes: silently skip invalid tokens (optional auth)
        if (isPublic) return
        reply.status(401).send({
          error: { code: "unauthorized", message: "Invalid or expired token" },
        })
        return
      }

      const userId = data.user.id

      // Fetch role from profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single()

      const role = (profile?.role as string) ?? null

      setCache(token, userId, role)
      req.userId = userId
      req.userRole = role ?? undefined
      if (role) warmAdminCache(userId, role)
      return
    }

    // No valid token — reject (unless public route, already handled above)
    reply.status(401).send({
      error: { code: "unauthorized", message: "Authentication required" },
    })
  })
}
