/**
 * Edge validation splits the difference deliberately: structural breakage
 * blocks the write, an unfamiliar handle name only warns. NODE_HANDLES is a
 * vocabulary with intentional gaps (dynamic list columns, group lane pips),
 * and blocking on it would refuse graphs the editor itself accepts.
 */
import { describe, expect, it } from "vitest"
import { knownNodeTypes, suggestNodeTypes, validateWorkflowEdges } from "../tools/edge-validation.js"

const nodes = [
  { id: "prompt", type: "text-prompt" },
  { id: "img", type: "generate-image" },
  { id: "vid", type: "image-to-video" },
  { id: "list", type: "list" },
]

describe("validateWorkflowEdges", () => {
  it("accepts a well-formed graph", () => {
    const result = validateWorkflowEdges(nodes, [
      // Real handles from the generated map: generate-image takes "prompt",
      // image-to-video takes "startFrame".
      { id: "e1", source: "prompt", sourceHandle: "prompt", target: "img", targetHandle: "prompt" },
      { id: "e2", source: "img", sourceHandle: "image", target: "vid", targetHandle: "startFrame" },
    ])
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it("errors on a dangling endpoint", () => {
    const result = validateWorkflowEdges(nodes, [{ id: "e1", source: "ghost", target: "img" }])
    expect(result.ok).toBe(false)
    expect(result.errors.join(" ")).toContain('source node "ghost" does not exist')
  })

  it("errors on a self-loop and on a duplicate edge id", () => {
    const selfLoop = validateWorkflowEdges(nodes, [{ id: "e1", source: "img", target: "img" }])
    expect(selfLoop.ok).toBe(false)
    const dupe = validateWorkflowEdges(nodes, [
      { id: "same", source: "prompt", target: "img" },
      { id: "same", source: "img", target: "vid" },
    ])
    expect(dupe.ok).toBe(false)
    expect(dupe.errors.join(" ")).toContain("duplicate edge id")
  })

  it("warns (does not block) on an unknown handle name", () => {
    const result = validateWorkflowEdges(nodes, [
      { id: "e1", source: "img", sourceHandle: "not-a-handle", target: "vid", targetHandle: "startFrame" },
    ])
    expect(result.ok).toBe(true)
    expect(result.warnings.join(" ")).toContain("not a published output")
  })

  it("does not warn about dynamic-handle types like list columns", () => {
    // `list` publishes no static outputs — its column handles are created at
    // run time, which is exactly the gap the dynamic-type exemption covers.
    const result = validateWorkflowEdges(nodes, [
      { id: "e1", source: "list", sourceHandle: "col_abc123", target: "img", targetHandle: "prompt" },
    ])
    expect(result.warnings).toEqual([])
  })

  it("warns when a non-video source feeds a video input", () => {
    const withMerge = [...nodes, { id: "merge", type: "merge-video-audio" }]
    const result = validateWorkflowEdges(withMerge, [
      { id: "e1", source: "img", sourceHandle: "image", target: "merge", targetHandle: "video" },
    ])
    expect(result.ok).toBe(true)
    expect(result.warnings.join(" ")).toContain("does not look like a video source")
  })
})

describe("node type catalog", () => {
  it("knows the real node types", () => {
    const types = knownNodeTypes()
    expect(types.length).toBeGreaterThan(150)
    expect(types).toContain("generate-image")
    expect(types).toContain("image-to-video")
  })

  it("suggests a close match for a typo", () => {
    expect(suggestNodeTypes("generate-imag")).toContain("generate-image")
    expect(suggestNodeTypes("zzzzzzzzzz")).toEqual([])
  })
})

describe("the owner's taught character lane", () => {
  it("character.image → generate-image.references is a PUBLISHED pair — no warning", () => {
    // Four entity types rendered an `image` source pip the generated map did
    // not declare, so the copilot was warned off the exact wiring the owner
    // teaches for multi-character scenes. The map now declares it.
    const result = validateWorkflowEdges(
      [...nodes, { id: "char", type: "character" }],
      [{ id: "e1", source: "char", sourceHandle: "image", target: "img", targetHandle: "references" }],
    )
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })
})
