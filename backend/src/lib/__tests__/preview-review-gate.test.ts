import { describe, it, expect, vi, beforeEach } from "vitest"
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared"

const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))
beforeEach(() => {
  flag.on = true
})
import {
  PREVIEW_REVIEW_REQUIRED_MESSAGE,
  previewReviewRefusal,
  runPreviewStops,
} from "../preview-review-gate.js"

type N = { id: string; type: string; data: Record<string, unknown>; parentId?: string }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data })
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

function graph(quality: "proxy" | "final") {
  return {
    nodes: [
      n("trig", "webhook-trigger"),
      n("plan", "edit-plan"),
      n("cut", "apply-edl", { quality }),
      n("cap", "add-captions"),
      n("side", "generate-image"),
    ],
    edges: [e("trig", "plan"), e("plan", "cut"), e("cut", "cap")],
  }
}

describe("runPreviewStops — the stop rule over the run the server will execute", () => {
  it("gates the closure of a Preview render that executes", () => {
    const { nodes, edges } = graph("proxy")
    expect([...runPreviewStops(nodes, edges, { nodeSubset: null }).gatedNodeIds]).toEqual(["cap"])
  })

  it("a render outside the run's subset does not execute (its saved output decides)", () => {
    const { nodes, edges } = graph("proxy")
    const stops = runPreviewStops(nodes, edges, { nodeSubset: new Set(["cap"]) })
    expect(stops.previewRenderIds).toEqual([])
  })

  it("a frozen render does not execute", () => {
    const { nodes, edges } = graph("proxy")
    nodes[2] = n("cut", "apply-edl", { quality: "proxy", skipped: true })
    expect(runPreviewStops(nodes, edges, { nodeSubset: null }).previewRenderIds).toEqual([])
  })
})

describe("previewReviewRefusal — nobody is there to review (TA9 a)", () => {
  it("refuses a run that holds a Preview render, with the stable code and the copy", () => {
    const { nodes, edges } = graph("proxy")
    expect(previewReviewRefusal(nodes, edges, { triggerType: "api" })).toEqual({
      code: PREVIEW_REVIEW_REQUIRED,
      message: PREVIEW_REVIEW_REQUIRED_MESSAGE,
    })
  })

  it("lets it through when the run overrides every Preview render to Final", () => {
    const { nodes, edges } = graph("proxy")
    expect(previewReviewRefusal(nodes, edges, { triggerType: "api", inputOverrides: { cut: { quality: "final" } } })).toBeNull()
  })

  it("lets a Final workflow through", () => {
    const { nodes, edges } = graph("final")
    expect(previewReviewRefusal(nodes, edges, { triggerType: "schedule" })).toBeNull()
  })

  it("scopes a triggered run to the branch behind its trigger", () => {
    const nodes = [
      n("trig", "webhook-trigger"),
      n("img", "generate-image"),
      n("plan", "edit-plan"),
      n("cut", "apply-edl", { quality: "proxy" }),
    ]
    const edges = [e("trig", "img"), e("plan", "cut")]
    // The Preview render sits off the trigger's branch: the fire never runs it.
    expect(previewReviewRefusal(nodes, edges, { triggerType: "webhook", triggerNodeId: "trig" })).toBeNull()
    // Wired into the branch, it does.
    expect(
      previewReviewRefusal(nodes, [...edges, e("trig", "plan")], { triggerType: "webhook", triggerNodeId: "trig" }),
    ).not.toBeNull()
  })

  it("an explicit subset wins over the trigger scope", () => {
    const { nodes, edges } = graph("proxy")
    expect(previewReviewRefusal(nodes, edges, { triggerType: "manual", nodeIds: ["side"] })).toBeNull()
    expect(previewReviewRefusal(nodes, edges, { triggerType: "manual", nodeIds: ["cut"] })).not.toBeNull()
  })

  it("ignores hidden loop-expansion clones", () => {
    const nodes = [{ ...n("cut", "apply-edl", { quality: "proxy" }), hidden: true }]
    expect(previewReviewRefusal(nodes, [], { triggerType: "api" })).toBeNull()
  })
})

describe("PREVIEW_STOP_RULE_ENABLED off (production until Render final): dev before the rule", () => {
  it("no run is refused, on any lane", () => {
    flag.on = false
    const { nodes, edges } = graph("proxy")
    for (const triggerType of ["api", "manual", "app_run", "schedule", "webhook", "telegram", "telegram_account"]) {
      expect(previewReviewRefusal(nodes, edges, { triggerType, triggerNodeId: "trig" })).toBeNull()
    }
  })

  it("nothing is gated and no render stops the run", () => {
    flag.on = false
    const { nodes, edges } = graph("proxy")
    const stops = runPreviewStops(nodes, edges, { nodeSubset: null })
    expect([...stops.gatedNodeIds]).toEqual([])
    expect(stops.previewRenderIds).toEqual([])
    expect(stops.savedPreviewRenderIds).toEqual([])
  })
})
