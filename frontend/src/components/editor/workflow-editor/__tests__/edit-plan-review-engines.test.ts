/**
 * An Edit Plan holding a person's review, read in the BROWSER engine — the
 * editor half of the cross-engine check (A5.2; TA13, TA16, TA17).
 *
 * The fixture (shared with backend edit-plan-review-engines.test.ts) holds plan
 * nodes with an `editedEdl` beside the planner's output. The canvas must hand
 * a render exactly what the server hands it: a clip set on the PLAN's indices
 * with "" at every dropped clip (a fan-out skips them; a scalar read is the
 * first kept clip), a Tighten plan's edited cut, and never the planner's clips
 * an older server run persisted on `__listResults`. The estimate counts and
 * prices the kept clips only.
 */
import { describe, it, expect, vi } from "vitest"

let storeNodes: unknown[] = []
let storeEdges: unknown[] = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({ characterDefinitions: [], nodes: storeNodes, edges: storeEdges }),
  },
}))

import { extractNodeOutput } from "../execution-graph"
import { extractNodeOutputAsList, getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"
import { PRODUCER_FAN_OUT, getFanOutMultiplier, NO_RERUNS } from "../types"
import { persistedEdlPlan, resolveApplyEdlEstimateMinutes } from "@/lib/apply-edl-estimate"
import fixture from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/edit-plan-review.json"

/* eslint-disable @typescript-eslint/no-explicit-any */
const asNode = (n: { id: string; type: string; data: Record<string, unknown> }): any => ({ ...n, position: { x: 0, y: 0 } })
const render = asNode({ id: "render-clip", type: "apply-edl", data: { label: "Render Clip", output: "video", quality: "proxy" } })
const wire = (planId: string, outputMode?: "each" | "last"): any => ({
  id: "e-edl", source: planId, sourceHandle: "edl", target: render.id, targetHandle: "edl",
  ...(outputMode ? { data: { outputMode } } : {}),
})

interface Case {
  status: string
  plan: { id: string; type: string; data: Record<string, unknown> }
  expected: { scalar: string | null; list: string[] | null; fanOut: { items: string[]; rowIndices: number[] } | null }
}
const cases = Object.entries(fixture.cases as unknown as Record<string, Case>)

describe.each(cases)("a reviewed Edit Plan in the browser: %s", (_name, c) => {
  const plan = asNode(c.plan)

  it("its scalar output is the first kept clip, or the edited cut", () => {
    expect(extractNodeOutput(plan, "edl") ?? null).toEqual(c.expected.scalar)
  })

  it("its list is the resolved one — never the persisted __listResults", () => {
    expect(extractNodeOutputAsList(plan, "edl") ?? null).toEqual(c.expected.list)
  })

  it("an each edge fans out over the kept clips only, on the plan's rows", () => {
    const fanOut = getListFanOutForNode(render, [plan, render], [wire(plan.id)])
    expect(fanOut ? { items: fanOut.items, rowIndices: fanOut.rowIndices } : null).toEqual(c.expected.fanOut)
  })

  it("a scalar edge hands the render what the server hands it", () => {
    storeNodes = [plan, render]
    storeEdges = [wire(plan.id, "last")]
    expect(resolveNodeInputs(render, storeNodes as any, storeEdges as any).edl ?? null).toEqual(c.expected.scalar)
  })

  it("a fan-out iteration reads its own row's clip", () => {
    if (!c.expected.fanOut) return
    storeNodes = [plan, render]
    storeEdges = [wire(plan.id)]
    c.expected.fanOut.rowIndices.forEach((row, i) => {
      expect(resolveNodeInputs(render, storeNodes as any, storeEdges as any, row).edl).toBe(c.expected.fanOut!.items[i])
    })
  })

  it("the estimate counts the clips that will run", () => {
    // A clip set runs once per kept clip — none when none is kept; a Tighten
    // plan runs once.
    const runs = c.expected.fanOut ? c.expected.fanOut.items.length : Array.isArray(c.expected.list) ? c.expected.list.filter(Boolean).length : 1
    expect(PRODUCER_FAN_OUT["edit-plan"]!(c.plan.data, false)).toBe(runs)
  })
})

describe("the estimate reads the reviewed plan", () => {
  const byName = Object.fromEntries(cases) as Record<string, Case>

  it("prices the edited cut, not the planned one", () => {
    // Planned: 4 + 3 + 8 = 15 s; edited: 9 + 8 = 17 s — both one minute, so
    // price the plan through its held value instead.
    const plan = asNode(byName.tighten!.plan)
    const held = persistedEdlPlan(plan) as { segments: Array<{ inMs: number; outMs: number }> }
    expect(held.segments.map((s) => [s.inMs, s.outMs])).toEqual([[0, 9000], [12000, 20000]])
    expect(resolveApplyEdlEstimateMinutes(render, [plan, render], [wire(plan.id)], new Set())).toBe(1)
  })

  it("prices the kept clips only", () => {
    const plan = asNode(byName.twoKept!.plan)
    const held = persistedEdlPlan(plan) as Array<{ meta: { title: string } }>
    expect(held.map((clip) => clip.meta.title)).toEqual(["Why remote teams fail", "The pivot"])
  })

  it("a selector picks the plan's rows and counts the kept ones: clips 1, 2 and 4 with clip 2 dropped run twice", () => {
    const data = byName.twoKept!.plan.data
    expect(PRODUCER_FAN_OUT["edit-plan"]!(data, false, { selectorMode: "list", listExpression: "1,2,4" })).toBe(2)
    const plan = asNode(byName.twoKept!.plan)
    const edge = { ...wire(plan.id), data: { selectorMode: "list", listExpression: "1,2,4" } }
    expect(getListFanOutForNode(render, [plan, render], [edge])?.rowIndices).toEqual([0, 2])
  })

  it("the same plan object gives the same list back (store selectors stay stable)", () => {
    const plan = asNode(byName.oneKept!.plan)
    expect(extractNodeOutputAsList(plan, "edl")).toBe(extractNodeOutputAsList(plan, "edl"))
    expect(persistedEdlPlan(plan)).toBe(persistedEdlPlan(plan))
  })
})

interface Pick { name: string; edge: Record<string, unknown>; edl: string | null; runs: number | null }

describe.each((fixture.picks as { edges: Pick[] }).edges)("an edge that picks rows of a reviewed clip set, in the browser: $name", (pick) => {
  const plan = asNode((fixture.cases as unknown as Record<string, Case>)[fixture.picks.case]!.plan)
  const edge = { ...wire(plan.id), data: pick.edge }

  it("does not fan out", () => {
    expect(getListFanOutForNode(render, [plan, render], [edge]) ?? null).toBeNull()
  })

  it("hands the render the kept clip it selects, or nothing — never the plan's first kept clip", () => {
    storeNodes = [plan, render]
    storeEdges = [edge]
    expect(resolveNodeInputs(render, storeNodes as any, storeEdges as any).edl ?? null).toEqual(pick.edl)
  })

  it("the estimate counts what will render: nothing when the selection keeps no clip", () => {
    if (pick.runs === null) return
    expect(PRODUCER_FAN_OUT["edit-plan"]!(plan.data, false, pick.edge)).toBe(pick.runs)
    expect(getFanOutMultiplier(render, [plan, render], [edge], NO_RERUNS)).toBe(pick.runs)
  })
})

describe("the estimate of a render whose plan wire carries no clip", () => {
  it("is 0 whatever another wire lists, in either wire order", () => {
    const plan = asNode((fixture.cases as unknown as Record<string, Case>).twoKept!.plan)
    const planWire = { ...wire(plan.id), data: { selectorMode: "list", listExpression: "2,3" } }
    const list = asNode({ id: "takes", type: "list", data: { label: "Takes", items: "a\nb\nc\nd\ne" } })
    const listWire = { id: "e-list", source: list.id, target: render.id, targetHandle: "prompt" } as any
    const nodes = [plan, list, render]
    expect(getFanOutMultiplier(render, nodes, [planWire, listWire], NO_RERUNS)).toBe(0)
    expect(getFanOutMultiplier(render, nodes, [listWire, planWire], NO_RERUNS)).toBe(0)
  })
})
