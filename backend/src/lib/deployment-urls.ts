import { config } from "./config.js"
import { movedFlowOrigin } from "./moved-pages-settings.js"

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
 * Where the app's own pages live, for links that open one of them (the editor,
 * the gallery, billing, the archive). The Flow host's origin when the
 * deployment's move of its pages is on, by the one rule the proxy and the
 * browser read (`FLOW_PUBLIC_URL` or `FLOW_UI_ORIGIN`, a legacy host, a kept
 * `PUBLIC_URL`: lib/moved-pages-settings.ts), else `appBaseUrl()` exactly, so
 * an install without it links as it always has. The API, the OAuth issuer and
 * every machine-facing address stay on `appBaseUrl()`.
 */
export function flowBaseUrl(): string {
  return movedFlowOrigin(config) ?? appBaseUrl()
}

/**
 * The link that opens a workflow in the editor: the app's short
 * `/editor/<workflowId>` address, which looks up the workflow's project
 * itself — so the link a tool hands out keeps working after the workflow
 * moves to another project.
 */
export function workflowEditorUrl(workflowId: string): string {
  return `${flowBaseUrl()}/editor/${encodeURIComponent(workflowId)}`
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
