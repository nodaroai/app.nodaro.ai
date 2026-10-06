/**
 * A run CONTINUED from an earlier execution (A6.2; TA11, decided 2026-10-04):
 * the nodes it does not run are seeded from that execution's `node_states`,
 * never from the workflow's saved results, and an Edit Plan's seed is its plan
 * with the person's review (`editedEdl`) applied by the one resolver.
 */
import { describe, expect, it, vi } from "vitest"

// PREVIEW_STOP_RULE_ENABLED (decided 2026-10-05): on for these tests.
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
  editPlanBasis,
} from "@nodaro/shared"
import {
  continuationInputOverrides,
  continuationRefusal,
  continuationRenderStamps,
  continuationSeeds,
  type ContinuationSource,
} from "../run-continuation.js"
import { savedDataAllowed, seededFromSavedData } from "../saved-data.js"
import { extractSavedNodeOutput, extractSourceNodeOutput } from "../output-extractor.js"
import { getListInputForNode } from "../input-resolver.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"
import { runPreviewStops } from "../../../lib/preview-review-gate.js"

const OWNER = "user-1"
const at = "2026-10-05T10:00:00.000Z"

function source(overrides: Partial<ContinuationSource> = {}): ContinuationSource {
  return {
    id: "exec-0",
    userId: OWNER,
    workflowId: "wf-1",
    status: "completed",
    appVersionId: null,
    nodeStates: {},
    ...overrides,
  }
}

const run = { userId: OWNER, workflowId: "wf-1", nodeIds: ["cut"] as string[] | undefined, appVersionId: undefined as string | undefined }

describe("continuationRefusal: ownership, workflow, version, status, subset", () => {
  it("accepts the caller's own completed run of the same live workflow", () => {
    expect(continuationRefusal(source(), run)).toBeNull()
  })

  it("asks for a subset first: a continuation names the nodes it runs", () => {
    expect(continuationRefusal(source(), { ...run, nodeIds: undefined })).toBe(CONTINUATION_SUBSET_REQUIRED)
    expect(continuationRefusal(source(), { ...run, nodeIds: [] })).toBe(CONTINUATION_SUBSET_REQUIRED)
  })

  it("an execution that does not exist, or that someone else started, reads as not found", () => {
    expect(continuationRefusal(null, run)).toBe(CONTINUATION_NOT_FOUND)
    expect(continuationRefusal(source({ userId: "someone-else" }), run)).toBe(CONTINUATION_NOT_FOUND)
  })

  it("an execution of another workflow is refused", () => {
    expect(continuationRefusal(source({ workflowId: "wf-2" }), run)).toBe(CONTINUATION_WORKFLOW_MISMATCH)
  })

  it("the graph's version must match: the same published app version, or the live workflow on both sides", () => {
    expect(continuationRefusal(source({ appVersionId: "app-1" }), run)).toBe(CONTINUATION_VERSION_MISMATCH)
    expect(continuationRefusal(source(), { ...run, appVersionId: "app-1" })).toBe(CONTINUATION_VERSION_MISMATCH)
    expect(continuationRefusal(source({ appVersionId: "app-1" }), { ...run, appVersionId: "app-2" })).toBe(
      CONTINUATION_VERSION_MISMATCH,
    )
    expect(continuationRefusal(source({ appVersionId: "app-1" }), { ...run, appVersionId: "app-1" })).toBeNull()
  })

  it.each(["pending", "running", "stopping", "failed", "cancelled", "timed_out", "discarded"])(
    "an execution that is %s is refused",
    (status) => {
      expect(continuationRefusal(source({ status }), run)).toBe(CONTINUATION_NOT_COMPLETED)
    },
  )
})

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

const tightenPlan = {
  version: 1,
  sources: [{ id: "s0", url: "https://r2/master.mp4", role: "master" }],
  segments: [
    { id: "seg-0", sourceId: "s0", inMs: 0, outMs: 4000 },
    { id: "seg-1", sourceId: "s0", inMs: 6000, outMs: 9000 },
  ],
  dropped: [{ sourceId: "s0", inMs: 4000, outMs: 6000, reason: "silence" }],
}
const editedSegments = [{ id: "seg-0", sourceId: "s0", inMs: 0, outMs: 9000 }]
const tightenEdit = { v: 1, kind: "edl", basis: editPlanBasis(tightenPlan), edl: { segments: editedSegments, dropped: [] } }

