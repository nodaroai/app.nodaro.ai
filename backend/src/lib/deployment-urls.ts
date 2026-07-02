import { config } from "./config.js"

/**
 * Public base URLs of this deployment, for user-facing links baked into MCP
 * tool text, widget JS, and OAuth discovery metadata. Env-driven with the
 * Nodaro Cloud domains as fallbacks, so an unset env preserves Cloud behavior
 * exactly; self-hosters set PUBLIC_URL (and MCP_PUBLIC_URL when the MCP host
 * differs) to keep every generated link on their own domain.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

/** Web-app base — gallery/editor/archive deep links and the OAuth issuer. */
export function appBaseUrl(): string {
  return stripTrailingSlash(config.PUBLIC_URL || "https://app.nodaro.ai")
}

/**
 * MCP host base. Deliberately NOT derived from PUBLIC_URL: LLM
 * code-interpreter sandboxes (Claude.ai) only allowlist the MCP resource host
 * they discover via RFC 9728, and on Nodaro Cloud that is the mcp. subdomain
 * (host-routed to the same Fastify instance), not the auth server at
 * PUBLIC_URL. Changing this value changes the protected-resource identity that
 * existing MCP clients have bound their OAuth tokens to.
 */
export function mcpBaseUrl(): string {
  return stripTrailingSlash(config.MCP_PUBLIC_URL || "https://mcp.nodaro.ai")
}
