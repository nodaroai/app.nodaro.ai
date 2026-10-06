import { beforeEach, describe, it, expect, vi } from "vitest"
import { EDITED_EDL_VERSION, editPlanBasis, resolveEditPlanOutput, validateEditedEdl } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { clipReviewOf, writeClipDecisions } from "../write-review"

/**
 * Writing a clip set's review (A4-1, decided 2026-10-06): one decision per
 * planned clip, `{keep, hook?}`, against the plan's basis. All kept with no
 * hook is no edit at all (R7 a).
 */
const clip = (i: number) => ({
  version: 1,
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [{ id: `c${i}`, inMs: i * 10_000, outMs: i * 10_000 + 5_000, video: "cam" }],
  dropped: [],
  meta: { title: `Clip ${i}`, hook: `Hook ${i}` },
})
const PLAN = [clip(0), clip(1), clip(2)]

function load(data: Record<string, unknown> = {}) {
  useWorkflowStore.setState({
    nodes: [{ id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { mode: "clips", generatedJson: PLAN, ...data } }] as never,
    edges: [],
    isReadOnly: false,
  })
}
const planData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>

beforeEach(() => load())

describe("clipReviewOf", () => {
  it("is the decisions, against the plan's basis, and they win on read", () => {
    const review = clipReviewOf(PLAN, [{ keep: true }, { keep: false }, { keep: true, hook: "New hook" }])!
    expect(review).toEqual({
      v: EDITED_EDL_VERSION,
      kind: "clips",
      basis: editPlanBasis(PLAN),
      clips: [{ keep: true }, { keep: false }, { keep: true, hook: "New hook" }],
    })
    expect(validateEditedEdl(review, PLAN).ok).toBe(true)
    const resolved = resolveEditPlanOutput(PLAN, review)
    expect(resolved.status).toBe("applied")
    expect(resolved.listResults![1]).toBe("")
    expect(JSON.parse(resolved.listResults![2]!).meta.hook).toBe("New hook")
  })

  it("is nothing when every clip is kept with no hook of its own (R7 a)", () => {
    expect(clipReviewOf(PLAN, [{ keep: true }, { keep: true }, { keep: true }])).toBeUndefined()
  })

  it("an explicit empty hook is an edit", () => {
    expect(clipReviewOf(PLAN, [{ keep: true, hook: "" }, { keep: true }, { keep: true }])?.clips[0]).toEqual({ keep: true, hook: "" })
  })

  it("never stores a key for an absent hook", () => {
    const review = clipReviewOf(PLAN, [{ keep: false, hook: undefined }, { keep: true }, { keep: true }])!
    expect(Object.keys(review.clips[0]!)).toEqual(["keep"])
  })

  it("is nothing for decisions that do not line up with the plan's clips", () => {
    expect(clipReviewOf(PLAN, [{ keep: false }])).toBeUndefined()
    expect(clipReviewOf(PLAN[0], [{ keep: false }])).toBeUndefined()
  })
})

describe("writeClipDecisions", () => {
  it("writes the review to the plan node", () => {
    expect(writeClipDecisions("plan", PLAN, [{ keep: false }, { keep: true }, { keep: true }])).toBe(true)
    expect(planData().editedEdl).toMatchObject({ kind: "clips", clips: [{ keep: false }, { keep: true }, { keep: true }] })
  })

  it("clears the review when every clip is back to the plan's (R7 a)", () => {
    writeClipDecisions("plan", PLAN, [{ keep: false }, { keep: true }, { keep: true }])
    expect(writeClipDecisions("plan", PLAN, [{ keep: true }, { keep: true }, { keep: true }])).toBe(true)
    expect(planData().editedEdl).toBeUndefined()
  })

  it("writes nothing once a re-plan replaced the plan it was made on", () => {
    load({ generatedJson: [clip(0), clip(1), clip(2)] })
    expect(writeClipDecisions("plan", PLAN, [{ keep: false }, { keep: true }, { keep: true }])).toBe(false)
    expect(planData().editedEdl).toBeUndefined()
  })

  it("writes nothing for decisions that do not line up with the plan", () => {
    expect(writeClipDecisions("plan", PLAN, [{ keep: false }])).toBe(false)
    expect(planData().editedEdl).toBeUndefined()
  })
})
