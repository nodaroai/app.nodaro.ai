import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"

const MCP_ALLOWED_PATHS: RegExp[] = [
  /^\/mcp(?:\/|$)/,
  /^\/\.well-known\/oauth-protected-resource(?:\/|$)/,
  // RFC 8414 mirror: the authoritative copy lives on the auth server
  // (app.nodaro.ai), but some MCP clients probe the RESOURCE host for
  // authorization-server metadata (legacy MCP discovery treats the MCP
  // server itself as the auth server). The route is host-agnostic, so
  // letting it through here serves identical metadata.
  /^\/\.well-known\/oauth-authorization-server(?:\/|$)/,
  // Upload proxy: prepare_*_upload tools issue tokens addressed to
  // mcp.nodaro.ai/v1/upload-proxy/<token>. LLM code-interpreter
  // sandboxes (Claude.ai etc.) allowlist this domain via OAuth
  // discovery, so PUTs land here and the route forwards to R2.
  /^\/v1\/upload-proxy\//,
  // Upload-handoff page: request_*_upload mints a token and gives the
  // user a https://${PUBLIC_URL}/v1/upload-page/<token> URL to open in
  // their own browser. PUBLIC_URL on the MCP server is mcp.nodaro.ai,
  // so without this entry the user clicks the link and lands on a
  // host-filter 404. Both GET (page render) and POST (multipart receive).
  /^\/v1\/upload-page\//,
  // Admin-only: how the server sees the caller (ee/routes/admin-access.ts).
  // This host reaches the backend WITHOUT the bundled Caddy, so the client
  // address derivation has to be checkable here too. Exact path.
  /^\/v1\/admin\/access\/whoami$/,
]

function isMcpHost(host: string): boolean {
  return host.startsWith("mcp.") && host.endsWith(".nodaro.ai")
}

function isAllowedOnMcpHost(path: string): boolean {
  return MCP_ALLOWED_PATHS.some((re) => re.test(path))
}

/**
 * Restricts the `mcp.*.nodaro.ai` subdomain to MCP-relevant paths only.
 *
 * The MCP server shares a backend with the main API (`app.nodaro.ai`) for ops
 * simplicity, but exposing every `/v1/*` route on `mcp.*` would be confusing
 * and broaden the visible attack surface. This onRequest hook returns 404 for
 * any request to `mcp.*.nodaro.ai/<not-mcp-path>`. Only `/mcp` and the
 * protected-resource discovery path resolve.
 *
 * Allowed on `mcp.*`:
 *   - `/mcp` (and any subpath, in case the MCP spec adds them)
 *   - `/.well-known/oauth-protected-resource` (RFC 9728 metadata for the
 *     resource server; clients probe this to discover the auth server)
 *   - `/.well-known/oauth-authorization-server` (RFC 8414 mirror for
 *     clients that probe the resource host instead of the auth server)
 *
 * Anything else on `mcp.*` returns 404 with a hint pointing at the discovery
 * URL. Hosts that aren't `mcp.*` are unaffected — `app.nodaro.ai` and
 * everything else fall through to normal routing.
 *
 * Registered BEFORE the auth hook so 404'd requests don't waste a DB lookup.
 */
export function registerMcpHostFilter(app: FastifyInstance): void {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const hostHeader = (req.hostname || req.headers.host || "").toLowerCase()
    const host = hostHeader.split(":")[0] ?? ""
    if (!isMcpHost(host)) return

    const path = req.url.split("?")[0] ?? ""
    if (isAllowedOnMcpHost(path)) return

    return reply.status(404).send({
      error: {
        code: "not_found",
        message: `Route ${req.method}:${path} not found on ${host}. This subdomain only serves MCP — see https://${host}/.well-known/oauth-protected-resource`,
      },
    })
  })
}
