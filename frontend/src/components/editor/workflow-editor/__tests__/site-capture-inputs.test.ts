/**
 * Canvas-side Site Capture routing — the twin of the backend site-capture-node suite:
 * a plain wire hands on the first still, a Bundle wire every still in page order,
 * and the json pip the capture as text.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs } from "../node-input-resolver"
import { extractNodeOutput } from "../execution-graph"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const CAPTURE = {
  title: "Acme",
  stills: [
    { index: 0, sectionOrder: 0, label: "Hero", category: "hero", url: "https://cdn.example/0.png" },
    { index: 1, sectionOrder: 2, label: "Pricing", category: "pricing", url: "https://cdn.example/1.png" },
  ],
  facts: ["$12 per month"],
}
const STILLS = ["https://cdn.example/0.png", "https://cdn.example/1.png"]

function node(id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}
function edge(source: string, target: string, sourceHandle: string, targetHandle: string, data?: Record<string, unknown>): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle, data } as WorkflowEdge
}

const sc = node("sc", "site-capture", { generatedJson: CAPTURE, __listResults: STILLS })

describe("Site Capture on the canvas", () => {
  it("extractNodeOutput: image (or no handle) → the first still; json → the capture as text", () => {
    expect(extractNodeOutput(sc, "image")).toBe(STILLS[0])
    expect(extractNodeOutput(sc)).toBe(STILLS[0])
    expect(extractNodeOutput(sc, "json")).toBe(JSON.stringify(CAPTURE))
  })

  it("a Bundle wire hands every still, in page order, to Slideshow", () => {
    const show = node("show", "slideshow")
    expect(resolveNodeInputs(show, [sc, show], [edge("sc", "show", "image", "images", { outputMode: "all" })]).imageUrls).toEqual(STILLS)
  })

  it("a plain wire into Image to Text hands on the first still as its image", () => {
    const i2t = node("i2t", "image-to-text")
    expect(resolveNodeInputs(i2t, [sc, i2t], [edge("sc", "i2t", "image", "image")]).imageUrl).toBe(STILLS[0])
  })

  it("the json pip into a prompt arrives as text", () => {
    const llm = node("llm", "llm-chat")
    expect(resolveNodeInputs(llm, [sc, llm], [edge("sc", "llm", "json", "prompt")]).prompt).toBe(JSON.stringify(CAPTURE))
  })
})
