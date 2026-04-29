import { describe, it, expect } from "vitest"
import { buildUIResource, embedInitData } from "../builder.js"

describe("buildUIResource", () => {
  it("wraps rawHtml with mcp-app MIME type", () => {
    const r = buildUIResource({
      uri: "ui://nodaro/test",
      content: { type: "rawHtml", htmlString: "<h1>hi</h1>" },
      csp: { resourceDomains: ["https://assets.nodaro.ai"] },
    }) as { resource: { mimeType: string; text: string } }
    expect(r.resource.mimeType).toBe("text/html;profile=mcp-app")
    expect(r.resource.text).toBe("<h1>hi</h1>")
  })

  it("wraps CSP in _meta.ui per MCP Apps spec", () => {
    const r = buildUIResource({
      uri: "ui://test",
      content: { type: "rawHtml", htmlString: "" },
      csp: { resourceDomains: ["https://x.example"], connectDomains: ["https://api.example"] },
    })
    // CSP MUST be wrapped under `ui` key (canonical MCP Apps spec). Without
    // the `ui` wrapper, hosts silently fall back to text rendering.
    expect(r.resource._meta?.ui?.csp?.resourceDomains).toEqual(["https://x.example"])
    expect(r.resource._meta?.ui?.csp?.connectDomains).toEqual(["https://api.example"])
    // _meta MUST be inside resource, not at outer level
    expect((r as unknown as Record<string, unknown>)._meta).toBeUndefined()
  })
})

describe("embedInitData", () => {
  it("escapes embedded </script> to prevent breakout", () => {
    const html = embedInitData({ evil: "</script><script>alert(1)</script>" })
    const initSegment = html.match(/window\.__INIT__\s*=\s*[^;]+;/)?.[0] ?? ""
    expect(initSegment).not.toMatch(/<\/script>(?!<\\)/i)
  })
})
