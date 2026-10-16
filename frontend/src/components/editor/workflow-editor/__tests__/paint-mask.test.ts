/**
 * paint-mask — frontend contract.
 *
 * A hand-painted mask is a first-class canvas value: the node is a SOURCE
 * (never executes — deliberately NOT in EXECUTABLE_TYPES), its painted
 * `data.maskUrl` is served by extractNodeOutput, its `mask` source pip types
 * as "mask" (purple edge), and the existing mask targets accept it.
 */
import { describe, it, expect } from "vitest"
import { NODE_DEFINITIONS } from "@/types/nodes"
import type { WorkflowNode } from "@/types/nodes"
import { extractNodeOutput } from "../execution-graph"
import { EXECUTABLE_TYPES } from "../types"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import {
  isValidPaintMaskConnection,
  isValidModifyImageConnection,
  isValidImageToImageConnection,
} from "@/lib/image-producer-handles"
import { IMAGE_PRODUCER_TYPES } from "@/lib/generate-image-handles"

const notPicker = () => false

function paintMaskNode(data: Record<string, unknown> = {}): WorkflowNode {
  return { id: "p1", type: "paint-mask", position: { x: 0, y: 0 }, data: { label: "Paint Mask", ...data } } as WorkflowNode
}

describe("paint-mask node definition", () => {
  const def = NODE_DEFINITIONS.find((d) => d.type === "paint-mask")

  it("exists with image + mask inputs and a single mask output", () => {
    expect(def).toBeDefined()
    expect(def!.inputs).toEqual(["image", "mask"])
    expect(def!.outputs).toEqual(["mask"])
  })

  it("is NOT executable — it is a source node whose data is the output", () => {
    expect(EXECUTABLE_TYPES.has("paint-mask")).toBe(false)
  })
})

describe("paint-mask output extraction (live DAG)", () => {
  it("serves the painted maskUrl for the mask handle", () => {
    const node = paintMaskNode({ maskUrl: "https://r2/painted.png" })
    expect(extractNodeOutput(node, "mask")).toBe("https://r2/painted.png")
  })

  it("returns undefined when nothing painted yet", () => {
    expect(extractNodeOutput(paintMaskNode(), "mask")).toBeUndefined()
  })
})

describe("paint-mask handle typing + wiring", () => {
  it("mask source pip types as 'mask' (purple edge, same as generate-mask)", () => {
    expect(HANDLE_OUTPUT_TYPES["paint-mask"]).toEqual({ mask: "mask" })
    expect(HANDLE_OUTPUT_TYPES["generate-mask"]!.mask).toBe("mask")
  })

  it("is an image producer, so existing mask targets accept it", () => {
    expect(IMAGE_PRODUCER_TYPES.has("paint-mask")).toBe(true)
    expect(isValidModifyImageConnection("mask", "paint-mask", notPicker)).toBe(true)
    expect(isValidImageToImageConnection("mask", "paint-mask", notPicker)).toBe(true)
  })

  it("its own targets accept image producers on both handles (mask handle seeds the painter)", () => {
    expect(isValidPaintMaskConnection("image", "upload-image")).toBe(true)
    expect(isValidPaintMaskConnection("image", "generate-image")).toBe(true)
    expect(isValidPaintMaskConnection("mask", "generate-mask")).toBe(true)
    expect(isValidPaintMaskConnection("mask", "paint-mask")).toBe(true)
  })

  it("rejects non-image producers and unknown handles", () => {
    expect(isValidPaintMaskConnection("image", "text-to-speech")).toBe(false)
    expect(isValidPaintMaskConnection("prompt", "generate-image")).toBe(false)
  })
})
