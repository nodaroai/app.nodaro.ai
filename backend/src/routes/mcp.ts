import type { FastifyInstance } from "fastify"
import { buildMcpServer } from "../lib/mcp/server.js"
import { handleMcpRequest } from "../lib/mcp/fastify-adapter.js"
import { config } from "../lib/config.js"
import { mcpBaseUrl } from "../lib/deployment-urls.js"
import type { Scope } from "../lib/scopes.js"

/**
 * Mount the MCP server at `POST/GET /mcp` behind the `MCP_ENABLED` flag.
 *
 * The route is the public surface that Claude.ai (and other MCP clients) hit
 * with a Bearer token issued by our OAuth server. The auth middleware
 * (`registerAuthHook`) has already resolved the token by the time this
 * handler runs:
 *   - `req.userId` is set when the bearer is a Supabase JWT or `ndr_app_*`
 *     OAuth token.
 *   - `req.appAuthorization` is set ONLY for `ndr_app_*` tokens. The Supabase
 *     JWT path leaves it undefined (the user owns all their resources, so
 *     scope checks are no-ops).
 *
 * `/mcp` is NOT in PUBLIC_ROUTES, so the middleware will have already 401'd
 * any request without a valid token before we get here. Defensive `!userId`
 * check below covers the unlikely edge case where the middleware allowed
 * through (e.g. a future refactor that whitelists this path).
 *
 * Per-request server: we build a fresh `McpServer` for every request rather
 * than caching, because each token carries a different (userId, scopes,
 * clientName) tuple and the SDK's `Server.connect()` keeps per-instance
 * transport state. Caching would leak identity and scopes across users.
 */
export async function registerMcpRoute(app: FastifyInstance): Promise<void> {
  if (!config.MCP_ENABLED) {
    app.log.info("MCP_ENABLED=false; skipping /mcp route registration")
    return
  }

  // `app.all()` covers POST (JSON-RPC requests) and GET (SSE upgrade for
  // server-initiated notifications). The SDK transport handles both shapes.
  //
  // bodyLimit: the inline-base64 upload tools were removed (uploads now go
  // through presigned/handoff/widget paths), so the old 32 MB ceiling is
  // obsolete. 8 MB comfortably covers the largest remaining payloads
  // (import_workflow / update_workflow_json JSON) while shrinking the
  // amplification surface of every other JSON-RPC call ~4×.
  //
  // rateLimit: the limiter is registered global:false, so opt the route in
  // here. The keyGenerator hashes the Authorization header (per-token), and
  // 600/min comfortably absorbs legitimate widget polling (get_asset every
  // 2s ≈ 30/min per active widget) while capping runaway/abusive clients.
  app.all(
    "/mcp",
    {
      bodyLimit: 8 * 1024 * 1024,
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
    if (!req.userId) {
      return reply
        .status(401)
        .header(
          "WWW-Authenticate",
          `Bearer realm="${mcpBaseUrl().replace(/^https?:\/\//, "")}", resource="${mcpBaseUrl()}/mcp"`,
        )
        .send({
          error: {
            code: "unauthorized",
            message:
              "MCP requires a Bearer token. See /.well-known/oauth-protected-resource.",
          },
        })
    }

    const scopes = (req.appAuthorization?.scopes ?? []) as Scope[]
    const clientName = req.appAuthorization
      ? await resolveClientName(req.appAuthorization.appId)
      : "Nodaro Web"

    const server = await buildMcpServer({
      userId: req.userId,
      scopes,
      clientName,
      fastify: app,
    })
    await handleMcpRequest(server, req, reply)
  })
}

/**
 * Resolve the human-readable client name for an `ndr_app_*` authorization.
 * Falls back to "Unknown MCP client" if the row was deleted or has a
 * null/empty name.
 */
// Cache appId → client name (5-min TTL, mirrors the auth token cache). The
// app name changes ~never, but resolveClientName runs on EVERY /mcp request —
// including each 2s widget poll — so an uncached lookup was a redundant
// developer_apps round-trip per poll.
const clientNameCache = new Map<string, { name: string; expires: number }>()
const CLIENT_NAME_TTL_MS = 5 * 60 * 1000

async function resolveClientName(appId: string): Promise<string> {
  const cached = clientNameCache.get(appId)
  if (cached && cached.expires > Date.now()) return cached.name
  const { supabase } = await import("../lib/supabase.js")
  const { data } = await supabase
    .from("developer_apps")
    .select("name")
    .eq("id", appId)
    .maybeSingle()
  const name = (data?.name as string) || "Unknown MCP client"
  clientNameCache.set(appId, { name, expires: Date.now() + CLIENT_NAME_TTL_MS })
  return name
}