const clipA = { ...tightenPlan, segments: [tightenPlan.segments[0]], dropped: [] }
const clipB = { ...tightenPlan, segments: [tightenPlan.segments[1]], dropped: [] }
const clipPlan = [clipA, clipB]
const clipEdit = { v: 1, kind: "clips", basis: editPlanBasis(clipPlan), clips: [{ keep: false }, { keep: true }] }

function graph(planData: Record<string, unknown>): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  return {
    nodes: [
      { id: "rec", type: "upload-video", data: { videoUrl: "https://r2/canvas-recording.mp4" } },
      { id: "mood", type: "mood", data: { mood: "calm" } },
      { id: "plan", type: "edit-plan", data: planData },
      { id: "cut", type: "apply-edl", data: { quality: "proxy" } },
      { id: "cap", type: "add-captions", data: {} },
    ],
    edges: [
      { id: "e0", source: "rec", target: "plan" },
      { id: "e1", source: "plan", target: "cut", sourceHandle: "edl", targetHandle: "edl" },
      { id: "e2", source: "cut", target: "cap" },
    ],
  }
}

/** What a run that stopped at its preview left in node_states. */
function stoppedRun(planJson: unknown): Record<string, NodeExecutionState> {
  return {
    rec: { status: "completed", output: { videoUrl: "https://r2/app-input.mp4" }, completedAt: at, fromSavedData: true },
    plan: {
      status: "completed",
      nodeType: "edit-plan",
      jobId: "job-plan",
      startedAt: at,
      completedAt: at,
      output: { json: planJson, ...(Array.isArray(planJson) ? { listResults: planJson.map((c) => JSON.stringify(c)) } : {}) },
    },
    cut: {
      status: "completed",
      nodeType: "apply-edl",
      jobId: "job-cut",
      startedAt: at,
      completedAt: at,
      output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" },
    },
    cap: { status: "skipped", nodeType: "add-captions", completedAt: at },
  }
}

describe("continuationSeeds: every node the run does not execute hands on the earlier run's output", () => {
  it("seeds from node_states, never from the saved data, and the seed is not saved data", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))

    // The source node hands on the earlier run's input (an app's input
    // override, say), not the canvas file.
    const rec = seeds.get("rec")!
    expect(rec.status).toBe("completed")
    expect(rec.output).toEqual({ videoUrl: "https://r2/app-input.mp4" })
    expect(rec.seededFromExecution).toBe("exec-0")

    for (const seed of seeds.values()) {
      // Never saved data (no fallback to node.data), never a node this run ran.
      expect(seed.fromSavedData).toBeUndefined()
      expect(savedDataAllowed(seed)).toBe(false)
      expect(seed.jobId).toBeUndefined()
      expect(seed.jobIds).toBeUndefined()
      expect(seed.startedAt).toBeUndefined()
    }
  })

  it("never seeds a node the run executes", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))
    expect(seeds.has("cut")).toBe(false)
    expect(seeds.has("cap")).toBe(false)
  })

  it("a node the earlier run did not complete hands on nothing: it is seeded skipped", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut"]))
    expect(seeds.get("cap")).toMatchObject({ status: "skipped", seededFromExecution: "exec-0" })
    expect(seeds.get("cap")!.output).toBeUndefined()
  })

  it("a source or parameter node the earlier run holds no state for is left to the ordinary seeding", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))
    expect(seeds.has("mood")).toBe(false)
  })

  it("a Group or Collect container (no run gives it a state) keeps the ordinary handling", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const withGroup = [...nodes, { id: "grp", type: "group", data: {} }, { id: "col", type: "collect", data: {} }]
    const seeds = continuationSeeds(withGroup, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))
    expect(seeds.has("grp")).toBe(false)
    expect(seeds.has("col")).toBe(false)
  })

  it("a node the graph gained since the earlier run is seeded skipped, never run", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const withNew = [...nodes, { id: "new", type: "llm-chat", data: { prompt: "x" } }]
    const seeds = continuationSeeds(withNew, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))
    expect(seeds.get("new")).toMatchObject({ status: "skipped" })
  })

  it("a Tighten plan's seed applies the person's edit (editedEdl) through the shared resolver", () => {
    const { nodes } = graph({ generatedJson: tightenPlan, editedEdl: tightenEdit })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))
    const plan = seeds.get("plan")!
    expect((plan.output!.json as { segments: unknown }).segments).toEqual(editedSegments)
    expect((plan.output!.json as { dropped: unknown }).dropped).toEqual([])
    expect(plan.output!.listResults).toBeUndefined()
  })

  it("a clip set's seed keeps the plan's rows, '' at every dropped clip (TA16)", () => {
    const { nodes } = graph({ generatedJson: clipPlan, editedEdl: clipEdit })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(clipPlan) }), new Set(["cut", "cap"]))
    const plan = seeds.get("plan")!
    expect(plan.output!.listResults).toEqual(["", JSON.stringify(clipB)])
    expect(plan.output!.json).toEqual([clipB])
  })

  it("the edit is judged against the plan the EARLIER RUN made: an edit of another plan is ignored", () => {
    const otherPlan = { ...tightenPlan, segments: [tightenPlan.segments[0]] }
    const { nodes } = graph({ generatedJson: tightenPlan, editedEdl: tightenEdit })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(otherPlan) }), new Set(["cut", "cap"]))
    expect(seeds.get("plan")!.output!.json).toEqual(otherPlan)
  })

  it("a state recorded before seeds carried the planned plan holds the plan as it resolved it then", () => {
    // Pinned residual: an execution persisted before `plannedJson` existed, in
    // which a Run from here passed the plan through with an earlier edit
    // already applied, holds only the EDITED cut. The edit on the node is made
    // on the planner's plan, so against that state it reads as stale, and the
    // seed is the cut as that run resolved it. Nothing in the state can tell.
    const passedThrough = { ...tightenPlan, segments: editedSegments, dropped: [] }
    const { nodes } = graph({ generatedJson: tightenPlan, editedEdl: tightenEdit })
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(passedThrough) }), new Set(["cut", "cap"]))
    expect(seeds.get("plan")!.output!.json).toEqual(passedThrough)
  })
})

