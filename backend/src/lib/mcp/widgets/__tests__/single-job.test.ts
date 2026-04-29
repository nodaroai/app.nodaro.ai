import { describe, it, expect } from "vitest"
import { buildSingleJobWidget } from "../single-job.js"

describe("single-job widget template", () => {
  it("image widget references mcp-tool-result event", () => {
    const html = buildSingleJobWidget("image")
    // No more embedded init data — data flows via host events.
    expect(html).not.toContain("window.__INIT__")
    expect(html).toContain("mcp-tool-result")
    expect(html).toContain("mcp-tool-input")
    expect(html).toContain("mcp-progress")
    expect(html).toContain("Open in Nodaro")
  })

  it("does NOT contain innerHTML usage in runtime JS (safe DOM only)", () => {
    for (const kind of ["image", "video", "audio", "generic"] as const) {
      const html = buildSingleJobWidget(kind)
      const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
      for (const block of scriptBlocks) {
        expect(block).not.toMatch(/\.innerHTML\s*=/)
      }
    }
  })

  it("emits ui/initialize and ui/notifications/initialized handshake", () => {
    const html = buildSingleJobWidget("image")
    expect(html).toContain("ui/initialize")
    expect(html).toContain("ui/notifications/initialized")
  })

  it("video widget creates <video> element with controls", () => {
    const html = buildSingleJobWidget("video")
    expect(html).toContain("createElement('video')")
    expect(html).toContain("controls = true")
  })
})
