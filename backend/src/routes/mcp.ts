import type { FastifyInstance } from "fastify"
import { buildMcpServer } from "../lib/mcp/server.js"
import { handleMcpRequest } from "../lib/mcp/fastify-adapter.js"
import { config } from "../lib/config.js"
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
  app.all("/mcp", async (req, reply) => {
    if (!req.userId) {
      return reply
        .status(401)
        .header(
          "WWW-Authenticate",
          `Bearer realm="mcp.nodaro.ai", resource="https://mcp.nodaro.ai/mcp"`,
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

    const server = buildMcpServer({ userId: req.userId, scopes, clientName, fastify: app })
    await handleMcpRequest(server, req, reply)
  })
}

/**
 * Resolve the human-readable client name for an `ndr_app_*` authorization.
 * Falls back to "Unknown MCP client" if the row was deleted or has a
 * null/empty name.
 */
async function resolveClientName(appId: string): Promise<string> {
  const { supabase } = await import("../lib/supabase.js")
  const { data } = await supabase
    .from("developer_apps")
    .select("name")
    .eq("id", appId)
    .maybeSingle()
  return (data?.name as string) || "Unknown MCP client"
}
