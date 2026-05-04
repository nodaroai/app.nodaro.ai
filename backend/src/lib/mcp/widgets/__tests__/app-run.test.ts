import { describe, it, expect } from "vitest"
import { buildAppRunWidgetTemplate } from "../app-run.js"

describe("app-run widget template", () => {
  it("renders the static template", () => {
    const html = buildAppRunWidgetTemplate()
    expect(html).toContain("apprun-poll-")
    expect(html).toContain("get_app_run")
    expect(html).toContain("mcp-tool-result")
  })

  it("polls get_app_run and ingests outputs into the grid", () => {
    const html = buildAppRunWidgetTemplate()
    expect(html).toContain("startPolling")
    expect(html).toContain("state.items.push")
  })

  it("renders gallery-style tile + hover Use+Download overlay", () => {
    const html = buildAppRunWidgetTemplate()
    expect(html).toContain("hover-overlay")
    expect(html).toContain("'use'")
    expect(html).toContain("tile-download")
  })

  it("supports fullscreen detail with filmstrip + nav arrows", () => {
    const html = buildAppRunWidgetTemplate()
    expect(html).toContain("requestDisplayMode")
    expect(html).toContain("filmstrip")
    expect(html).toContain("nav-arrow")
  })

  it("contains no raw HTML assignment in runtime JS (safe DOM only)", () => {
    const html = buildAppRunWidgetTemplate()
    const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    for (const block of scriptBlocks) {
      expect(block).not.toMatch(/\.innerHTML\s*=/)
    }
  })
})
