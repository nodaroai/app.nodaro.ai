import { describe, it, expect } from "vitest"
import { getThreadMessages, buildStepChips, shouldExpandComposer, getMessageSummary } from "../chat-view-helpers"
import { ORIGINAL_SLOT_ID, type RunSlot } from "@/components/app-runner/types"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const slot = (over: Partial<RunSlot>): RunSlot => ({
  id: "s", name: null, inputValues: {}, nodeStates: {}, executionId: null,
  executionStatus: "idle", completedNodes: 0, totalNodes: 0, creditsUsed: 0,
  createdAt: 0, version: null, thumbnailUrl: null, ...over,
})

const node = (id: string, type: string): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id } }) as WorkflowNode

describe("getThreadMessages", () => {
  it("keeps original first, then launched user slots oldest→newest; drops idle drafts", () => {
    const original = slot({ id: ORIGINAL_SLOT_ID, nodeStates: { o: { status: "completed", output: { imageUrl: "u" } } } })
    const draft = slot({ id: "draft", executionStatus: "idle" })
    const r1 = slot({ id: "r1", executionStatus: "completed", createdAt: 1 })
    const r2 = slot({ id: "r2", executionStatus: "running", createdAt: 2 })
    // slots arrive [original, ...userNewestFirst]
    const out = getThreadMessages([original, draft, r2, r1])
    expect(out.map((m) => m.slot.id)).toEqual([ORIGINAL_SLOT_ID, "r1", "r2"])
    expect(out[0].isOriginal).toBe(true)
  })
  it("hides the original slot when it has no completed output", () => {
    const original = slot({ id: ORIGINAL_SLOT_ID, nodeStates: {} })
    expect(getThreadMessages([original]).length).toBe(0)
  })
})

describe("buildStepChips", () => {
  it("returns a deduped, topologically-ordered union of executable ancestors of outputs", () => {
    // a -> b -> d ; a -> c -> d  (diamond). all executable. output = d.
    const nodes = [node("a", "generate-image"), node("b", "edit-image"), node("c", "edit-image"), node("d", "generate-video")]
    const edges: WorkflowEdge[] = [
      { id: "1", source: "a", target: "b" }, { id: "2", source: "a", target: "c" },
      { id: "3", source: "b", target: "d" }, { id: "4", source: "c", target: "d" },
    ] as WorkflowEdge[]
    const chips = buildStepChips(nodes, edges, ["d"], { a: { status: "completed" }, b: { status: "running" } })
    expect(chips.map((c) => c.nodeId)).toEqual(["a", "b", "c", "d"]) // a once (no dup), before b/c; d last
    expect(chips.find((c) => c.nodeId === "a")?.status).toBe("completed")
    expect(chips.find((c) => c.nodeId === "b")?.status).toBe("running")
    expect(chips.find((c) => c.nodeId === "d")?.status).toBe("pending") // default
  })
  it("excludes non-executable nodes (e.g. parameter pickers / inputs)", () => {
    const nodes = [node("p", "setting"), node("g", "generate-image")]
    const edges = [{ id: "1", source: "p", target: "g" }] as WorkflowEdge[]
    const chips = buildStepChips(nodes, edges, ["g"], {})
    expect(chips.map((c) => c.nodeId)).toEqual(["g"])
  })
})

describe("shouldExpandComposer", () => {
  it("collapses for a single simple input", () => {
    expect(shouldExpandComposer([node("t", "text-prompt")])).toBe(false)
  })
  it("expands for a tall input (list / picker / avatar)", () => {
    expect(shouldExpandComposer([node("l", "list")])).toBe(true)
    expect(shouldExpandComposer([node("s", "setting")])).toBe(true)
  })
  it("expands when more than 2 inputs", () => {
    expect(shouldExpandComposer([node("a", "text-prompt"), node("b", "upload-image"), node("c", "upload-image")])).toBe(true)
  })
})

describe("getMessageSummary", () => {
  it("uses the first non-empty text input as the label and counts inputs + credits", () => {
    const s = slot({ inputValues: { t: { text: "hebrew" } }, creditsUsed: 15 })
    const sum = getMessageSummary(s, [node("t", "text-prompt"), node("u", "upload-image")])
    expect(sum.label).toBe("hebrew")
    expect(sum.inputCount).toBe(2)
    expect(sum.creditsUsed).toBe(15)
  })
  it("falls back to the run name when no text input", () => {
    const s = slot({ name: "Run 3", inputValues: { u: { url: "x" } } })
    expect(getMessageSummary(s, [node("u", "upload-image")]).label).toBe("Run 3")
  })
})
