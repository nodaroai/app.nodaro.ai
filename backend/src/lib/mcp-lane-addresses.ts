import { config } from "./config.js"
import { appBaseUrl, flowBaseUrl, mcpBaseUrl } from "./deployment-urls.js"
import { declaredOriginOfRequest, type HostRequestLike } from "./allowed-origins.js"
import { movedFlowOrigin } from "./moved-pages-settings.js"
import { surfaceMcpPath } from "./surface-profile.js"

/**
 * THE address funnel of the MCP lane: every absolute address the MCP endpoint,
 * its OAuth metadata, its 401 challenge, the sign-in redirect and the MCP tools
 * hand a client is read from one `McpLaneAddresses`, made here.
 * `lib/__tests__/mcp-lane-address-funnel.test.ts` fails the build when MCP code
 * builds one from `PUBLIC_URL` / `MCP_PUBLIC_URL`, the install-wide helpers or a
 * hard-coded host instead.
 *
 * Two lanes (decided 2026-11-11), never both on one install:
 *
 *  - `"dedicated"` — the MCP endpoint at `/mcp` on the install's dedicated MCP
 *    host (`MCP_PUBLIC_URL`). One fixed set of addresses for the whole install,
 *    each the value its site used before path mode existed, recorded from the
 *    code before the change: the endpoint, the metadata documents and the
 *    OAuth endpoints in `routes/__tests__/mcp-lane-off-fixture.test.ts`, what
 *    the tools and widgets hand a signed-in client in
 *    `routes/__tests__/mcp-lane-off-tools-fixture.test.ts`, and field by field
 *    in `lib/__tests__/mcp-lane-addresses.test.ts`. The hosted product runs
 *    only this lane.
 *  - `"path"` — only when the deployment serves MCP by path (`mcpServedPath`):
 *    the endpoint answers under a path on the deployment's own hosts INSTEAD
 *    of `/mcp`, and every address follows the host the client connected
 *    through — when the deployment DECLARED that host as its own
 *    (`declaredOriginOfRequest`: `PUBLIC_URL` + `CORS_ORIGIN`). Any other host —
 *    undeclared, malformed, a declared name on another port — gets the
 *    install's primary origin (`PUBLIC_URL`'s). The scheme and host always come
 *    from the declaration, never from what the request sent.
 */

export type McpLane = "dedicated" | "path"

export interface McpLaneAddresses {
  readonly lane: McpLane
  /** The MCP endpoint's address: the protected resource (RFC 9728 `resource`). */
  readonly mcpUrl: string
  /** The `realm` of the endpoint's 401 challenge. */
  readonly realm: string
  /**
   * The RFC 9728 metadata document of `mcpUrl` (the challenge's
   * `resource_metadata` parameter, §5.1). Null on the dedicated lane, whose
   * challenge has never carried one.
   */
  readonly resourceMetadataUrl: string | null
  /** RFC 8414 `issuer`: the OAuth endpoints and the consent page live under it. */
  readonly issuer: string
  /** Base of the `prepare_*_upload` PUT links (`/v1/upload-proxy/<token>`). */
  readonly uploadProxyBase: string
  /** Base of the upload widget's links (`/v1/upload-page/<token>`) and its iframe's connect-src. */
  readonly uploadPageBase: string
  /** Base of the `request_*_upload` hand-off links (`/v1/upload-page/<token>`). */
  readonly handoffPageBase: string
  /** Base of the links that open one of the app's pages (the editor, the gallery, the archive). */
  readonly pagesBase: string
  /** Base of the picker pictures this install serves itself. */
  readonly picturesBase: string
}

/**
 * Where this install serves its MCP endpoint by path, or null when it serves
 * the dedicated `/mcp` endpoint (today's behaviour). By path only when all
 * three hold: the surface profile asks (`surfaceMcpPath`), MCP is on
 * (`MCP_ENABLED`), and `PUBLIC_URL` is an http(s) URL — the primary origin
 * every undeclared host is answered with must be the deployment's own, never
 * a default. The one source the routes (routes/mcp.ts, routes/well-known.ts),
 * the auth hook's public rows and every address below read.
 */
export function mcpServedPath(): string | null {
  const path = surfaceMcpPath()
  if (path === null) return null
  if (config.MCP_ENABLED !== true) return null
  return httpOrigin(config.PUBLIC_URL ?? "") === null ? null : path
}

/** Whether this deployment serves MCP by path. */
export function mcpPathModeOn(): boolean {
  return mcpServedPath() !== null
}

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The lane the install's ROOT OAuth metadata documents and the shared consent
 * redirect (`GET /v1/oauth/authorize`) describe: the path lane while path mode
 * is on — a deployment that serves MCP by path has no dedicated MCP host, so
 * the documents on its hosts must describe the endpoint they serve — and the
 * dedicated lane otherwise.
 */
export function metadataLane(): McpLane {
  return mcpPathModeOn() ? "path" : "dedicated"
}

function stripScheme(base: string): string {
  return base.replace(/^https?:\/\//, "")
}

/** The origin of the install's primary address (PUBLIC_URL's, which `mcpServedPath` requires), path dropped. */
function primaryOrigin(): string {
  return httpOrigin(config.PUBLIC_URL ?? "") ?? appBaseUrl()
}

/**
 * The addresses one request's MCP lane states. `req` is the request the client
 * sent (its `Host` / `X-Forwarded-Host`, read by `requestHost`); without one —
 * an in-process session such as the Workflow Copilot — the install's primary
 * addresses. Asking for the path lane while path mode is off answers the
 * dedicated lane: a path-lane address can only exist on a deployment that
 * turned the mode on.
 */
export function mcpLaneAddresses(req?: HostRequestLike, lane: McpLane = "dedicated"): McpLaneAddresses {
  const path = lane === "path" ? mcpServedPath() : null
  if (path === null) {
    const mcpBase = mcpBaseUrl()
    const publicUrl = config.PUBLIC_URL ?? ""
    return {
      lane: "dedicated",
      mcpUrl: `${mcpBase}/mcp`,
      realm: stripScheme(mcpBase),
      resourceMetadataUrl: null,
      issuer: appBaseUrl(),
      uploadProxyBase: mcpBase,
      // Both spellings as they always were: the widget's base slash-stripped,
      // the hand-off link's PUBLIC_URL as configured.
      uploadPageBase: publicUrl.replace(/\/+$/, ""),
      handoffPageBase: publicUrl,
      pagesBase: flowBaseUrl(),
      picturesBase: appBaseUrl(),
    }
  }
  const base = (req ? declaredOriginOfRequest(req) : null) ?? primaryOrigin()
  return {
    lane: "path",
    mcpUrl: `${base}${path}`,
    realm: stripScheme(base),
    resourceMetadataUrl: `${base}/.well-known/oauth-protected-resource${path}`,
    issuer: base,
    uploadProxyBase: base,
    uploadPageBase: base,
    handoffPageBase: base,
    // A deployment that moved its pages to their own host keeps linking them
    // there (the other hosts would only redirect); otherwise the pages are on
    // the host the client connected through.
    pagesBase: movedFlowOrigin(config) ?? base,
    picturesBase: base,
  }
}

/** The link that opens a workflow in the editor, on the lane's pages host (lib/deployment-urls.ts `workflowEditorUrl`'s shape). */
export function laneEditorUrl(addresses: McpLaneAddresses, workflowId: string): string {
  return `${addresses.pagesBase}/editor/${encodeURIComponent(workflowId)}`
}
