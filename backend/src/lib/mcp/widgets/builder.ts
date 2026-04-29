/**
 * Builder for MCP UI resources — wraps an HTML payload (or an external iframe
 * URL) into the SDK-friendly resource shape that `tools/call` returns alongside
 * text content. The host (Claude.ai or another MCP client) renders the
 * resource into an iframe scoped by `resource._meta.csp`.
 *
 * MIME type `text/html;profile=mcp-app` signals to the host that the payload
 * follows the MCP App protocol (ui/initialize + ui/message handshake — see
 * `_common.ts`).
 *
 * Wire shape (per Claude.ai's MCP Apps spec — confirmed against host bundle):
 *   `_meta` lives INSIDE `resource`, not as a sibling of `type`.
 *   CSP keys are `connectDomains` / `resourceDomains` (NOT `connect-src` etc).
 *   When the metadata shape is wrong, Claude silently falls back to text
 *   rendering and the widget shows as raw HTML.
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
      csp?: {
        connectDomains?: string[]
        resourceDomains?: string[]
        frameDomains?: string[]
        baseUriDomains?: string[]
      }
    }
  }
}

export function buildUIResource(opts: BuildResourceOpts): UIResource {
  const cspMeta: UIResource["resource"]["_meta"] = opts.csp
    ? {
        csp: {
          ...(opts.csp.connectDomains?.length ? { connectDomains: opts.csp.connectDomains } : {}),
          ...(opts.csp.resourceDomains?.length ? { resourceDomains: opts.csp.resourceDomains } : {}),
          ...(opts.csp.frameDomains?.length ? { frameDomains: opts.csp.frameDomains } : {}),
          ...(opts.csp.baseUriDomains?.length ? { baseUriDomains: opts.csp.baseUriDomains } : {}),
        },
      }
    : undefined

  return {
    type: "resource",
    resource: {
      uri: opts.uri,
      mimeType: "text/html;profile=mcp-app",
      text: opts.content.type === "rawHtml" ? opts.content.htmlString : "",
      ...(cspMeta ? { _meta: cspMeta } : {}),
    },
  }
}

/** Embed JSON data on window.__INIT__ — escape </script> to prevent breakout. */
export function embedInitData(data: unknown): string {
  const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script")
  return `<script>window.__INIT__ = ${json};</script>`
}
