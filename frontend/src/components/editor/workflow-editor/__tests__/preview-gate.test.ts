import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import {
  editorPreviewGatedIds,
  previewRenderPreflight,
  previewRunnable,
  previewSingleRunRefusal,
  runPreviewGate,
  triggerBranchHoldsPreview,
} from "../preview-gate"
import { estimateRunCredits } from "../estimate-run-credits"

// PREVIEW_STOP_RULE_ENABLED, as /config.js hands it to the editor (decided
// 2026-10-05): on for these cases unless a case turns it off.
const previewRuleOn = () => { window.__NODARO_RUNTIME__ = { previewStopRule: true } }
const previewRuleOff = () => { delete window.__NODARO_RUNTIME__ }
beforeEach(previewRuleOn)
afterEach(previewRuleOff)

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, data, position: { x: 0, y: 0 } }) as unknown as WorkflowNode
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target }) as WorkflowEdge

function tighten(quality: "proxy" | "final") {
  const nodes = [
    node("plan", "edit-plan"),
    node("cut", "apply-edl", { quality }),
    node("cap", "add-captions"),
    node("img", "generate-image", { provider: "nano-banana" }),
  ]
  const edges = [edge("plan", "cut"), edge("cut", "cap"), edge("cap", "img")]
  return { nodes, edges }
}

describe("previewRunnable — what a run of these nodes executes", () => {
  it("drops the closure of a Preview render that runs", () => {
    const { nodes, edges } = tighten("proxy")
    expect(previewRunnable(nodes, nodes, edges).map((n) => n.id)).toEqual(["plan", "cut"])
  })

  it("keeps everything when the render is Final", () => {
    const { nodes, edges } = tighten("final")
    expect(previewRunnable(nodes, nodes, edges)).toHaveLength(4)
  })

  it("a run that leaves the render out does not stop at it (its saved output decides)", () => {
    const { nodes, edges } = tighten("proxy")
    const tail = nodes.filter((n) => n.id === "cap" || n.id === "img")
    expect(previewRunnable(tail, nodes, edges).map((n) => n.id)).toEqual(["cap", "img"])
  })
})

describe("the estimate a run quotes never prices a node the run will not execute", () => {
  it("estimateRunCredits leaves out the gated closure", () => {
    const priced = (id: string) => (id === "nano-banana" ? 40 : 0)
    const proxy = tighten("proxy")
    const final = tighten("final")
    expect(estimateRunCredits(proxy.nodes, proxy.nodes, proxy.edges, priced)).toBeLessThan(
      estimateRunCredits(final.nodes, final.nodes, final.edges, priced),
    )
  })
})

describe("editorPreviewGatedIds / previewSingleRunRefusal — the toolbar-run view", () => {
  it("gates the closure on the canvas as it stands; the render's own run stays allowed", () => {
    const { nodes, edges } = tighten("proxy")
    expect([...editorPreviewGatedIds(nodes, edges)].sort()).toEqual(["cap", "img"])
    expect(previewSingleRunRefusal("cap", nodes, edges)).toMatch(/Render final first/)
    expect(previewSingleRunRefusal("cut", nodes, edges)).toBeNull()
    expect(previewSingleRunRefusal("plan", nodes, edges)).toBeNull()
  })

  it("is memoised on the graph's identity and recomputed when it changes", () => {
    const a = tighten("proxy")
    expect(editorPreviewGatedIds(a.nodes, a.edges)).toBe(editorPreviewGatedIds(a.nodes, a.edges))
    const b = tighten("final")
    expect(editorPreviewGatedIds(b.nodes, b.edges).size).toBe(0)
  })
})

describe("previewRenderPreflight — a nested graph holding a Preview render", () => {
  it("refuses it", () => {
    const { nodes, edges } = tighten("proxy")
    expect(previewRenderPreflight(nodes, edges)).toMatch(/sub-workflow/)
  })
  it("passes a Final one", () => {
    const { nodes, edges } = tighten("final")
    expect(previewRenderPreflight(nodes, edges)).toBeNull()
  })
})


