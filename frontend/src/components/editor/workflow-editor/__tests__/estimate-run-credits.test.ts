import { describe, it, expect, vi, afterEach } from "vitest"

vi.mock("@/components/editor/config-panels/helpers", () => ({
  getModelIdentifier: (n: { type?: string }) => `${n.type}-model`,
}))
vi.mock("../types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../types")>()
  // fan-out 2 × 1 unit for every node, and 3 output minutes for a render.
  return {
    ...actual,
    getCostFactors: (n: { type?: string }) =>
      n.type === "apply-edl" ? { fanOut: 1, units: 3, unitKind: "minute" } : { fanOut: 2, units: 1, unitKind: null },
  }
})

import { estimateRunCreditLines, estimateRunCredits, runNodeLabel, savedProviderIds, sumRunCreditLines } from "../estimate-run-credits"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NODE_DEF_MAP, type WorkflowNode } from "@/types/nodes"

function n(id: string, type: string, data: Record<string, unknown> = { label: id }): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as WorkflowNode
}

// Injected cached-cost lookup (the real one lives under @/ee).
const cachedCost = (id: string) => (id === "generate-image-model" ? 5 : id === "apply-edl-model" ? 10 : undefined)

describe("estimateRunCredits", () => {
  it("sums (cached cost or NODE_CREDIT_COSTS fallback) × the cost multiplier per node", () => {
    const nodes = [n("n1", "generate-image"), n("n2", "totally-unknown-type")]
    // n1: cached 5 × 2 = 10; n2: unknown → fallback 1 × 2 = 2 → 12
    expect(estimateRunCredits(nodes, nodes, [], cachedCost)).toBe(12)
  })

  it("a cold cache prices a node as the node's own estimate does, not the coarse type row", () => {
    // A Component carries its published price; the badge and the live app
    // estimate always read it — the confirm and precheck must read the same.
    const comp = n("c", "component", { label: "c", estimatedCredits: 40 })
    expect(estimateRunCredits([comp], [comp], [], () => undefined)).toBe(40 * 2)
  })

  it("returns 0 for an empty executable set", () => {
    expect(estimateRunCredits([], [], [], cachedCost)).toBe(0)
  })
})

// U1 (R16 a, decided 2026-10-06): the Render final and Update preview confirms
// show one line per node, and the total is computed from those same lines.
describe("estimateRunCreditLines", () => {
  it("one line per node that runs: its label, its quantity and its credits", () => {
    const nodes = [n("cut", "apply-edl", { label: "Apply Cut" }), n("img", "generate-image", { label: "Thumb" })]
    expect(estimateRunCreditLines(nodes, nodes, [], cachedCost)).toEqual([
      { nodeId: "cut", label: "Apply Cut", quantity: { fanOut: 1, units: 3, unitKind: "minute" }, credits: 30 },
      { nodeId: "img", label: "Thumb", quantity: { fanOut: 2, units: 1, unitKind: null }, credits: 10 },
    ])
  })

  it("a node with no label is named by its type's default label, never the raw type id", () => {
    const node = n("x", "apply-edl", {})
    expect(estimateRunCreditLines([node], [node], [], cachedCost)[0]!.label).toBe(NODE_DEF_MAP.get("apply-edl")!.label)
    expect(runNodeLabel(n("y", "add-captions", { label: "  " }))).toBe(NODE_DEF_MAP.get("add-captions")!.label)
    expect(runNodeLabel(n("y", "add-captions", { label: "  " }))).not.toBe("add-captions")
  })

  it("the total is the sum of the lines: the breakdown can never disagree with it", () => {
    const nodes = [n("n1", "generate-image"), n("n2", "totally-unknown-type"), n("n3", "apply-edl")]
    const lines = estimateRunCreditLines(nodes, nodes, [], cachedCost)
    expect(sumRunCreditLines(lines)).toBe(estimateRunCredits(nodes, nodes, [], cachedCost))
    expect(sumRunCreditLines(lines)).toBe(10 + 2 + 30)
  })
})

// Round 2 (decided 2026-10-06): in a Render final, a second render still set to
// Preview stops the run there. Its own line stays (it renders its preview);
// what it feeds has no line and is not in the total.
describe("estimateRunCreditLines — another Preview render after this one", () => {
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  it("the nodes behind the second Preview render get no line", () => {
    window.__NODARO_RUNTIME__ = { previewStopRule: true }
    const cut = n("cut", "apply-edl", { label: "Apply Cut", quality: "final" })
    const cap = n("cap", "add-captions", { label: "Add Captions" })
    const cut2 = n("cut2", "apply-edl", { label: "Render Clips", quality: "proxy" })
    const pack = n("pack", "add-captions", { label: "Clip Pack" })
    const nodes = [cut, cap, cut2, pack]
    const edges = [
      { id: "a", source: "cut", target: "cap" },
      { id: "b", source: "cap", target: "cut2", targetHandle: "sources" },
      { id: "c", source: "cut2", target: "pack" },
    ] as never
    const lines = estimateRunCreditLines(nodes, nodes, edges, cachedCost)
    expect(lines.map((l) => l.nodeId)).toEqual(["cut", "cap", "cut2"])
    expect(estimateRunCredits(nodes, nodes, edges, cachedCost)).toBe(sumRunCreditLines(lines))
  })
})

// Every surface that fetches prices asks for each of several providers' own,
// or a cold cache prices the second at the coarse generate-image row.
describe("savedProviderIds — what a workflow load prefetches", () => {
  it("names each of several providers on a node, once", () => {
    const img = n("img", "generate-image", { label: "img", provider: "gpt-image-2", providers: ["gpt-image-2", "nano-banana-pro"] })
    const vid = n("vid", "generate-video", { label: "vid", provider: "kling-3" })
    expect(savedProviderIds([img, vid]).sort()).toEqual(["gpt-image-2", "kling-3", "nano-banana-pro"])
  })
})

describe("the Execute-workflow badge is the run's own estimate", () => {
  it("computes through estimateWholeRun, never a loop of its own", () => {
    const src = readFileSync(join(__dirname, "../workflow-editor-main.tsx"), "utf8")
    expect(src).toContain("estimateWholeRun(")
    expect(src).not.toMatch(/getCostMultiplier\(/)
  })
})