// ---------------------------------------------------------------------------
// An Edit Plan's review is judged against the plan AS PLANNED, through any seed
// ---------------------------------------------------------------------------

const clip = (i: number) => ({ ...tightenPlan, segments: [{ id: `seg-${i}`, sourceId: "s0", inMs: i * 1000, outMs: i * 1000 + 500 }], dropped: [] })
const fourClips = [clip(0), clip(1), clip(2), clip(3)]
const rowsOf = (keep: readonly boolean[]) => keep.map((k, i) => (k ? JSON.stringify(fourClips[i]) : ""))
const clipsReview = (keep: readonly boolean[]) => ({ v: 1, kind: "clips", basis: editPlanBasis(fourClips), clips: keep.map((k) => ({ keep: k })) })
const cutReview = (segments: unknown[]) => ({ v: 1, kind: "edl", basis: editPlanBasis(tightenPlan), edl: { segments, dropped: [] } })
const secondSegments = [{ id: "seg-1", sourceId: "s0", inMs: 6000, outMs: 9000 }]

/** The states an execution left, with the plan's state replaced. */
function withPlanState(planned: unknown, planState: NodeExecutionState): Record<string, NodeExecutionState> {
  return { ...stoppedRun(planned), plan: planState }
}

describe("a seed of a seed: the review applies to the plan the first execution planned", () => {
  it("a continuation of a continuation applies the review made since (Tighten)", () => {
    const first = continuationSeeds(
      graph({ generatedJson: tightenPlan, editedEdl: cutReview(editedSegments) }).nodes,
      source({ nodeStates: stoppedRun(tightenPlan) }),
      new Set(["cut", "cap"]),
    )
    // The person edits the cut again, then renders final from the continuation.
    const second = continuationSeeds(
      graph({ generatedJson: tightenPlan, editedEdl: cutReview(secondSegments) }).nodes,
      source({ id: "exec-1", nodeStates: withPlanState(tightenPlan, first.get("plan")!) }),
      new Set(["cut", "cap"]),
    )
    const plan = second.get("plan")!
    expect((plan.output!.json as { segments: unknown }).segments).toEqual(secondSegments)
    expect(plan.output!.plannedJson).toEqual(tightenPlan)
    expect(plan.seededFromExecution).toBe("exec-1")
  })

  it("a continuation of a continuation applies the review made since (clip set: the plan's rows, '' at every dropped clip)", () => {
    const first = continuationSeeds(
      graph({ generatedJson: fourClips, editedEdl: clipsReview([true, false, true, true]) }).nodes,
      source({ nodeStates: stoppedRun(fourClips) }),
      new Set(["cut", "cap"]),
    )
    expect(first.get("plan")!.output!.listResults).toEqual(rowsOf([true, false, true, true]))
    // Clip 1 restored, clip 0 dropped.
    const keep = [false, true, true, true]
    const second = continuationSeeds(
      graph({ generatedJson: fourClips, editedEdl: clipsReview(keep) }).nodes,
      source({ id: "exec-1", nodeStates: withPlanState(fourClips, first.get("plan")!) }),
      new Set(["cut", "cap"]),
    )
    const plan = second.get("plan")!
    expect(plan.output!.json).toEqual([fourClips[1], fourClips[2], fourClips[3]])
    expect(plan.output!.listResults).toEqual(rowsOf(keep))
    // Every clip restored: all four, no holes.
    const third = continuationSeeds(
      graph({ generatedJson: fourClips, editedEdl: clipsReview([true, true, true, true]) }).nodes,
      source({ id: "exec-2", nodeStates: withPlanState(fourClips, plan) }),
      new Set(["cut", "cap"]),
    )
    expect(third.get("plan")!.output!.json).toEqual(fourClips)
    expect(third.get("plan")!.output!.listResults).toEqual(rowsOf([true, true, true, true]))
  })

  /** A partial run's state of an Edit Plan outside its subset: its saved output, as the orchestrator seeds it. */
  function partialRunState(data: Record<string, unknown>): NodeExecutionState {
    return seededFromSavedData(extractSavedNodeOutput({ id: "plan", type: "edit-plan", data }))
  }

  it("a continuation of a partial run (the plan outside its subset) applies the review made since (Tighten)", () => {
    const e1 = partialRunState({ generatedJson: tightenPlan, editedEdl: cutReview(editedSegments) })
    expect((e1.output!.json as { segments: unknown }).segments).toEqual(editedSegments)
    const seeds = continuationSeeds(
      graph({ generatedJson: tightenPlan, editedEdl: cutReview(secondSegments) }).nodes,
      source({ nodeStates: withPlanState(tightenPlan, e1) }),
      new Set(["cut", "cap"]),
    )
    expect((seeds.get("plan")!.output!.json as { segments: unknown }).segments).toEqual(secondSegments)
  })

  it("a continuation of a partial run (the plan outside its subset) applies the review made since (clip set)", () => {
    const e1 = partialRunState({ generatedJson: fourClips, editedEdl: clipsReview([true, false, true, true]) })
    expect(e1.output!.listResults).toEqual(rowsOf([true, false, true, true]))
    const keep = [true, true, false, true]
    const seeds = continuationSeeds(
      graph({ generatedJson: fourClips, editedEdl: clipsReview(keep) }).nodes,
      source({ nodeStates: withPlanState(fourClips, e1) }),
      new Set(["cut", "cap"]),
    )
    expect(seeds.get("plan")!.output!.json).toEqual([fourClips[0], fourClips[1], fourClips[3]])
    expect(seeds.get("plan")!.output!.listResults).toEqual(rowsOf(keep))
  })

  it("a plan the earlier run made, with no review applied, carries no second copy of itself", () => {
    const seeds = continuationSeeds(
      graph({ generatedJson: tightenPlan }).nodes,
      source({ nodeStates: stoppedRun(tightenPlan) }),
      new Set(["cut", "cap"]),
    )
    expect(seeds.get("plan")!.output).toEqual({ json: tightenPlan })
    const saved = extractSavedNodeOutput({ id: "plan", type: "edit-plan", data: { generatedJson: tightenPlan } })
    expect(saved).toEqual({ json: tightenPlan })
  })
})

