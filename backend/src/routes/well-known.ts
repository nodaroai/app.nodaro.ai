import type { FastifyInstance } from "fastify"
import { config } from "../lib/config.js"
import { ALL_SCOPES } from "../lib/scopes.js"

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata
 * https://www.rfc-editor.org/rfc/rfc8414
 *
 * Lets MCP clients (Claude.ai, Cursor, etc.) discover our OAuth endpoints
 * and supported flows without hardcoding them.
 */
function authorizationServerMetadata() {
  const issuer = config.PUBLIC_URL || "https://app.nodaro.ai"
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
 * MCP resource (mcp.nodaro.ai). The resource lives on a different host than
 * the auth server, so this binding is required.
 */
function protectedResourceMetadata() {
  const issuer = config.PUBLIC_URL || "https://app.nodaro.ai"
  return {
    resource: "https://mcp.nodaro.ai/mcp",
    authorization_servers: [issuer],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ["header"],
  }
}

export async function registerWellKnown(app: FastifyInstance): Promise<void> {
  // RFC 8414 — base path
  app.get("/.well-known/oauth-authorization-server", async (_req, reply) => {
    return reply.header("Cache-Control", "public, max-age=3600").send(authorizationServerMetadata())
  })

  // RFC 9728 — base path
  app.get("/.well-known/oauth-protected-resource", async (_req, reply) => {
    return reply.header("Cache-Control", "public, max-age=3600").send(protectedResourceMetadata())
  })

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
  app.get("/.well-known/oauth-protected-resource/mcp", async (_req, reply) => {
    return reply.header("Cache-Control", "public, max-age=3600").send(protectedResourceMetadata())
  })
  app.get("/.well-known/oauth-authorization-server/mcp", async (_req, reply) => {
    return reply.header("Cache-Control", "public, max-age=3600").send(authorizationServerMetadata())
  })
}
