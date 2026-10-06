/**
 * An Apply EDL render's two bases on the server (A3-1).
 *
 *   - `planBasis`: the plan value the iteration read (`renderReadBasis`), taken
 *     as the run holds the plan. Behind Camera Switch it is stamped only when
 *     the switch ran in the same run as the render (the same-run rule): a
 *     SAVED switch output can come from an older plan, and the take must then
 *     read as unknown, never as current.
 *   - `renderBasis`: the render's own settings and the effective sources of the
 *     cut it renders, stamped on every render.
 * Both reach the node output, a fan-out's row stamps and a saved render's output.
 */
import { describe, it, expect } from "vitest"
import { editPlanBasis, planFanOut, renderReadBasis, renderSettingsBasis, type Edl } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import { buildNodeOutputFromJobData, extractSavedNodeOutput } from "../output-extractor.js"
import { getListFanOutForNode } from "../input-resolver.js"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"
import { seededFromSavedData } from "../saved-data.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const clip = (inMs: number, outMs: number, hook?: string): Edl & { meta?: Record<string, unknown> } => ({
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://media.test/a.mp4", kind: "video" }],
  segments: [
    { id: "seg-0", inMs, outMs: inMs + 1000, video: "A" },
    { id: "seg-1", inMs: outMs - 1000, outMs, video: "A" },
  ],
  ...(hook ? { meta: { hook } } : {}),
})

const TIGHTEN = clip(0, 60_000)
const CLIPS = [clip(0, 10_000, "a"), clip(20_000, 30_000, "b"), clip(40_000, 50_000, "c")]
// The person's review of the Tighten plan: the first second is cut.
const EDIT = {
  v: 1,
  kind: "edl",
  basis: editPlanBasis(TIGHTEN),
  edl: { segments: [{ id: "seg-1", inMs: 59_000, outMs: 60_000, video: "A" }], dropped: [] },
}
const RESOLVED = { ...TIGHTEN, segments: EDIT.edl.segments, dropped: [] }

const tightenPlan: SimpleNode = { id: "plan", type: "edit-plan", data: { mode: "tighten", generatedJson: TIGHTEN, editedEdl: EDIT } }
const clipsPlan: SimpleNode = { id: "plan", type: "edit-plan", data: { mode: "clips", generatedJson: CLIPS } }
const sw: SimpleNode = { id: "switch", type: "camera-switch", data: {} }
const render: SimpleNode = { id: "render", type: "apply-edl", data: { output: "video", quality: "proxy", crossfadeMs: 0 } }

const direct: SimpleEdge[] = [{ id: "e1", source: "plan", sourceHandle: "edl", target: "render", targetHandle: "edl" }]
const viaSwitch: SimpleEdge[] = [
  { id: "e1", source: "plan", sourceHandle: "edl", target: "switch", targetHandle: "edl" },
  { id: "e2", source: "switch", sourceHandle: "edl", target: "render", targetHandle: "edl" },
]

/** A state this run produced (the node ran in it). */
const ran = (output: NodeExecutionState["output"]): NodeExecutionState => ({ status: "completed", output })

function payloadOf(plan: SimpleNode, edges: SimpleEdge[], nodeStates: Record<string, NodeExecutionState>, edl: unknown, listRow?: number) {
  const nodes = edges.some((e) => e.source === "switch") ? [plan, sw, render] : [plan, render]
  return buildPayload(render, "job-1", { edl: JSON.stringify(edl) }, "ul", { nodes, edges, nodeStates, listRow }).payload
}

