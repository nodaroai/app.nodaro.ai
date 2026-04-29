import { describe, it, expect } from "vitest"
import { buildGalleryWidgetTemplate } from "../gallery.js"

describe("gallery widget template", () => {
  it("renders grid scaffold + pagination + tool-result listener", () => {
    const html = buildGalleryWidgetTemplate()
    expect(html).toContain("grid.className = 'grid'")
    expect(html).toContain("pagination.className = 'pagination'")
    expect(html).toContain("mcp-tool-result")
    expect(html).not.toContain("window.__INIT__")
  })

  it("contains no innerHTML in runtime JS", () => {
    const html = buildGalleryWidgetTemplate()
    const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    for (const block of scriptBlocks) {
      expect(block).not.toMatch(/\.innerHTML\s*=/)
    }
  })
})
