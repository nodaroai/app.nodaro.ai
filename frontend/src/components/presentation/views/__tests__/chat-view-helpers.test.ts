import { describe, it, expect } from "vitest"
import { getThreadMessages, buildStepChips, getChipValue, resolveSlotResult } from "../chat-view-helpers"
import { ORIGINAL_SLOT_ID, type RunSlot } from "@/components/app-runner/types"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const slot = (over: Partial<RunSlot>): RunSlot => ({
  id: "s", name: null, inputValues: {}, nodeStates: {}, executionId: null,
  executionStatus: "idle", completedNodes: 0, totalNodes: 0, creditsUsed: 0,
  createdAt: 0, version: null, thumbnailUrl: null, ...over,
})

const node = (id: string, type: string, data: Record<string, unknown> = { label: id }): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as WorkflowNode

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

describe("getChipValue", () => {
  it("returns trimmed text for text-prompt", () => {
    expect(getChipValue(node("a", "text-prompt"), { a: { text: "  hi  " } })).toBe("hi")
  })
  it("summarises a single-column list as N items (pluralised)", () => {
    expect(getChipValue(node("l", "list"), { l: { items: ["x", "y"] } })).toBe("2 items")
    expect(getChipValue(node("l", "list"), { l: { items: ["x"] } })).toBe("1 item")
  })
  it("reads a parameter value via the node-data + input merge", () => {
    expect(getChipValue(node("m", "mood"), { m: { mood: "Joyful" } })).toBe("Joyful")
  })
  it("falls back to the first string field for generic parameter cards", () => {
    expect(getChipValue(node("p", "provider"), { p: { provider: "kie" } })).toBe("kie")
  })
  it("returns undefined for an empty upload and an empty text", () => {
    expect(getChipValue(node("u", "upload-image"), {})).toBeUndefined()
    expect(getChipValue(node("a", "text-prompt"), { a: { text: "   " } })).toBeUndefined()
  })
})

describe("resolveSlotResult", () => {
  const s = slot({
    inputValues: { in1: { url: "https://x/in.png" }, t: { text: "hello" } },
    nodeStates: { out1: { status: "completed", output: { imageUrl: "https://x/out.png" } } },
  })
  it("resolves an output url first", () => {
    expect(resolveSlotResult(s, "out1").url).toBe("https://x/out.png")
  })
  it("falls back to an input url / text", () => {
    expect(resolveSlotResult(s, "in1").url).toBe("https://x/in.png")
    expect(resolveSlotResult(s, "t").text).toBe("hello")
  })
})

