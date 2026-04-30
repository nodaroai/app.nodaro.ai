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
    // Hover-row buttons for image kind: Animate / Edit / Download.
    expect(html).toContain('data-action="animate"')
    expect(html).toContain('data-action="edit"')
    expect(html).toContain('data-action="download"')
    // Always-visible CTA below.
    expect(html).toContain('id="btn-recreate"')
  })

  it("video widget exposes Edit/Download but not Animate", () => {
    const html = buildSingleJobWidget("video")
    expect(html).toContain('data-action="edit"')
    expect(html).toContain('data-action="download"')
    expect(html).toContain('id="btn-recreate"')
    expect(html).not.toContain('data-action="animate"')
  })

  it("audio widget exposes Download + Recreate only", () => {
    const html = buildSingleJobWidget("audio")
    expect(html).toContain('data-action="download"')
    expect(html).toContain('id="btn-recreate"')
    expect(html).not.toContain('data-action="animate"')
    // Edit isn't offered for audio (no audio-edit verb in the catalog).
    expect(html).not.toContain('data-action="edit"')
  })

  it("uses the Nodaro brand color in the shimmer + Recreate CTA", () => {
    const html = buildSingleJobWidget("image")
    expect(html).toContain("--nodaro-brand")
    expect(html).toContain("#ff0073")
  })

  it("shows always-on download pill on top of the image", () => {
    for (const kind of ["image", "video"] as const) {
      const html = buildSingleJobWidget(kind)
      expect(html).toContain('id="dl-pill"')
      expect(html).toContain('class="download-pill"')
    }
  })

  it("includes a touch-device fallback that drops hover row out of overlay", () => {
    const html = buildSingleJobWidget("image")
    // Desktop: overlay is hover-gated.
    expect(html).toContain("@media (hover: hover)")
    // Touch: overlay becomes a static flex row, always visible.
    expect(html).toContain("@media (hover: none)")
  })

  it("renders a metadata badge row populated from tool args", () => {
    const html = buildSingleJobWidget("image")
    expect(html).toContain('id="meta"')
    expect(html).toContain('class="meta"')
    expect(html).toContain("renderMeta")
    // Ensures the host's chrome-duplicating brand mark + caption row I
    // briefly added are NOT present — Claude.ai already renders the
    // "Nodaro · generate_image" header so we don't need a second one.
    expect(html).not.toContain('class="brand-mark"')
  })

  it("uses transparent background + zero border on the outer card", () => {
    const html = buildSingleJobWidget("image")
    // The widget should not introduce its own card frame — Claude.ai's
    // host wraps the iframe in its own chrome.
    expect(html).toContain("background: transparent")
    expect(html).toContain("border: 0")
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