describe("planBasis — the plan value the render read (R1 a, R2 a)", () => {
  it("a render wired straight to a Tighten plan the run did not re-run: the plan as the review leaves it", () => {
    const nodeStates = { plan: seededFromSavedData(extractSavedNodeOutput(tightenPlan)) }
    const payload = payloadOf(tightenPlan, direct, nodeStates, RESOLVED)
    expect(payload.planBasis).toBe(renderReadBasis(RESOLVED))
    expect(payload.planBasis).not.toBe(renderReadBasis(TIGHTEN))
  })

  it("a Tighten plan that ran in this run: the plan it produced", () => {
    const nodeStates = { plan: ran({ json: TIGHTEN }) }
    expect(payloadOf(tightenPlan, direct, nodeStates, TIGHTEN).planBasis).toBe(renderReadBasis(TIGHTEN))
  })

  it("a clip set: the row's clip, its hook left out", () => {
    const nodeStates = { plan: seededFromSavedData(extractSavedNodeOutput(clipsPlan)) }
    const payload = payloadOf(clipsPlan, direct, nodeStates, CLIPS[1], 1)
    expect(payload.planBasis).toBe(renderReadBasis(CLIPS[1]))
    expect(payload.planBasis).toBe(renderReadBasis({ ...CLIPS[1], meta: { hook: "edited" } }))
  })

  it("behind Camera Switch that ran with the render: the plan value the switch read", () => {
    const nodeStates = {
      plan: seededFromSavedData(extractSavedNodeOutput(tightenPlan)),
      switch: ran({ json: { edl: RESOLVED } }),
    }
    expect(payloadOf(tightenPlan, viaSwitch, nodeStates, RESOLVED).planBasis).toBe(renderReadBasis(RESOLVED))
  })

  // §7's same-run guards. The stop-rule flag off, the plan edited, then the
  // render's ▶ or a Run from here at the render: the switch is not in the run
  // and still holds its pre-edit EDL, so the take must not claim the plan.
  it("behind a SAVED Camera Switch output (the switch did not run with the render): no plan basis", () => {
    const nodeStates = {
      plan: seededFromSavedData(extractSavedNodeOutput(tightenPlan)),
      switch: seededFromSavedData({ json: { edl: TIGHTEN } }),
    }
    expect(payloadOf(tightenPlan, viaSwitch, nodeStates, TIGHTEN).planBasis).toBeUndefined()
  })

  it("the Edit Plan re-ran alone before the render (the switch kept its old output): no plan basis", () => {
    const nodeStates = {
      plan: ran({ json: TIGHTEN }),
      switch: seededFromSavedData({ json: { edl: clip(0, 30_000) } }),
    }
    expect(payloadOf(tightenPlan, viaSwitch, nodeStates, clip(0, 30_000)).planBasis).toBeUndefined()
  })

  it("an inline EDL, or no graph: no plan basis", () => {
    expect(buildPayload(render, "job-1", { edl: JSON.stringify(TIGHTEN) }, "ul").payload.planBasis).toBeUndefined()
  })
})

describe("renderBasis — the render's own settings and effective sources (R19 a)", () => {
  it("is stamped on every render, from the settings and the sources the cut reads", () => {
    const withOverride: SimpleNode = { ...render, data: { output: "audio", quality: "final", crossfadeMs: 150 } }
    const { payload } = buildPayload(withOverride, "job-1", { edl: JSON.stringify(TIGHTEN), sources: ["https://media.test/b.mp4"] }, "ul")
    expect(payload.renderBasis).toBe(renderSettingsBasis({ output: "audio", crossfadeMs: 150 }, ["https://media.test/b.mp4"]))
  })

  it("with no override, names the EDL's own sources", () => {
    const { payload } = buildPayload(render, "job-1", { edl: JSON.stringify(TIGHTEN) }, "ul")
    expect(payload.renderBasis).toBe(renderSettingsBasis({ output: "video", crossfadeMs: 0 }, ["https://media.test/a.mp4"]))
  })
})

describe("the bases reach every server lane that carries a take", () => {
  const PB = "0123456789abcdef"
  const RB = "fedcba9876543210"

  it("a finished job's output", () => {
    const out = buildNodeOutputFromJobData({ videoUrl: "v.mp4", quality: "proxy", planBasis: PB, renderBasis: RB }, "apply-edl")
    expect(out).toMatchObject({ planBasis: PB, renderBasis: RB })
  })

  it("a saved render's output (Run from here, Skip)", () => {
    const saved: SimpleNode = {
      id: "render",
      type: "apply-edl",
      data: { output: "video", generatedResults: [{ url: "v.mp4", jobId: "j", timestamp: "t", quality: "final", planBasis: PB, renderBasis: RB }] },
    }
    expect(extractSavedNodeOutput(saved)).toMatchObject({ videoUrl: "v.mp4", planBasis: PB, renderBasis: RB })
  })

  it("a fan-out's row stamps", () => {
    const settled: PromiseSettledResult<FanOutIterationValue>[] = [
      { status: "fulfilled", value: { index: 0, resultValue: "a.mp4", result: { jobId: "job-a", output: { videoUrl: "a.mp4", quality: "proxy", planBasis: PB, renderBasis: RB } } } },
    ]
    expect(assembleFanOutResult(settled, 1).output.listResultStamps).toEqual([
      { jobId: "job-a", quality: "proxy", planBasis: PB, renderBasis: RB },
    ])
  })
})

// Why a render's batch needs no "dropped" marker: a clip the review drops is
// never an iteration. Its row is "" in the plan's list, and the fan-out runs
// only the rows that hold a value, so the batch has a row per kept clip and a
// hole only where a sent clip failed. (A row is matched to its clip by clipKey.)
describe("a dropped clip is never a render iteration", () => {
  it("a review that drops one of three clips fans the render out over the two it keeps", () => {
    const reviewed: SimpleNode = {
      ...clipsPlan,
      data: { ...clipsPlan.data, editedEdl: { v: 1, kind: "clips", basis: editPlanBasis(CLIPS), clips: [{ keep: true }, { keep: false }, { keep: true }] } },
    }
    const nodeStates = { plan: seededFromSavedData(extractSavedNodeOutput(reviewed)) }
    const plan = planFanOut(getListFanOutForNode(render, direct, nodeStates, [reviewed, render]), "apply-edl", render.data as Record<string, unknown>)
    expect(plan?.items).toHaveLength(2)
    expect(plan?.rows).toEqual([0, 2])
  })
})
