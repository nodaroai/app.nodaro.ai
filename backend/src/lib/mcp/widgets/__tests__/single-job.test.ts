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
  })

  it("image widget renders Animate + Edit text buttons on the left", () => {
    const html = buildSingleJobWidget("image")
    expect(html).toContain('id="btn-animate"')
    expect(html).toContain('id="btn-edit"')
    expect(html).toContain(">Animate<")
    expect(html).toContain(">Edit<")
  })

  it("non-image kinds omit image-only left buttons", () => {
    for (const kind of ["video", "audio", "generic"] as const) {
      const html = buildSingleJobWidget(kind)
      expect(html).not.toContain('id="btn-animate"')
      expect(html).not.toContain('id="btn-edit"')
    }
  })

  it("every kind exposes Copy / Download / Recreate icon utilities on the right", () => {
    for (const kind of ["image", "video", "audio", "generic"] as const) {
      const html = buildSingleJobWidget(kind)
      expect(html).toContain('id="btn-copy"')
      expect(html).toContain('id="btn-download"')
      expect(html).toContain('id="btn-recreate"')
    }
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
