/**
 * Builder for MCP UI resources — wraps an HTML payload (or an external iframe
 * URL) into the SDK-friendly resource shape that `tools/call` returns alongside
 * text content. The host (Claude.ai or another MCP client) renders the
 * resource into an iframe scoped by `resource._meta.ui.csp`.
 *
 * MIME type `text/html;profile=mcp-app` signals to the host that the payload
 * follows the MCP App protocol (ui/initialize + ui/message handshake — see
 * `_common.ts`).
 *
 * Wire shape (per the canonical MCP Apps spec — modelcontextprotocol/ext-apps):
 *   `_meta` lives INSIDE the `resource` object (not a sibling of `type`).
 *   All Apps metadata MUST be wrapped under a `ui` key:
 *     `_meta: { ui: { csp: {...}, permissions: {...}, domain, prefersBorder } }`
 *   CSP subkeys are `connectDomains` / `resourceDomains` / `frameDomains` /
 *   `baseUriDomains` (CSP-DOMAIN style, NOT CSP-DIRECTIVE style like
 *   `connect-src`). When `_meta.ui` is missing, hosts fall back to plain-text
 *   rendering and the widget shows up in chat as raw HTML.
 */
type ResourceContent = { type: "rawHtml"; htmlString: string } | { type: "externalUrl"; iframeUrl: string }

interface CSPDeclaration {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

interface BuildResourceOpts {
  uri: string
  content: ResourceContent
  csp?: CSPDeclaration
}

/**
 * The MCP SDK's `tools/call` content union accepts a `resource` shape with
 * `text: string` REQUIRED (not optional). We type the return concretely so
 * callers (gallery / single-job / workflow) don't need to cast.
 *
 * For `externalUrl` content we synthesize an empty-text resource — the SDK
 * doesn't accept `text: undefined`, and an empty string is harmless because
 * the host resolves the iframe via `resource.uri`, not the inline HTML.
 */
export interface UIResource {
  type: "resource"
  resource: {
    uri: string
    text: string
    mimeType: string
    _meta?: {
      ui?: {
        csp?: {
          connectDomains?: string[]
          resourceDomains?: string[]
          frameDomains?: string[]
          baseUriDomains?: string[]
        }
        prefersBorder?: boolean
      }
    }
  }
}

export function buildUIResource(opts: BuildResourceOpts): UIResource {
  const cspBlock = opts.csp
    ? {
        ...(opts.csp.connectDomains?.length ? { connectDomains: opts.csp.connectDomains } : {}),
        ...(opts.csp.resourceDomains?.length ? { resourceDomains: opts.csp.resourceDomains } : {}),
        ...(opts.csp.frameDomains?.length ? { frameDomains: opts.csp.frameDomains } : {}),
        ...(opts.csp.baseUriDomains?.length ? { baseUriDomains: opts.csp.baseUriDomains } : {}),
      }
    : null

  const uiMeta =
    cspBlock && Object.keys(cspBlock).length > 0
      ? { ui: { csp: cspBlock, prefersBorder: true } }
      : { ui: { prefersBorder: true } }

  return {
    type: "resource",
    resource: {
      uri: opts.uri,
      mimeType: "text/html;profile=mcp-app",
      text: opts.content.type === "rawHtml" ? opts.content.htmlString : "",
      _meta: uiMeta,
    },
  }
}

/** Embed JSON data on window.__INIT__ — escape </script> to prevent breakout. */
export function embedInitData(data: unknown): string {
  const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script")
  return `<script>window.__INIT__ = ${json};</script>`
}
