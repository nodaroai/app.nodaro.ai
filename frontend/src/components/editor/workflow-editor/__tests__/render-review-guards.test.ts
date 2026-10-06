import { describe, it, expect, vi, beforeEach } from "vitest"
import { editPlanBasis } from "@nodaro/shared"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

let flag = true
vi.mock("@/lib/runtime-config", () => ({ runtimePreviewStopRule: () => flag }))
vi.mock("@/lib/i18n", () => ({ tx: (key: string) => key }))

import { renderOwnRunRefusal, replanEditLosses } from "../render-review-guards"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle?: string) =>
  ({ id: `${source}->${target}`, source, target, ...(targetHandle ? { targetHandle } : {}) }) as unknown as WorkflowEdge
const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
const plan = {
  version: 1, clock: "master", sources: [{ id: "v", url: "u", kind: "video" }],
  segments: [seg(0, 10_000), seg(20_000, 30_000)],
  dropped: [{ inMs: 10_000, outMs: 20_000, reason: "silence" }],
}
// The reviewer restored the silence (kept 0–30 s) and cut 5–6 s out of it.
const review = {
  v: 1, kind: "edl", basis: editPlanBasis(plan),
  edl: {
    segments: [seg(0, 5_000), seg(6_000, 30_000)],
    dropped: [{ inMs: 5_000, outMs: 6_000, reason: "manual" }],
  },
}

beforeEach(() => { flag = true })

describe("renderOwnRunRefusal (TA19 a)", () => {
  const multicam = {
    nodes: [node("p", "edit-plan", { generatedJson: plan, editedEdl: review }), node("cam", "camera-switch"), node("r", "apply-edl")],
    edges: [edge("p", "cam", "edl"), edge("cam", "r", "edl")],
  }
  const tighten = {
    nodes: [node("p", "edit-plan", { generatedJson: plan, editedEdl: review }), node("r", "apply-edl")],
    edges: [edge("p", "r", "edl")],
  }

  it("refuses the render's own ▶ behind Camera Switch once the plan holds edits", () => {
    expect(renderOwnRunRefusal("r", multicam.nodes, multicam.edges)).toBe("renderFinal.ownRunRefusal")
  })

  it("allows it with no edits, or straight from the plan (it reads the edited plan there)", () => {
    const unedited = multicam.nodes.map((n) => (n.id === "p" ? node("p", "edit-plan", { generatedJson: plan }) : n))
    expect(renderOwnRunRefusal("r", unedited, multicam.edges)).toBeNull()
    expect(renderOwnRunRefusal("r", tighten.nodes, tighten.edges)).toBeNull()
  })

  it("ignores an edit made on another plan (a re-plan made it stale)", () => {
    const stale = multicam.nodes.map((n) => (n.id === "p" ? node("p", "edit-plan", { generatedJson: plan, editedEdl: { ...review, basis: "old" } }) : n))
    expect(renderOwnRunRefusal("r", stale, multicam.edges)).toBeNull()
  })

  it("is hidden while the stop-rule flag is off (decided 2026-10-06)", () => {
    flag = false
    expect(renderOwnRunRefusal("r", multicam.nodes, multicam.edges)).toBeNull()
  })

  it("refuses a run that reaches the render without Camera Switch (Run from here / Run selected)", () => {
    expect(renderOwnRunRefusal("r", multicam.nodes, multicam.edges, new Set(["r"]))).toBe("renderFinal.ownRunRefusal")
    // Run from here on a node between Camera Switch and the render.
    const three = {
      nodes: [node("p", "edit-plan", { generatedJson: plan, editedEdl: review }), node("c1", "camera-switch"), node("c2", "camera-switch"), node("r", "apply-edl")],
      edges: [edge("p", "c1", "edl"), edge("c1", "c2", "edl"), edge("c2", "r", "edl")],
    }
    expect(renderOwnRunRefusal("r", three.nodes, three.edges, new Set(["c2", "r"]))).toBe("renderFinal.ownRunRefusal")
  })

  it("lets a run that includes every Camera Switch before the render through (it reads the edited plan)", () => {
    expect(renderOwnRunRefusal("r", multicam.nodes, multicam.edges, new Set(["cam", "r"]))).toBeNull()
    expect(renderOwnRunRefusal("r", multicam.nodes, multicam.edges, new Set(["p", "cam", "r"]))).toBeNull()
  })

  it("names the switch through a teleport, not the teleport", () => {
    const tele = {
      nodes: [node("p", "edit-plan", { generatedJson: plan, editedEdl: review }), node("cam", "camera-switch"), node("t1", "teleport-send"), node("t2", "teleport-receive"), node("r", "apply-edl")],
      edges: [edge("p", "cam", "edl"), edge("cam", "t1"), edge("t1", "t2"), edge("t2", "r", "edl")],
    }
    expect(renderOwnRunRefusal("r", tele.nodes, tele.edges, new Set(["r"]))).toBe("renderFinal.ownRunRefusal")
    expect(renderOwnRunRefusal("r", tele.nodes, tele.edges, new Set(["cam", "r"]))).toBeNull()
  })

  it("never refuses a node that is not a render", () => {
    expect(renderOwnRunRefusal("cam", multicam.nodes, multicam.edges)).toBeNull()
  })
})

describe("replanEditLosses (TA2 item 3)", () => {
  it("counts what the review restored and what the reviewer dropped", () => {
    const p = node("p", "edit-plan", { label: "Tighten Plan", generatedJson: plan, editedEdl: review })
    expect(replanEditLosses([p])).toEqual([{ planId: "p", label: "Tighten Plan", restored: 1, dropped: 1 }])
  })

  it("is empty when the plan holds no review, or the review is stale", () => {
    expect(replanEditLosses([node("p", "edit-plan", { generatedJson: plan })])).toEqual([])
    expect(replanEditLosses([node("p", "edit-plan", { generatedJson: plan, editedEdl: { ...review, basis: "old" } })])).toEqual([])
  })

  it("only reads plans a run would re-execute, and only Tighten reviews", () => {
    const clips = node("c", "edit-plan", { generatedJson: [plan], editedEdl: { v: 1, kind: "clips", basis: editPlanBasis([plan]), clips: [{ keep: false }] } })
    expect(replanEditLosses([clips, node("r", "apply-edl")])).toEqual([])
  })
})
