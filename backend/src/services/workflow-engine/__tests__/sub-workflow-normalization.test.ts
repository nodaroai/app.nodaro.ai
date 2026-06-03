/**
 * Sub-workflow node-preparation normalization.
 *
 * The recursive sub-workflow path (`sub-workflow-handler.ts`) loads a referenced
 * workflow's raw nodes and must normalize legacy node types BEFORE the execution
 * graph reads `node.type` — exactly like the main orchestrator worker does. It
 * previously carried a SECOND, near-identical inline copy of the legacy migration
 * that (a) was missing `loop → list` and (b) threaded `parentId` onto each node.
 *
 * `prepareSubWorkflowNodes` is the single extracted seam that both the handler and
 * this test consume: it runs the shared `normalizeLegacyNodeTypes` helper and then
 * threads `parentId` (so group children keep their parent inside the sub-workflow
 * execution graph). This test is the regression net for both properties.
 */

import { describe, expect, it } from "vitest"
import type { SimpleNode } from "../types.js"
import { prepareSubWorkflowNodes } from "../sub-workflow-handler.js"

const node = (
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  parentId?: string,
): SimpleNode => ({ id, type, data, ...(parentId ? { parentId } : {}) })

describe("prepareSubWorkflowNodes", () => {
  it("rewrites legacy loop → canonical list (the gap this fix closes)", () => {
    const out = prepareSubWorkflowNodes([node("n", "loop", { columns: [], rows: [] })])
    expect(out[0].type).toBe("list")
  })

  it("preserves parentId on a rewritten loop node", () => {
    const out = prepareSubWorkflowNodes([node("c", "loop", {}, "g")])
    expect(out[0].type).toBe("list")
    expect(out[0].parentId).toBe("g")
  })

  it("threads parentId for group children (untouched passthrough node)", () => {
    const out = prepareSubWorkflowNodes([
      node("g", "group", { label: "G" }),
      node("c1", "text-prompt", { text: "x" }, "g"),
      node("c2", "text-prompt", { text: "y" }, "g"),
    ])
    expect(out[0].parentId).toBeUndefined()
    expect(out.filter((n) => n.parentId === "g")).toHaveLength(2)
    // passthrough nodes keep their type + data verbatim
    expect(out[1].type).toBe("text-prompt")
    expect(out[1].data).toEqual({ text: "x" })
  })

  it("preserves the existing legacy migrations (parity with the shared helper)", () => {
    const out = prepareSubWorkflowNodes([
      node("e1", "edit-image", { provider: "nano-banana-edit" }),
      node("e2", "edit-image", { provider: "recraft-remove-bg" }),
      node("e3", "edit-image", {}),
      node("i2i", "image-to-image", {}),
      node("oldc", "collect", {}),
      node("newc", "collect", { order: ["a"] }),
    ])
    expect(out.map((n) => n.type)).toEqual([
      "modify-image", // nano-banana-edit
      "remove-background", // recraft-remove-bg
      "upscale-image", // default edit-image
      "modify-image", // image-to-image
      "reduce", // old collect (no order[])
      "collect", // new collect (has order[]) — left untouched
    ])
  })

  it("threads parentId through the legacy edit-image migrations too", () => {
    const out = prepareSubWorkflowNodes([
      node("e", "edit-image", { provider: "nano-banana-edit" }, "grp"),
    ])
    expect(out[0].type).toBe("modify-image")
    expect(out[0].parentId).toBe("grp")
  })

  it("leaves unrelated node types untouched", () => {
    const out = prepareSubWorkflowNodes([
      node("a", "list", {}),
      node("b", "generate-image", {}),
    ])
    expect(out.map((n) => n.type)).toEqual(["list", "generate-image"])
  })

  it("is non-mutating — does not touch the input array or its nodes", () => {
    const input = [node("c", "loop", { columns: [] }, "g")]
    const snapshot = JSON.parse(JSON.stringify(input))
    prepareSubWorkflowNodes(input)
    expect(input).toEqual(snapshot)
    expect(input[0].type).toBe("loop")
  })
})
