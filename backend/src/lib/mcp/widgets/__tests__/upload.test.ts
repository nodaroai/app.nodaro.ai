import { describe, it, expect } from "vitest"
import { buildUploadWidget } from "../upload.js"

describe("upload widget template (per-kind)", () => {
  const kinds = ["image", "audio", "video"] as const

  for (const kind of kinds) {
    describe(kind, () => {
      const html = buildUploadWidget(kind)

      it(`accepts ${kind}/* MIME and shows the file picker shell`, () => {
        expect(html).toContain('id="file"')
        expect(html).toContain('id="drop"')
        expect(html).toContain(`accept="${kind}/*"`)
        // multi-file is now standard across all kinds
        expect(html).toContain("multiple")
      })

      it("includes capture attribute for camera/mic on mobile", () => {
        // capture=environment opens the rear camera / mic on phones
        expect(html).toContain('capture="environment"')
      })

      it("listens for mcp-tool-result and reads BOTH uploads array AND legacy single-file shape", () => {
        expect(html).toContain("mcp-tool-result")
        // multi-file shape (preferred)
        expect(html).toContain("uploads")
        // single-file fallback (back-compat with cached structuredContent)
        expect(html).toContain("upload_url")
        expect(html).toContain("public_url")
      })

      it("announces results via NodaroMCP.pushUserMessage", () => {
        expect(html).toContain("NodaroMCP.pushUserMessage")
      })

      it("does NOT use innerHTML in the runtime script (DOM-construction safety)", () => {
        const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
        for (const block of scriptBlocks) {
          expect(block).not.toMatch(/\.innerHTML\s*=/)
        }
      })
    })
  }

  it("varies the picker MIME per kind (no cross-contamination)", () => {
    expect(buildUploadWidget("image")).toContain('accept="image/*"')
    expect(buildUploadWidget("image")).not.toContain('accept="audio/*"')
    expect(buildUploadWidget("audio")).toContain('accept="audio/*"')
    expect(buildUploadWidget("audio")).not.toContain('accept="image/*"')
    expect(buildUploadWidget("video")).toContain('accept="video/*"')
    expect(buildUploadWidget("video")).not.toContain('accept="audio/*"')
  })
})
