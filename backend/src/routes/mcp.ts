import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { buildMcpServer } from "../lib/mcp/server.js"
import { handleMcpRequest } from "../lib/mcp/fastify-adapter.js"
import { conversationIdentityFromHeaders } from "../lib/mcp/flows/conversation-key.js"
import { config } from "../lib/config.js"
import { mcpLaneAddresses, mcpServedPath, type McpLane, type McpLaneAddresses } from "../lib/mcp-lane-addresses.js"
import { surfaceMcpPath } from "../lib/surface-profile.js"
import type { Scope } from "../lib/scopes.js"

/**
 * Mount the MCP server at `POST/GET /mcp` behind the `MCP_ENABLED` flag — or,
 * on a deployment that serves MCP by path (`mcp.byPath` in its surface
 * profile, lib/mcp-lane-addresses.ts), at that path instead.
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

  // MCP by path (decided 2026-11-11): a deployment with no host to spare for
  // MCP serves the endpoint under a path on its own hosts (default `/v1/mcp`,
  // which every edge already forwards to the API) INSTEAD of `/mcp`. Same
  // options and handler; only the addresses it states differ — they follow
  // the declared host the client connected through. `/mcp` is not served
  // then: it could only state the dedicated MCP host, which such a deployment
  // does not have. Every other install registers exactly the route it always
  // had.
  //
  // `app.all()` covers POST (JSON-RPC requests) and GET (SSE upgrade for
  // server-initiated notifications). The SDK transport handles both shapes.
  const path = mcpServedPath()
  if (path) {
    app.all(path, mcpRouteOptions(), mcpHandler(app, "path"))
    return
  }
  if (surfaceMcpPath() !== null) {
    app.log.warn("[mcp] the surface profile sets mcp.byPath, but PUBLIC_URL is not an http(s) URL: MCP stays on /mcp (MCP by path states every undeclared host as PUBLIC_URL's origin)")
  }
  app.all("/mcp", mcpRouteOptions(), mcpHandler(app, "dedicated"))
}

/**
 * The route options every MCP endpoint shares — one factory so the dedicated
 * and the path endpoint cannot drift apart, and a fresh object per route
 * because Fastify keeps per-route state on what it is handed.
 *
 * bodyLimit: the inline-base64 upload tools were removed (uploads now go
 * through presigned/handoff/widget paths), so the old 32 MB ceiling is
 * obsolete. 8 MB comfortably covers the largest remaining payloads
 * (import_workflow / update_workflow_json JSON) while shrinking the
 * amplification surface of every other JSON-RPC call ~4×.
 *
 * rateLimit: the limiter is registered global:false, so opt the route in
 * here. The keyGenerator hashes the Authorization header (per-token), and
 * 600/min comfortably absorbs legitimate widget polling (get_asset every
 * 2s ≈ 30/min per active widget) while capping runaway/abusive clients.
 */
function mcpRouteOptions() {
  return {
    bodyLimit: 8 * 1024 * 1024,
    // mcpTransport: the concurrency lanes bound this endpoint's live waits by
    // the `mcp` ceiling (lib/concurrency-lanes/request-scope.ts).
    config: { rateLimit: { max: 600, timeWindow: "1 minute" }, mcpTransport: true as const },
  }
}

/**
 * The challenge a client without a valid token gets (RFC 6750 §3, RFC 9728
 * §5.1). On the dedicated lane it is exactly what it has always been; on the
 * path lane it also names the endpoint's metadata document
 * (`resource_metadata`), so a client finds the sign-in for the host it
 * connected through without guessing.
 */
function bearerChallenge(addresses: McpLaneAddresses): string {
  const base = `Bearer realm="${addresses.realm}", resource="${addresses.mcpUrl}"`
  return addresses.resourceMetadataUrl ? `${base}, resource_metadata="${addresses.resourceMetadataUrl}"` : base
}

function mcpHandler(app: FastifyInstance, lane: McpLane) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const addresses = mcpLaneAddresses(req, lane)
    if (!req.userId) {
      return reply
        .status(401)
        .header("WWW-Authenticate", bearerChallenge(addresses))
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

    // NO `firstParty` HERE, and never one. That flag marks a session the
    // server built for a browser (JWT) user in-process, and this is the public
    // door: `clientName` is `developer_apps.name` — chosen by a third-party
    // developer — and the bearer is a token, whoever consented to it. On a
    // deployment-payer instance the flag is what lets the billing account's own
    // Copilot read the pool balance, so setting it here would hand that figure
    // to any token that account ever approved. Omitted ⇒ false ⇒ refused.
    const server = await buildMcpServer({
      userId: req.userId,
      scopes,
      clientName,
      fastify: app,
      // Which chat this call belongs to, so it lands in that conversation's flow.
      conversation: conversationIdentityFromHeaders(req.headers, clientName),
      // Every address the session's tools hand out (upload links, the upload
      // widget's connect-src, editor / gallery links), for the host this
      // request came in on.
      addresses,
    })
    await handleMcpRequest(server, req, reply)
  }
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
