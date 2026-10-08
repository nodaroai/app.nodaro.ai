/**
 * The run-start refusal for an unpriced Speaker View: which nodes it names,
 * which it ignores, and that pricing the node (C4) turns it off.
 */
import { describe, expect, it } from "vitest"
import { speakerViewRunRefusal } from "@nodaro/render-rules"
import { speakerViewRunPreflight } from "../speaker-view-run-preflight.js"
import type { NestedRunGraph } from "../sub-workflow-handler.js"
import type { SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data }) as SimpleNode

describe("speakerViewRunRefusal / speakerViewRunPreflight", () => {
  it("names every Speaker View node the run executes", () => {
    const msg = speakerViewRunPreflight([node("a", "transcribe"), node("sv1", "speaker-view"), node("sv2", "speaker-view")])
    expect(msg).toContain("Speaker View is not priced yet")
    expect(msg).toContain("sv1, sv2")
    expect(msg).not.toContain("a,")
  })

  it("lets a run with no Speaker View start", () => {
    expect(speakerViewRunPreflight([node("a", "transcribe"), node("b", "camera-switch")])).toBeNull()
  })

  it("ignores a skipped Speaker View", () => {
    expect(speakerViewRunPreflight([node("sv1", "speaker-view", { skipped: true })])).toBeNull()
  })

  it("finds one in a nested graph and gives its path", () => {
    const graphs: NestedRunGraph[] = [{ nodes: [node("sv9", "speaker-view")], edges: [], subWorkflowPath: ["sw1", "sw2"] }]
    const msg = speakerViewRunPreflight([], graphs)
    expect(msg).toContain("sv9")
    expect(msg).toContain("Sub-workflow node sw1 → sw2")
  })

  it("is off once Speaker View is priced", () => {
    expect(speakerViewRunRefusal([node("sv1", "speaker-view")], true)).toBeNull()
  })
})
