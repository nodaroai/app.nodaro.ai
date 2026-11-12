import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { mcpLaneAddresses, mcpServedPath, metadataLane, type McpLane, type McpLaneAddresses } from "../lib/mcp-lane-addresses.js"
import { ALL_SCOPES } from "../lib/scopes.js"

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata
 * https://www.rfc-editor.org/rfc/rfc8414
 *
 * Lets MCP clients (Claude.ai, Cursor, etc.) discover our OAuth endpoints
 * and supported flows without hardcoding them. Every address in it is the
 * lane's issuer (lib/mcp-lane-addresses.ts).
 */
function authorizationServerMetadata(addresses: McpLaneAddresses) {
  const issuer = addresses.issuer
  return {
    issuer,
    authorization_endpoint: `${issuer}/v1/oauth/authorize`,
    token_endpoint: `${issuer}/v1/oauth/token`,
    registration_endpoint: `${issuer}/v1/oauth/register`,
    revocation_endpoint: `${issuer}/v1/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...ALL_SCOPES],
    revocation_endpoint_auth_methods_supported: ["client_secret_post"],
    service_documentation: `${issuer}/docs/oauth`,
  }
}

/**
 * RFC 9728 — OAuth 2.0 Protected Resource Metadata
 * https://www.rfc-editor.org/rfc/rfc9728
 *
 * Tells the MCP client which authorization server is authoritative for the
 * MCP resource. On the dedicated lane the resource lives on a different host
 * (mcp.nodaro.ai) than the auth server, so this binding is required; on the
 * path lane both are the host the client connected through.
 */
function protectedResourceMetadata(addresses: McpLaneAddresses) {
  return {
    resource: addresses.mcpUrl,
    authorization_servers: [addresses.issuer],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ["header"],
  }
}

/**
 * The dedicated lane's documents are one answer for the whole install, as
 * they always were: cacheable by anyone for an hour. The path lane's differ by
 * the host asked — and that host may come from `X-Forwarded-Host`, which a
 * shared cache does not key on — so they are private to the client that asked
 * (no edge may serve one host's addresses on another), and say what they vary
 * on.
 */
function sendMetadata(reply: FastifyReply, addresses: McpLaneAddresses, body: object) {
  if (addresses.lane === "path") {
    const vary = reply.getHeader("vary")
    const varyOn = vary ? `${String(vary)}, Host, X-Forwarded-Host` : "Host, X-Forwarded-Host"
    return reply.header("Cache-Control", "private, max-age=3600").header("Vary", varyOn).send(body)
  }
  return reply.header("Cache-Control", "public, max-age=3600").send(body)
}

function serve(lane: () => McpLane, document: (addresses: McpLaneAddresses) => object) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const addresses = mcpLaneAddresses(req, lane())
    return sendMetadata(reply, addresses, document(addresses))
  }
}

export async function registerWellKnown(app: FastifyInstance): Promise<void> {
  // The ROOT documents describe the endpoint this install's hosts serve: the
  // dedicated `/mcp` endpoint, or — on a deployment that serves MCP by path —
  // the path endpoint on the host asked (`metadataLane`, read per request).
  // RFC 8414 — base path
  app.get("/.well-known/oauth-authorization-server", serve(metadataLane, authorizationServerMetadata))

  // RFC 9728 — base path
  app.get("/.well-known/oauth-protected-resource", serve(metadataLane, protectedResourceMetadata))

  // RFC 9728 §3.1 — resource-specific variant. When the protected resource
  // has a path component (here `/mcp` on mcp.nodaro.ai), the metadata MUST
  // also be exposed at `/.well-known/oauth-protected-resource{resource_path}`.
  // Cursor (and other strict clients) hit this URL FIRST and treat a 404 or
  // 401 as a hard auth failure, dropping every scoped tool from the catalog
  // until the user re-authenticates. Without this route, Cursor flaps between
  // `connected` and `needsAuth` every few seconds.
  //
  // We also mirror the auth-server metadata at the same suffix because some
  // discovery flows probe both endpoints with the resource path.
  //
  // These two describe the dedicated `/mcp` endpoint. On a deployment that
  // serves MCP by path (lib/mcp-lane-addresses.ts) the same pair describes the
  // path endpoint at its own resource path instead, and `/mcp` has none: that
  // endpoint is not served there.
  const path = mcpServedPath()
  if (path) {
    const onPath = (): McpLane => "path"
    app.get(`/.well-known/oauth-protected-resource${path}`, serve(onPath, protectedResourceMetadata))
    app.get(`/.well-known/oauth-authorization-server${path}`, serve(onPath, authorizationServerMetadata))
    return
  }
  const dedicated = (): McpLane => "dedicated"
  app.get("/.well-known/oauth-protected-resource/mcp", serve(dedicated, protectedResourceMetadata))
  app.get("/.well-known/oauth-authorization-server/mcp", serve(dedicated, authorizationServerMetadata))
}
