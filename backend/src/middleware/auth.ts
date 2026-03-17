import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { supabase } from "../lib/supabase.js"
import { warmAdminCache } from "../lib/admin-check.js"

/**
 * Extend Fastify request with auth data.
 * After the auth hook runs, request.userId and request.userRole are available.
 */
declare module "fastify" {
  interface FastifyRequest {
    userId?: string
    userRole?: string
    creditReservation?: import("./credit-guard.js").CreditReservation
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
  { method: "GET", path: "/v1/social/callback", prefix: true },
  { method: "GET", path: "/v1/present/", prefix: true },
  { method: "GET", path: "/v1/app/", prefix: true },
  { method: "GET", path: "/v1/embed/", prefix: true },
  { method: "GET", path: "/v1/apps/browse" },
  { method: "GET", path: "/v1/templates/browse" },
  { method: "GET", path: "/v1/templates/", prefix: true },
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

export function registerAuthHook(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const isPublic = isPublicRoute(req.method, req.url)

    // Internal orchestrator calls: trust X-Internal-Orchestrator header ONLY from localhost
    // and extract userId from the request body (sync HTTP nodes pass userId in body)
    if (req.headers["x-internal-orchestrator"] === "true") {
      const remoteIp = req.ip
      if (remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1") {
        const body = req.body as Record<string, unknown> | undefined
        if (body?.userId && typeof body.userId === "string") {
          req.userId = body.userId
        }
        return
      }
      // External request with internal header — reject
      reply.status(403).send({
        error: { code: "forbidden", message: "Internal header not allowed from external sources" },
      })
      return
    }

    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined

    // Public routes: still try to resolve userId if a token is present (for optional auth)
    if (isPublic && !token) return

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
