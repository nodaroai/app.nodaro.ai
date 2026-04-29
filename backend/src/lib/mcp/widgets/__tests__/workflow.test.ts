import { describe, it, expect } from "vitest"
import { buildWorkflowWidgetTemplate } from "../workflow.js"

describe("workflow widget template", () => {
  it("renders the static template", () => {
    const html = buildWorkflowWidgetTemplate()
    expect(html).toContain("Open in Nodaro")
    // Per-call data flows via tool-result event, NOT embedded init data.
    expect(html).not.toContain("window.__INIT__")
    expect(html).toContain("mcp-tool-result")
  })

  it("listens for ui/message bridged node:* progress:* output:* events", () => {
    const html = buildWorkflowWidgetTemplate()
    expect(html).toContain("mcp-ui-message")
    expect(html).toContain("nodeUpdate")
    expect(html).toContain("output")
  })

  it("contains no raw HTML assignment in runtime JS (safe DOM only)", () => {
    const html = buildWorkflowWidgetTemplate()
    const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    for (const block of scriptBlocks) {
      expect(block).not.toMatch(/\.innerHTML\s*=/)
    }
  })
})
