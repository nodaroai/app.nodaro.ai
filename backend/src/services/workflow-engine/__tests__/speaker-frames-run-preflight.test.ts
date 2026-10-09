/** The run-start refusal for an unpriced Speaker Frames (P3.6, until P3.7). */
import { describe, expect, it } from "vitest"
import { speakerFramesRunPreflight } from "../speaker-frames-run-preflight.js"
import type { NestedRunGraph } from "../sub-workflow-handler.js"
import type { SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data }) as SimpleNode

describe("speakerFramesRunPreflight", () => {
  it("names every Speaker Frames node the run executes", () => {
    const msg = speakerFramesRunPreflight([node("a", "transcribe"), node("sf1", "speaker-frames"), node("sf2", "speaker-frames")])
    expect(msg).toContain("Speaker Frames is not priced yet")
    expect(msg).toContain("sf1, sf2")
  })
  it("lets a run with none start, and ignores a skipped one", () => {
    expect(speakerFramesRunPreflight([node("a", "transcribe")])).toBeNull()
    expect(speakerFramesRunPreflight([node("sf", "speaker-frames", { skipped: true })])).toBeNull()
  })
  it("finds one in a nested graph and gives its path", () => {
    const graphs: NestedRunGraph[] = [{ nodes: [node("sf9", "speaker-frames")], edges: [], subWorkflowPath: ["sw1"] }]
    const msg = speakerFramesRunPreflight([], graphs)
    expect(msg).toContain("sf9")
    expect(msg).toContain("Sub-workflow node sw1")
  })
})