// ---------------------------------------------------------------------------
// What the earlier execution read from saved data, the continuation reads too
// ---------------------------------------------------------------------------

describe("a seed keeps the saved-data provenance of a node the earlier execution did not run", () => {
  const fourImages = ["a", "b", "c", "d"].map((x) => ({ url: `https://r2/${x}.png` }))
  const imageGraph = (): { nodes: SimpleNode[]; edges: SimpleEdge[] } => ({
    nodes: [
      { id: "img", type: "generate-image", data: { generatedImageUrl: fourImages[0].url, generatedResults: fourImages } },
      { id: "up", type: "upscale-image", data: {} },
    ],
    edges: [{ id: "e0", source: "img", target: "up", data: { outputMode: "each" } }],
  })

  it("a node outside the earlier partial run's subset hands on its whole saved list again", () => {
    const { nodes, edges } = imageGraph()
    const img = nodes[0]
    // E1 ran `up` alone: `img` was seeded from saved data, and `up` read all four.
    const e1: Record<string, NodeExecutionState> = { img: seededFromSavedData(extractSavedNodeOutput(img)) }
    expect(getListInputForNode(nodes[1], edges, e1, nodes)).toHaveLength(4)
    const seeds = continuationSeeds(nodes, source({ nodeStates: e1 }), new Set(["up"]))
    expect(seeds.get("img")).toMatchObject({ fromSavedData: true, seededFromExecution: "exec-0" })
    expect(getListInputForNode(nodes[1], edges, Object.fromEntries(seeds), nodes)).toEqual(fourImages.map((r) => r.url))
  })

  it("a node the earlier execution RAN is never saved data", () => {
    const { nodes, edges } = imageGraph()
    const e1: Record<string, NodeExecutionState> = {
      img: { status: "completed", nodeType: "generate-image", jobId: "job-img", startedAt: at, completedAt: at, output: { imageUrl: "https://r2/new.png" } },
    }
    const seeds = continuationSeeds(nodes, source({ nodeStates: e1 }), new Set(["up"]))
    expect(seeds.get("img")!.fromSavedData).toBeUndefined()
    expect(getListInputForNode(nodes[1], edges, Object.fromEntries(seeds), nodes)).toBeUndefined()
  })

  it("a source or parameter node, and an Edit Plan, hand on the seed alone (their data may not be what that run read)", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const prior = stoppedRun(tightenPlan)
    prior.mood = seededFromSavedData({ text: "calm" })
    prior.plan = seededFromSavedData({ json: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ nodeStates: prior }), new Set(["cut", "cap"]))
    for (const id of ["rec", "mood", "plan"]) {
      expect(seeds.get(id)!.fromSavedData, id).toBeUndefined()
      expect(savedDataAllowed(seeds.get(id)), id).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Round 2 (decided 2026-10-06): the input overrides the earlier run used
// ---------------------------------------------------------------------------

describe("continuationInputOverrides: the earlier run's stored overrides, then the continuation's own", () => {
  it("an app run's stored overrides (app_runs.input_values) are the run's overrides", () => {
    const stored = { rec: { videoUrl: "https://r2/app-input.mp4" }, cap: { fontSize: 48 } }
    expect(continuationInputOverrides(source({ appVersionId: "app-1", inputOverrides: stored }), undefined)).toEqual(stored)
  })

  it("an explicit override beats a stored one, field by field; the stored fields it does not name stay", () => {
    const stored = { cut: { quality: "proxy", output: "video" }, cap: { fontSize: 48 } }
    const explicit = { cut: { quality: "final" } }
    expect(continuationInputOverrides(source({ appVersionId: "app-1", inputOverrides: stored }), explicit)).toEqual({
      cut: { quality: "final", output: "video" },
      cap: { fontSize: 48 },
    })
    // Neither map is mutated.
    expect(stored.cut.quality).toBe("proxy")
  })

  it("a run of the live workflow stores none: only the explicit overrides apply", () => {
    expect(continuationInputOverrides(source(), { cut: { quality: "final" } })).toEqual({ cut: { quality: "final" } })
    expect(continuationInputOverrides(source(), undefined)).toBeUndefined()
  })
})

describe("a seed of a source, parameter or Edit Plan node keeps saved-data provenance when the stored overrides cover it", () => {
  const fourImages = ["a", "b", "c", "d"].map((x) => ({ url: `https://r2/${x}.png` }))
  /** A creator's snapshot: an upload holding four images, fanned out to an upscale. */
  const uploadGraph = (): { nodes: SimpleNode[]; edges: SimpleEdge[] } => ({
    nodes: [
      { id: "img", type: "upload-image", data: { generatedImageUrl: fourImages[0].url, generatedResults: fourImages } },
      { id: "up", type: "upscale-image", data: {} },
    ],
    edges: [{ id: "e0", source: "img", target: "up", data: { outputMode: "each" } }],
  })
  /** E1's state of a source node: what every run builds for one (saved data). */
  const e1Of = (nodes: SimpleNode[]): Record<string, NodeExecutionState> => ({
    img: seededFromSavedData(extractSourceNodeOutput(nodes[0])),
  })

  it("an app continuation (an immutable snapshot, its stored overrides re-applied): the source reads what the earlier run read", () => {
    const { nodes, edges } = uploadGraph()
    // E1 fanned out over every image the upload holds.
    expect(getListInputForNode(nodes[1], edges, e1Of(nodes), nodes)).toHaveLength(4)
    const seeds = continuationSeeds(nodes, source({ appVersionId: "app-1", nodeStates: e1Of(nodes) }), new Set(["up"]))
    expect(seeds.get("img")).toMatchObject({ fromSavedData: true, seededFromExecution: "exec-0" })
    expect(getListInputForNode(nodes[1], edges, Object.fromEntries(seeds), nodes)).toEqual(fourImages.map((r) => r.url))
  })

  it("a parameter node and an Edit Plan the earlier app run seeded from saved data keep it too", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const prior = stoppedRun(tightenPlan)
    prior.mood = seededFromSavedData({ text: "calm" })
    prior.plan = seededFromSavedData({ json: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ appVersionId: "app-1", nodeStates: prior }), new Set(["cut", "cap"]))
    for (const id of ["rec", "mood", "plan"]) {
      expect(seeds.get(id)!.fromSavedData, id).toBe(true)
    }
  })

  it("a node the continuation's own explicit override names reads data the earlier run never read: the seed alone", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const prior = stoppedRun(tightenPlan)
    prior.mood = seededFromSavedData({ text: "calm" })
    prior.plan = seededFromSavedData({ json: tightenPlan })
    const explicit = { rec: { videoUrl: "https://r2/other.mp4" }, mood: { mood: "tense" }, plan: { editedEdl: tightenEdit } }
    const seeds = continuationSeeds(
      nodes,
      source({ appVersionId: "app-1", nodeStates: prior }),
      new Set(["cut", "cap"]),
      explicit,
    )
    for (const id of ["rec", "mood", "plan"]) {
      expect(seeds.get(id)!.fromSavedData, id).toBeUndefined()
    }
  })

  // The app runner sends its FULL input map on every run (createBridgedRun):
  // a node it names with the values the earlier run already applied reads the
  // same data, so naming it changes nothing (R2-3).
  it("an explicit override that only repeats the stored one changes nothing: the seed keeps saved-data provenance", () => {
    const { nodes, edges } = uploadGraph()
    const stored = { img: { imageUrls: fourImages.map((r) => r.url), label: "four" } }
    // Equal by value, not by reference: the request body is a fresh object.
    const explicit = { img: { label: "four", imageUrls: fourImages.map((r) => r.url) } }
    const seeds = continuationSeeds(
      nodes,
      source({ appVersionId: "app-1", nodeStates: e1Of(nodes), inputOverrides: stored }),
      new Set(["up"]),
      explicit,
    )
    expect(seeds.get("img")!.fromSavedData).toBe(true)
    expect(getListInputForNode(nodes[1], edges, Object.fromEntries(seeds), nodes)).toEqual(fourImages.map((r) => r.url))
  })

  it("an explicit override that changes one stored field, or names a field the stored ones do not hold, drops the provenance", () => {
    const { nodes } = uploadGraph()
    const stored = { img: { imageUrls: fourImages.map((r) => r.url), label: "four" } }
    const changed = { img: { imageUrls: fourImages.map((r) => r.url), label: "three" } }
    const added = { img: { imageUrls: fourImages.map((r) => r.url), caption: "new" } }
    for (const explicit of [changed, added]) {
      const seeds = continuationSeeds(
        nodes,
        source({ appVersionId: "app-1", nodeStates: e1Of(nodes), inputOverrides: stored }),
        new Set(["up"]),
        explicit,
      )
      expect(seeds.get("img")!.fromSavedData).toBeUndefined()
    }
  })

  it("a live continuation stores no overrides to cover them: the seed alone (round 1's narrowing stays)", () => {
    const { nodes, edges } = uploadGraph()
    const seeds = continuationSeeds(nodes, source({ nodeStates: e1Of(nodes) }), new Set(["up"]))
    expect(seeds.get("img")!.fromSavedData).toBeUndefined()
    expect(getListInputForNode(nodes[1], edges, Object.fromEntries(seeds), nodes)).toBeUndefined()
  })

  it("a node the earlier app run RAN is still never saved data", () => {
    const { nodes } = graph({ generatedJson: tightenPlan })
    const seeds = continuationSeeds(nodes, source({ appVersionId: "app-1", nodeStates: stoppedRun(tightenPlan) }), new Set(["cut", "cap"]))
    expect(seeds.get("plan")!.fromSavedData).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The stop rule over seeds
// ---------------------------------------------------------------------------

describe("continuationRenderStamps: the stop rule reads a seeded render's stamps", () => {
  it("a render the continuation does not run, seeded with a Preview, gates what would consume it", () => {
    const { nodes, edges } = graph({ generatedJson: tightenPlan })
    const subset = new Set(["cap"])
    const seeds = continuationSeeds(nodes, source({ nodeStates: stoppedRun(tightenPlan) }), subset)
    const stops = runPreviewStops(nodes, edges, { nodeSubset: subset, savedRenders: continuationRenderStamps(nodes, seeds) })
    expect(stops.savedPreviewRenderIds).toEqual(["cut"])
    expect([...stops.gatedNodeIds]).toEqual(["cap"])
  })

  it("a seeded final hands on freely", () => {
    const { nodes, edges } = graph({ generatedJson: tightenPlan })
    const states = stoppedRun(tightenPlan)
    states.cut = { ...states.cut, output: { videoUrl: "https://r2/final.mp4", quality: "final" } }
    const subset = new Set(["cap"])
    const seeds = continuationSeeds(nodes, source({ nodeStates: states }), subset)
    const stops = runPreviewStops(nodes, edges, { nodeSubset: subset, savedRenders: continuationRenderStamps(nodes, seeds) })
    expect(stops.savedPreviewRenderIds).toEqual([])
    expect(stops.gatedNodeIds.size).toBe(0)
  })

  it("an each wire reads the seeded batch's row stamps", () => {
    const { nodes } = graph({ generatedJson: clipPlan })
    const edges: SimpleEdge[] = [
      { id: "e1", source: "plan", target: "cut", sourceHandle: "edl", targetHandle: "edl" },
      { id: "e2", source: "cut", target: "cap", data: { outputMode: "each" } },
    ]
    const states = stoppedRun(clipPlan)
    states.cut = {
      ...states.cut,
      output: {
        videoUrl: "https://r2/a.mp4",
        quality: "final",
        listResults: ["https://r2/a.mp4", "https://r2/b.mp4"],
        listResultStamps: [{ quality: "final" }, { quality: "proxy" }],
      },
    }
    const subset = new Set(["cap"])
    const seeds = continuationSeeds(nodes, source({ nodeStates: states }), subset)
    const reader = continuationRenderStamps(nodes, seeds)
    const cut = nodes.find((n) => n.id === "cut")!
    expect(reader.output(cut.data)).toEqual({ quality: "final" })
    expect(reader.batch(cut.data)).toEqual([{ quality: "final" }, { quality: "proxy" }])
    const stops = runPreviewStops(nodes, edges, { nodeSubset: subset, savedRenders: reader })
    expect([...stops.gatedNodeIds]).toEqual(["cap"])
  })

  it("a render the continuation runs is judged by its quality this run, not its seed", () => {
    const { nodes, edges } = graph({ generatedJson: tightenPlan })
    const subset = new Set(["cut", "cap"])
    const finalCut = nodes.map((n) => (n.id === "cut" ? { ...n, data: { ...n.data, quality: "final" } } : n))
    const seeds = continuationSeeds(finalCut, source({ nodeStates: stoppedRun(tightenPlan) }), subset)
    const stops = runPreviewStops(finalCut, edges, { nodeSubset: subset, savedRenders: continuationRenderStamps(finalCut, seeds) })
    expect(stops.previewRenderIds).toEqual([])
    expect(stops.gatedNodeIds.size).toBe(0)
  })
})
