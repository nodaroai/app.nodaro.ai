import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getNodeOutput } from "../input-resolver.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
}

describe("reference-sheet panels → downstream referenceImageUrls", () => {
  it("spreads the panel set into referenceImageUrls when wired via the `panels` handle (live job output)", () => {
    const sheet = node("rs", "reference-sheet")
    const target = node("gi", "generate-image")
    const edges = [edge("rs", "gi", "panels", "references")]
    const states: Record<string, NodeExecutionState> = {
      rs: { status: "completed", output: { imageUrl: "https://sheet.png", panelUrls: ["https://a.png", "https://b.png"] } },
    }

    const result = resolveNodeInputs(target, edges, states, [sheet, target])
    expect(result.referenceImageUrls).toEqual(["https://a.png", "https://b.png"])
  })

  it("routes the `sheet` handle to a single image (NOT the panel spread)", () => {
    const sheet = node("rs", "reference-sheet")
    const target = node("iv", "image-to-video")
    const edges = [edge("rs", "iv", "sheet")]
    const states: Record<string, NodeExecutionState> = {
      rs: { status: "completed", output: { imageUrl: "https://sheet.png", panelUrls: ["https://a.png", "https://b.png"] } },
    }

    const result = resolveNodeInputs(target, edges, states, [sheet, target])
    expect(result.imageUrl).toBe("https://sheet.png")
    expect(result.referenceImageUrls ?? []).not.toContain("https://a.png")
  })

  it("getNodeOutput resolves the panels handle to the first panel URL", () => {
    const sheet = node("rs", "reference-sheet")
    const states: Record<string, NodeExecutionState> = {
      rs: { status: "completed", output: { imageUrl: "https://sheet.png", panelUrls: ["https://a.png", "https://b.png"] } },
    }
    expect(getNodeOutput(sheet, "panels", states)).toBe("https://a.png")
    expect(getNodeOutput(sheet, "sheet", states)).toBe("https://sheet.png")
  })

  it("appends panels to any pre-existing references on the consumer (multi-ref)", () => {
    const upload = node("up", "upload-image", { url: "https://up.png" })
    const sheet = node("rs", "reference-sheet")
    const target = node("gi", "generate-image")
    const edges = [edge("up", "gi", null, "references"), edge("rs", "gi", "panels", "references")]
    const states: Record<string, NodeExecutionState> = {
      rs: { status: "completed", output: { panelUrls: ["https://a.png"] } },
    }

    const result = resolveNodeInputs(target, edges, states, [upload, sheet, target])
    expect(result.referenceImageUrls).toContain("https://up.png")
    expect(result.referenceImageUrls).toContain("https://a.png")
  })
})
