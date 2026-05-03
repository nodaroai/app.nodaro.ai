import { describe, it, expect } from "vitest"
import { buildUploadImageWidget } from "../upload-image.js"

describe("upload-image widget template", () => {
  const html = buildUploadImageWidget()

  it("includes the file picker + drop zone shell", () => {
    expect(html).toContain('id="file"')
    expect(html).toContain('id="drop"')
    expect(html).toContain('accept="image/*"')
    // capture=environment opens the rear camera on phones
    expect(html).toContain('capture="environment"')
  })

  it("listens for tool-result and reads upload_url + public_url", () => {
    expect(html).toContain("mcp-tool-result")
    expect(html).toContain("upload_url")
    expect(html).toContain("public_url")
  })

  it("announces the result via NodaroMCP.pushUserMessage on success", () => {
    expect(html).toContain("NodaroMCP.pushUserMessage")
    expect(html).toContain("uploaded and ready at")
  })

  it("does NOT use innerHTML in the runtime script (DOM-construction safety)", () => {
    const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    for (const block of scriptBlocks) {
      expect(block).not.toMatch(/\.innerHTML\s*=/)
    }
  })
})
