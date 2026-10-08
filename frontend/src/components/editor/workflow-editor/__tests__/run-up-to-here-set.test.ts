import { describe, it, expect } from "vitest"
import { nodeHasRunOutput, runUpToHereSet } from "../run-up-to-here-set"

// "Run up to here" on a node runs the upstream nodes that have not run yet and
// never the node itself. A node counts as "run" when the SERVER could seed from
// it — the saved-output reader the editor mirrors (`extractNodeOutput`) — so a
// run that skips it never reaches a node with nothing to read.

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as never
const edge = (source: string, target: string, targetHandle = "in") =>
  ({ id: `${source}-${target}`, source, target, targetHandle }) as never

const img = (id: string, ran: boolean) =>
  node(id, "generate-image", ran ? { generatedResults: [{ url: "https://cdn/x.png" }], activeResultIndex: 0 } : {})

describe("nodeHasRunOutput", () => {
  it("reads a plain media node by its saved result", () => {
    expect(nodeHasRunOutput(img("a", true))).toBe(true)
    expect(nodeHasRunOutput(img("a", false))).toBe(false)
  })

  it("a failed node (an error, no result) has not run", () => {
    expect(nodeHasRunOutput(node("a", "generate-image", { executionStatus: "failed", errorMessage: "boom" }))).toBe(false)
  })

  it("reads Edit Plan by its plan", () => {
    const edl = { version: 1, clock: "master", sources: [], segments: [] }
    expect(nodeHasRunOutput(node("p", "edit-plan", { generatedJson: edl }))).toBe(true)
    expect(nodeHasRunOutput(node("p", "edit-plan", {}))).toBe(false)
  })

  it("reads Camera Switch by its { edl } pair", () => {
    expect(nodeHasRunOutput(node("c", "camera-switch", { generatedJson: { edl: { segments: [] } } }))).toBe(true)
    expect(nodeHasRunOutput(node("c", "camera-switch", {}))).toBe(false)
  })

  it("reads Transcribe by its transcript, text or take", () => {
    expect(nodeHasRunOutput(node("t", "transcribe", { generatedText: "hello" }))).toBe(true)
    expect(nodeHasRunOutput(node("t", "transcribe", { generatedJson: { words: [] } }))).toBe(true)
    expect(nodeHasRunOutput(node("t", "transcribe", {}))).toBe(false)
  })

  it("reads Apply EDL by its render", () => {
    expect(nodeHasRunOutput(node("r", "apply-edl", { generatedResults: [{ url: "https://cdn/r.mp4" }], activeResultIndex: 0 }))).toBe(true)
    expect(nodeHasRunOutput(node("r", "apply-edl", {}))).toBe(false)
  })
})

describe("runUpToHereSet", () => {
  it("runs the not-yet-run upstream nodes and never the node itself", () => {
    const nodes = [img("a", false), img("b", false), img("c", false)]
    const edges = [edge("a", "b"), edge("b", "c")]
    const set = runUpToHereSet("c", nodes, edges)
    expect(set.executable.map((n) => n.id).sort()).toEqual(["a", "b"])
    expect(set.ids.has("c")).toBe(false)
  })

  it("leaves out an upstream node that already has its output, and what only feeds it", () => {
    // a (never ran) -> b (ran) -> c: b hands c its saved output, so a is not needed.
    const nodes = [img("a", false), img("b", true), img("c", false)]
    const edges = [edge("a", "b"), edge("b", "c")]
    const set = runUpToHereSet("c", nodes, edges)
    expect(set.executable).toEqual([])
    expect(set.ids.has("a")).toBe(false)
    expect(set.ids.has("b")).toBe(false)
  })

  it("re-runs a failed upstream node", () => {
    const failed = node("a", "generate-image", { executionStatus: "failed", errorMessage: "x" })
    const set = runUpToHereSet("b", [failed, img("b", false)], [edge("a", "b")])
    expect(set.executable.map((n) => n.id)).toEqual(["a"])
  })

  it("does not run what is not upstream", () => {
    const nodes = [img("a", false), img("b", false), img("side", false), img("after", false)]
    const edges = [edge("a", "b"), edge("side", "after"), edge("b", "after")]
    const set = runUpToHereSet("b", nodes, edges)
    expect(set.executable.map((n) => n.id)).toEqual(["a"])
  })

  it("counts a node reached by two paths once", () => {
    const nodes = [img("a", false), img("b", false), img("c", false), img("d", false)]
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")]
    const set = runUpToHereSet("d", nodes, edges)
    expect(set.executable.map((n) => n.id).sort()).toEqual(["a", "b", "c"])
  })

  it("walks through a node that is not executable, keeping it in the run's ids", () => {
    const nodes = [img("a", false), node("t", "text-prompt", { text: "hi" }), img("c", false)]
    const edges = [edge("a", "t"), edge("t", "c")]
    const set = runUpToHereSet("c", nodes, edges)
    expect(set.executable.map((n) => n.id)).toEqual(["a"])
    expect(set.ids.has("t")).toBe(true)
  })

  it("leaves out hidden nodes and nodes marked skipped", () => {
    const hidden = { ...(img("h", false) as object), hidden: true } as never
    const skipped = node("s", "generate-image", { skipped: true })
    const set = runUpToHereSet("c", [hidden, skipped, img("c", false)], [edge("h", "c"), edge("s", "c")])
    expect(set.executable).toEqual([])
  })

  it("is empty for a node with nothing upstream, and survives a cycle", () => {
    expect(runUpToHereSet("a", [img("a", false)], []).executable).toEqual([])
    const nodes = [img("a", false), img("b", false)]
    const set = runUpToHereSet("b", nodes, [edge("a", "b"), edge("b", "a")])
    expect(set.executable.map((n) => n.id)).toEqual(["a"])
  })
})
