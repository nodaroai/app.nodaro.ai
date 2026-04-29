import { describe, it, expect } from "vitest"
import { buildUIResource, embedInitData } from "../builder.js"

describe("buildUIResource", () => {
  it("wraps rawHtml with mcp-app MIME type", () => {
    const r = buildUIResource({
      uri: "ui://nodaro/test",
      content: { type: "rawHtml", htmlString: "<h1>hi</h1>" },
      csp: { resourceSrc: ["https://assets.nodaro.ai"] },
    }) as { resource: { mimeType: string; text: string } }
    expect(r.resource.mimeType).toBe("text/html;profile=mcp-app")
    expect(r.resource.text).toBe("<h1>hi</h1>")
  })

  it("declares CSP in _meta", () => {
    const r = buildUIResource({
      uri: "ui://test",
      content: { type: "rawHtml", htmlString: "" },
      csp: { resourceSrc: ["https://x.example"] },
    }) as { _meta: { "ui/csp": { "resource-src": string[] } } }
    expect(r._meta["ui/csp"]["resource-src"]).toEqual(["https://x.example"])
  })
})

describe("embedInitData", () => {
  it("escapes embedded </script> to prevent breakout", () => {
    const html = embedInitData({ evil: "</script><script>alert(1)</script>" })
    const initSegment = html.match(/window\.__INIT__\s*=\s*[^;]+;/)?.[0] ?? ""
    expect(initSegment).not.toMatch(/<\/script>(?!<\\)/i)
  })
})