describe("triggerBranchHoldsPreview — an armed trigger whose fires the server refuses", () => {
  it("is true when the trigger's branch runs a Preview render", () => {
    const nodes = [node("trig", "schedule-trigger"), node("plan", "edit-plan"), node("cut", "apply-edl", { quality: "proxy" })]
    expect(triggerBranchHoldsPreview("trig", nodes, [edge("trig", "plan"), edge("plan", "cut")])).toBe(true)
  })

  it("is false when the Preview render sits off the trigger's branch", () => {
    const nodes = [
      node("trig", "webhook-trigger"),
      node("img", "generate-image"),
      node("plan", "edit-plan"),
      node("cut", "apply-edl", { quality: "proxy" }),
    ]
    expect(triggerBranchHoldsPreview("trig", nodes, [edge("trig", "img"), edge("plan", "cut")])).toBe(false)
  })

  it("an unwired trigger runs the whole workflow, render included", () => {
    const nodes = [node("trig", "telegram-trigger"), node("cut", "apply-edl", { quality: "proxy" })]
    expect(triggerBranchHoldsPreview("trig", nodes, [])).toBe(true)
  })

  it("a branch ancestor (a node the branch needs) counts too", () => {
    const nodes = [
      node("trig", "schedule-trigger"),
      node("cut", "apply-edl", { quality: "proxy" }),
      node("combine", "combine-videos"),
    ]
    expect(triggerBranchHoldsPreview("trig", nodes, [edge("trig", "combine"), edge("cut", "combine")])).toBe(true)
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): the editor as before the rule", () => {
  beforeEach(previewRuleOff)

  it("previewRunnable runs every node it is handed", () => {
    const { nodes, edges } = tighten("proxy")
    expect(previewRunnable(nodes, nodes, edges).map((n) => n.id)).toEqual(["plan", "cut", "cap", "img"])
  })

  it("nothing is gated, and no single-node run is refused", () => {
    const { nodes, edges } = tighten("proxy")
    expect([...editorPreviewGatedIds(nodes, edges)]).toEqual([])
    expect(previewSingleRunRefusal("cap", nodes, edges)).toBeNull()
  })

  it("the estimate prices the tail, exactly as a Final render's", () => {
    const priced = (id: string) => (id === "nano-banana" ? 40 : 0)
    const proxy = tighten("proxy")
    const final = tighten("final")
    expect(estimateRunCredits(proxy.nodes, proxy.nodes, proxy.edges, priced)).toBe(
      estimateRunCredits(final.nodes, final.nodes, final.edges, priced),
    )
  })

  it("a nested graph holding a Preview render is not refused", () => {
    const { nodes, edges } = tighten("proxy")
    expect(previewRenderPreflight(nodes, edges)).toBeNull()
  })

  it("no armed trigger is warned about", () => {
    const nodes = [node("trig", "schedule-trigger"), node("cut", "apply-edl", { quality: "proxy" })]
    expect(triggerBranchHoldsPreview("trig", nodes, [edge("trig", "cut")])).toBe(false)
  })

  it("the memo never serves the flag-on answer for the same graph", () => {
    const { nodes, edges } = tighten("proxy")
    previewRuleOn()
    expect(editorPreviewGatedIds(nodes, edges).size).toBe(2)
    previewRuleOff()
    expect(editorPreviewGatedIds(nodes, edges).size).toBe(0)
  })
})

describe("runPreviewGate — an app run on show (Render final in the app runner)", () => {
  const preview = { status: "completed", output: { videoUrl: "https://r2/p.mp4", quality: "proxy" } }
  const final = { status: "completed", output: { videoUrl: "https://r2/f.mp4", quality: "final" } }

  it("a render whose take is a Preview offers Render final; the nodes after it wait — whatever the snapshot's quality", () => {
    // The snapshot says Final; the run on show rendered a Preview (an input override).
    const { nodes, edges } = tighten("final")
    const gate = runPreviewGate(nodes, edges, { plan: { status: "completed" }, cut: preview, cap: { status: "skipped" } })
    expect([...gate.previewRenderIds]).toEqual(["cut"])
    expect([...gate.gatedNodeIds].sort()).toEqual(["cap", "img"])
  })

  it("once the final shows, nothing waits", () => {
    const { nodes, edges } = tighten("proxy")
    const gate = runPreviewGate(nodes, edges, { cut: final, cap: { status: "completed", output: {} }, img: { status: "completed" } })
    expect(gate.previewRenderIds.size).toBe(0)
    expect(gate.gatedNodeIds.size).toBe(0)
  })

  it("a node that ran on the preview anyway (a run from before the rule) keeps its result", () => {
    const { nodes, edges } = tighten("proxy")
    const gate = runPreviewGate(nodes, edges, { cut: preview, cap: { status: "completed", output: { videoUrl: "x" } } })
    expect([...gate.gatedNodeIds]).toEqual(["img"])
  })

  it("a batch: any row stamped proxy is a Preview take", () => {
    const { nodes, edges } = tighten("final")
    const batch = { status: "completed", output: { listResults: ["a", "b"], listResultStamps: [{ quality: "proxy" }, { quality: "proxy" }] } }
    expect([...runPreviewGate(nodes, edges, { cut: batch }).previewRenderIds]).toEqual(["cut"])
  })

  it("a Preview the run's own final made (a second Preview render further on) offers its own Render final; what follows it still waits", () => {
    // A chain (decided 2026-10-06): that Render final continues from the run's
    // newest final, one render at a time.
    const nodes = [node("plan", "edit-plan"), node("cut", "apply-edl", { quality: "proxy" }), node("cap", "add-captions"), node("cut2", "apply-edl", { quality: "proxy" }), node("img", "generate-image", { provider: "nano-banana" })]
    const edges = [edge("plan", "cut"), edge("cut", "cap"), edge("cap", "cut2"), edge("cut2", "img")]
    const gate = runPreviewGate(nodes, edges, {
      plan: { status: "completed" },
      cut: { ...final, fromRenderFinal: true },
      cap: { status: "completed", output: {}, fromRenderFinal: true },
      cut2: { ...preview, fromRenderFinal: true },
      img: { status: "skipped" },
    } as never)
    expect([...gate.previewRenderIds]).toEqual(["cut2"])
    expect([...gate.gatedNodeIds]).toEqual(["img"])
  })

  it("a render the run never reached offers nothing", () => {
    const { nodes, edges } = tighten("proxy")
    expect(runPreviewGate(nodes, edges, {}).previewRenderIds.size).toBe(0)
  })

  // Decided 2026-10-06: the app result card offers Render final whatever the
  // flag, as the editor's node does. With the flag off the run ran the whole
  // graph, so nothing waited; Render final re-renders the render at Final.
  it("off with the flag: a Preview take still offers Render final, and nothing waits", () => {
    previewRuleOff()
    const { nodes, edges } = tighten("proxy")
    const gate = runPreviewGate(nodes, edges, { cut: preview, cap: { status: "completed", output: { videoUrl: "x" } } })
    expect([...gate.previewRenderIds]).toEqual(["cut"])
    expect(gate.gatedNodeIds.size).toBe(0)
  })

  it("off with the flag: a Final take offers nothing", () => {
    previewRuleOff()
    const { nodes, edges } = tighten("proxy")
    expect(runPreviewGate(nodes, edges, { cut: final }).previewRenderIds.size).toBe(0)
  })
})
