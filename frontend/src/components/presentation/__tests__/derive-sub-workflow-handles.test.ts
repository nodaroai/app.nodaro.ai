import { describe, it, expect } from "vitest"
import { deriveSubWorkflowHandles } from "../derive-sub-workflow-handles"
import type { WorkflowNode } from "@/types/nodes"

function mkNode(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as WorkflowNode
}

const port = (id: string, name: string, mediaType: "text" | "image" | "video" | "audio" | "any" = "text") => ({
  id,
  name,
  mediaType,
})

describe("deriveSubWorkflowHandles", () => {
  it("returns null when no sub-workflow nodes are present", () => {
    expect(deriveSubWorkflowHandles([
      mkNode("a", "generate-image", {}),
      mkNode("b", "text-prompt", {}),
    ])).toBeNull()
  })

  it("derives one input handle per port on each sub-workflow-input node", () => {
    const out = deriveSubWorkflowHandles([
      mkNode("in1", "sub-workflow-input", { routeId: "r1", ports: [port("pA", "Subject"), port("pB", "Style", "image")] }),
      mkNode("out1", "sub-workflow-output", { routeId: "r1", ports: [port("pX", "Result", "image")] }),
    ])!
    expect(out.inputs).toHaveLength(2)
    expect(out.inputs[0]).toEqual({
      id: "in1::pA",
      name: "Subject",
      type: "text",
      required: true,
      fieldKey: "pA",
    })
    expect(out.inputs[1]).toEqual({
      id: "in1::pB",
      name: "Style",
      type: "image",
      required: true,
      fieldKey: "pB",
    })
  })

  it("maps mediaType=any to handle type=text", () => {
    const out = deriveSubWorkflowHandles([
      mkNode("in1", "sub-workflow-input", { ports: [port("p1", "X", "any")] }),
    ])!
    expect(out.inputs[0].type).toBe("text")
  })

  it("first output port gets mediaPreview: true, others false", () => {
    const out = deriveSubWorkflowHandles([
      mkNode("out1", "sub-workflow-output", {
        ports: [port("p1", "Img", "image"), port("p2", "Vid", "video")],
      }),
      mkNode("out2", "sub-workflow-output", { ports: [port("p3", "Aud", "audio")] }),
    ])!
    expect(out.outputs.map((o) => o.mediaPreview)).toEqual([true, false, false])
    expect(out.outputs.map((o) => o.id)).toEqual(["out1::p1", "out1::p2", "out2::p3"])
  })

  it("falls back to a default name when port.name is empty", () => {
    const out = deriveSubWorkflowHandles([
      mkNode("in1", "sub-workflow-input", { ports: [port("p", "")] }),
      mkNode("out1", "sub-workflow-output", { ports: [port("p", "")] }),
    ])!
    expect(out.inputs[0].name).toBe("Input")
    expect(out.outputs[0].name).toBe("Output")
  })

  it("handles a node that has no ports array gracefully", () => {
    const out = deriveSubWorkflowHandles([
      mkNode("in1", "sub-workflow-input", {}),
      mkNode("out1", "sub-workflow-output", { ports: [port("p", "X")] }),
    ])!
    expect(out.inputs).toEqual([])
    expect(out.outputs).toHaveLength(1)
  })

  it("returns empty arrays (not null) when only one side is present", () => {
    const out = deriveSubWorkflowHandles([
      mkNode("in1", "sub-workflow-input", { ports: [port("p1", "X")] }),
    ])!
    expect(out.outputs).toEqual([])
    expect(out.inputs).toHaveLength(1)
  })
})
