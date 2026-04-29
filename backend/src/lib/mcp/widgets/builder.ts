/**
 * Builder for MCP UI resources — wraps an HTML payload (or an external iframe
 * URL) into the SDK-friendly resource shape that `tools/call` returns alongside
 * text content. The host (Claude.ai or another MCP client) renders the
 * resource into an iframe scoped by `_meta["ui/csp"]`.
 *
 * MIME type `text/html;profile=mcp-app` signals to the host that the payload
 * follows the MCP App protocol (ui/initialize + ui/message handshake — see
 * `_common.ts`).
 */
type ResourceContent = { type: "rawHtml"; htmlString: string } | { type: "externalUrl"; iframeUrl: string }

interface CSPDeclaration {
  connectSrc?: string[]
  resourceSrc?: string[]
}

interface BuildResourceOpts {
  uri: string
  content: ResourceContent
  csp?: CSPDeclaration
}

export function buildUIResource(opts: BuildResourceOpts): unknown {
  return {
    type: "resource",
    resource: {
      uri: opts.uri,
      mimeType: "text/html;profile=mcp-app",
      text: opts.content.type === "rawHtml" ? opts.content.htmlString : undefined,
    },
    _meta: {
      "ui/csp": {
        "connect-src": opts.csp?.connectSrc ?? [],
        "resource-src": opts.csp?.resourceSrc ?? [],
      },
    },
  }
}

/** Embed JSON data on window.__INIT__ — escape </script> to prevent breakout. */
export function embedInitData(data: unknown): string {
  const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script")
  return `<script>window.__INIT__ = ${json};</script>`
}
