import { describe, it, expect } from "vitest"
import { buildWorkflowWidget } from "../workflow.js"

describe("workflow widget", () => {
  it("renders empty state", () => {
    const html = buildWorkflowWidget({ executionId: "e-1", name: "Marketing Video Generator" })
    expect(html).toContain("window.__INIT__")
    expect(html).toContain("Open in Nodaro")
    expect(html).toMatchSnapshot()
  })

  it("embeds pre-loaded node states into INIT data", () => {
    const html = buildWorkflowWidget({
      executionId: "e-2",
      name: "Test",
      nodeStates: [
        { id: "n1", label: "Generate image", status: "done" },
        { id: "n2", label: "Animate it", status: "running" },
      ],
    })
    // nodeStates is rendered at runtime via createElement, so the static HTML
    // doesn't contain the node DOM directly. We just verify the data is
    // embedded in the INIT script segment.
    const initSegment = html.match(/window\.__INIT__\s*=\s*([^;]+);/)?.[1] ?? ""
    expect(initSegment).toContain("Generate image")
    expect(initSegment).toContain("Animate it")
    expect(initSegment).toContain("running")
    expect(html).toMatchSnapshot()
  })

  it("contains no raw HTML assignment in runtime JS (safe DOM only)", () => {
    const html = buildWorkflowWidget({ executionId: "e-1", name: "Test" })
    const scriptBlocks = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    for (const block of scriptBlocks) {
      // The protocol shim is inlined too; both must be createElement-only.
      expect(block).not.toMatch(/\.innerHTML\s*=/)
    }
  })

  it("escapes user-controlled name to prevent JSON breakout", () => {
    const html = buildWorkflowWidget({
      executionId: "e-1",
      name: "</script><script>alert(1)</script>",
    })
    const initSegment = html.match(/window\.__INIT__\s*=\s*[^;]+;/)?.[0] ?? ""
    expect(initSegment).not.toMatch(/<\/script>(?!<\\)/i)
  })
})
