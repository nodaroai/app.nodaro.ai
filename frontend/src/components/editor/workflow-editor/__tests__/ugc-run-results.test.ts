/**
 * A server run's UGC results reach every UGC node's data through every lane
 * that paints a run onto the canvas — exactly what the node's own canvas run
 * writes (`ugcRunPatch`) — and the run stamp keeps a pick: a repaint of the
 * run a creator already shows never undoes it, and a newer run's options reach
 * a creator whose tab was closed.
 *
 * The outputs are the server's own (`ugc-run-outputs.json`, computed by a
 * backend test from the code a run goes through).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import { TRANSIENT_RUNTIME_KEYS, UGC_CREATOR_CANDIDATES_KEY } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyBackendExecutionState, applyCompletedExecutionResults, restoreEndedEditorRun } from "@/hooks/use-workflow-persistence"
import { pickUgcCreator, ugcCreditStopOf } from "@/lib/ugc-creator-run"
import { ugcRunPatch } from "@/lib/ugc-run-patch"
import { paintRunStates } from "../run-handlers"
import { nodeHasRunOutput } from "../run-up-to-here-set"
import { resultsRunMark } from "../triggered-run-follow"
import outputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-run-outputs.json"

type Data = Record<string, unknown>
type Lane = (node: WorkflowNode, state: Data) => Data

const O = outputs as Record<string, Data>
const outs = (k: string) => O[k]!.ugcOutputs as Record<string, string>
const JOB = "c0ffee00-0000-4000-8000-0000000000aa"
const ENDED = "2026-10-05T10:00:30.000Z"

/** A node that ran in the run. */
const ran = (output: Data, jobId: string | undefined = JOB): Data => ({
  status: "completed",
  startedAt: "2026-10-05T10:00:00.000Z",
  completedAt: "2026-10-05T10:00:20.000Z",
  ...(jobId ? { jobId } : {}),
  output,
})

const LANES: ReadonlyArray<readonly [string, Lane]> = [
  [
    "the live run",
    (node, state) => {
      act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
      act(() => paintRunStates({ [node.id]: state } as never))
      return useWorkflowStore.getState().nodes[0]!.data as Data
    },
  ],
  ["a reopen while it runs", (node, state) => applyBackendExecutionState([node], { [node.id]: state } as never)[0]!.data as Data],
  ["a reopen after it ended", (node, state) => applyCompletedExecutionResults([node], { [node.id]: state } as never, ENDED)[0]!.data as Data],
]

const nodeOf = (type: string, data: Data = {}): WorkflowNode =>
  ({ id: "n", type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode

/** The node's data without the keys no save keeps (`TRANSIENT_RUNTIME_KEYS`): what a reload compares. */
const lasting = (d: Data): Data => Object.fromEntries(Object.entries(d).filter(([k]) => !TRANSIENT_RUNTIME_KEYS.has(k)))
/** A node as a reload reads it back from the save: no transient key. */
const saved = (node: WorkflowNode): WorkflowNode => ({ ...node, data: lasting(node.data as Data) }) as WorkflowNode

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

const CASES: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ["ugc-creator", "ugc-creator:pair", {}],
  ["ugc-creator", "ugc-creator:one", {}],
  ["ugc-script", "ugc-script", {}],
  ["ugc-clips", "ugc-clips", {}],
  ["ugc-clip", "ugc-clip", { rerender: {} }],
  ["ugc-clip", "ugc-clip:fan-out", { rerender: {} }],
  ["ugc-cards", "ugc-cards", {}],
]
describe.each(LANES)("a server run's UGC results, through %s", (_lane, paint) => {
  it.each(CASES)("%s (%s): the node holds exactly what its canvas run writes", (type, key, data) => {
    const painted = paint(nodeOf(type, data), ran(O[key]!))
    expect(painted).toMatchObject(ugcRunPatch(type, O[key]!)!)
  })
  it("the script reads as run, so Run up to here below it leaves it alone", () => {
    const painted = paint(nodeOf("ugc-script"), ran(O["ugc-script"]!))
    expect(nodeHasRunOutput(nodeOf("ugc-script", painted))).toBe(true)
  })
  it("a creator with options waiting hands nothing on, whatever older image it held", () => {
    const painted = paint(nodeOf("ugc-creator", { generatedImageUrl: "https://cdn.example/old.png" }), ran(O["ugc-creator:pair"]!))
    expect(painted.ugcOutputs).toBeUndefined()
    expect(painted.generatedImageUrl).toBeUndefined()
    expect(nodeHasRunOutput(nodeOf("ugc-creator", painted))).toBe(false)
  })
  it("a clip is a video: its take lands with the clip's own fields", () => {
    const painted = paint(nodeOf("ugc-clip", { rerender: {} }), ran(O["ugc-clip"]!))
    expect(painted.generatedVideoUrl).toBe(O["ugc-clip"]!.videoUrl)
  })
})

describe.each(LANES.slice(0, 2))("options waiting, through %s: the older creator wire goes too", (_lane, paint) => {
  it("a creator that handed an older creator on holds the options and no creator wire", () => {
    const painted = paint(nodeOf("ugc-creator", { generatedImageUrl: "https://cdn.example/old.png", ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/old.png" } }), ran(O["ugc-creator:pair"]!))
    expect(painted.ugcOutputs).toBeUndefined()
    expect(painted.generatedImageUrl).toBeUndefined()
    expect(painted[UGC_CREATOR_CANDIDATES_KEY]).toEqual(O["ugc-creator:pair"]!.ugcCandidates)
  })
})

describe("a reopen after the run ended (applyCompletedExecutionResults)", () => {
  it("an older image on the node does not keep the run's creator out", () => {
    const node = nodeOf("ugc-creator", { executionStatus: "pending", generatedImageUrl: "https://cdn.example/old.png" })
    const data = applyCompletedExecutionResults([node], { [node.id]: ran(O["ugc-creator:one"]!) } as never, ENDED)[0]!.data as Data
    expect(data.generatedImageUrl).toBe(outs("ugc-creator:one").image)
    expect(data.ugcOutputs).toEqual(outs("ugc-creator:one"))
  })
  it("a reload after a pick does not bring the options back", () => {
    act(() => useWorkflowStore.setState({ nodes: [nodeOf("ugc-creator", { source: "sampled", gender: "woman", keepResult: false })], edges: [] }))
    act(() => paintRunStates({ n: ran(O["ugc-creator:pair"]!) } as never, { runId: "exec-1" }))
    act(() => { pickUgcCreator("n", 0) })
    const picked = useWorkflowStore.getState().nodes
    const reloaded = applyCompletedExecutionResults(picked.map(saved), { n: ran(O["ugc-creator:pair"]!) } as never, ENDED, RUN_1)[0]!.data as Data
    expect(lasting(reloaded)).toEqual(lasting(picked[0]!.data as Data))
  })
  it("a script or clip it fills is stamped with the run, so a later reload can tell its age", () => {
    const script = applyCompletedExecutionResults([nodeOf("ugc-script")], { n: ran(O["ugc-script"]!) } as never, ENDED, RUN_1)[0]!.data as Data
    expect(script).toMatchObject({ resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-05T10:00:20.000Z" })
    const clip = applyCompletedExecutionResults([nodeOf("ugc-clip", { rerender: {} })], { n: ran(O["ugc-clip"]!) } as never, ENDED, RUN_1)[0]!.data as Data
    expect(clip.resultsRunId).toBe("exec-1")
    // Without the run, no stamp (nothing to name).
    expect((applyCompletedExecutionResults([nodeOf("ugc-script")], { n: ran(O["ugc-script"]!) } as never, ENDED)[0]!.data as Data).resultsRunId).toBeUndefined()
  })
  it("a node already holding a UGC result of its own keeps it when the run is not known", () => {
    const node = saved(nodeOf("ugc-script", { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"mine\"}" } }))
    const data = applyCompletedExecutionResults([node], { n: ran(O["ugc-script"]!) } as never, ENDED)[0]!.data as Data
    expect(data.ugcOutputs).toEqual({ plan: "{\"v\":1,\"hook\":\"mine\"}" })
  })
  it("a result no lane stamped gives way to the known run's, which stamps the node", () => {
    const node = saved(nodeOf("ugc-script", { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"mine\"}" } }))
    const data = applyCompletedExecutionResults([node], { n: ran(O["ugc-script"]!) } as never, ENDED, RUN_1)[0]!.data as Data
    expect(data.ugcOutputs).toEqual(O["ugc-script"]!.ugcOutputs)
    expect(data.resultsRunId).toBe("exec-1")
  })
})

const RUN_0 = { id: "exec-0", completedAt: "2026-10-05T09:00:00.000Z" }
const RUN_1 = { id: "exec-1", completedAt: ENDED }
const stamped = (run: { id: string; completedAt: string }) => resultsRunMark(run.id, run.completedAt)
const PICKED = { source: "sampled", gender: "woman", keepResult: true, result: { v: 1, identityImages: ["https://cdn.example/a.png"] },
  ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/a.png" }, generatedImageUrl: "https://cdn.example/a.png", executionStatus: "completed" }

describe("the run stamp: a repaint never undoes a pick; a newer run's options reach a closed tab", () => {
  const pair = () => ran(O["ugc-creator:pair"]!)
  const ended = (states: Record<string, unknown>) => ({ ...RUN_1, kind: "run", status: "completed", triggerType: "manual", nodeStates: states })
  it("(a) restoreEndedEditorRun on a canvas with an Apply EDL node leaves a picked creator stamped exec-1 untouched", () => {
    const creator = nodeOf("ugc-creator", { ...PICKED, ...stamped(RUN_1) })
    const out = restoreEndedEditorRun([creator, { ...nodeOf("apply-edl"), id: "render" }], [], ended({ n: pair() }) as never, [])
    expect(lasting(out[0]!.data as Data)).toEqual(lasting(creator.data as Data))
  })
  it("(b) control: an unpicked creator stamped exec-0 gets its options, and its stamp becomes exec-1", () => {
    const creator = nodeOf("ugc-creator", { source: "sampled", gender: "woman", keepResult: false, ugcOutputs: { creator: "{\"v\":1}" }, ...stamped(RUN_0) })
    const data = restoreEndedEditorRun([creator, { ...nodeOf("apply-edl"), id: "render" }], [], ended({ n: pair() }) as never, [])[0]!.data as Data
    expect(data[UGC_CREATOR_CANDIDATES_KEY]).toEqual(O["ugc-creator:pair"]!.ugcCandidates)
    expect(data.resultsRunId).toBe("exec-1")
  })
  it("(c) applyBackendExecutionState of the run the node shows keeps the pick", () => {
    const creator = nodeOf("ugc-creator", { ...PICKED, ...stamped(RUN_1) })
    const data = applyBackendExecutionState([creator], { n: pair() } as never, { runId: "exec-1" })[0]!.data as Data
    expect(data[UGC_CREATOR_CANDIDATES_KEY]).toBeUndefined()
    expect(data).toMatchObject({ keepResult: true, ugcOutputs: PICKED.ugcOutputs })
  })
  it("(d) a credits stop painted twice around a pick keeps the pick", () => {
    const stop = O["ugc-creator:stopped"]!
    const failed = { status: "failed", nodeType: "ugc-creator", error: "Insufficient credits", errorCode: stop.errorCode, output: stop.output }
    act(() => useWorkflowStore.setState({ nodes: [nodeOf("ugc-creator", { source: "sampled", gender: "woman", keepResult: false })], edges: [] }))
    act(() => paintRunStates({ n: failed } as never, { runId: "exec-1" }))
    act(() => { pickUgcCreator("n", 0) })
    const picked = lasting(useWorkflowStore.getState().nodes[0]!.data as Data)
    act(() => paintRunStates({ n: failed } as never, { runId: "exec-1" }))
    expect(lasting(useWorkflowStore.getState().nodes[0]!.data as Data)).toEqual(picked)
  })
  it("(d') …and the reopen lane painting the same failure keeps it too", () => {
    const stop = O["ugc-creator:stopped"]!
    const failed = { status: "failed", nodeType: "ugc-creator", error: "Insufficient credits", errorCode: stop.errorCode, output: stop.output }
    const creator = nodeOf("ugc-creator", { ...PICKED, ...stamped(RUN_1) })
    const data = applyBackendExecutionState([creator], { n: failed } as never, { runId: "exec-1" })[0]!.data as Data
    expect(lasting(data)).toEqual(lasting(creator.data as Data))
    expect(data.executionStatus).toBe("completed")
  })
  it("(e) the run paused with the tab closed: on reopen its options show, over the older outputs", () => {
    const creator = nodeOf("ugc-creator", { source: "sampled", gender: "woman", keepResult: false, executionStatus: "completed",
      ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/old.png" }, generatedImageUrl: "https://cdn.example/old.png", ...stamped(RUN_0) })
    const data = restoreEndedEditorRun([creator], [], ended({ n: pair() }) as never, [])[0]!.data as Data
    expect(data[UGC_CREATOR_CANDIDATES_KEY]).toEqual(O["ugc-creator:pair"]!.ugcCandidates)
    expect(data.ugcOutputs).toBeUndefined()
    expect(data.resultsRunId).toBe("exec-1")
  })
  it("(f) …and a creator picked from that run is never repainted by it", () => {
    const creator = saved(nodeOf("ugc-creator", { ...PICKED, ...stamped(RUN_1) }))
    const out = restoreEndedEditorRun([creator], [], ended({ n: pair() }) as never, [])
    expect(lasting(out[0]!.data as Data)).toEqual(lasting(creator.data as Data))
  })
  it("(g) an older run's options never land over a newer run's creator", () => {
    const creator = saved(nodeOf("ugc-creator", { ...PICKED, ...resultsRunMark("exec-2", "2026-10-05T11:00:00.000Z") }))
    const out = restoreEndedEditorRun([creator], [], ended({ n: pair() }) as never, [])
    expect(lasting(out[0]!.data as Data)).toEqual(lasting(creator.data as Data))
  })
})

describe("a credits stop on a server run", () => {
  it("the failed creator keeps its options, and the dialog opens once with the route's numbers", () => {
    const stop = O["ugc-creator:stopped"]!
    const failed = { status: "failed", nodeType: "ugc-creator", error: "Insufficient credits", errorCode: stop.errorCode, output: stop.output }
    act(() => useWorkflowStore.setState({ nodes: [nodeOf("ugc-creator")], edges: [] }))
    act(() => paintRunStates({ n: failed } as never, { runId: "exec-1" }))
    const data = useWorkflowStore.getState().nodes[0]!.data as Data
    expect(data[UGC_CREATOR_CANDIDATES_KEY]).toEqual((stop.output as Data).ugcCandidates)
    expect(ugcCreditStopOf({ n: failed } as never)).toEqual({ nodeId: "n", ...((stop.output as Data).ugcShortfall as object) })
  })
  it("a stop that kept no option leaves the creator's last result", () => {
    const failed = { status: "failed", nodeType: "ugc-creator", error: "Insufficient credits", errorCode: "insufficient_credits", output: { ugcShortfall: { required: 18, balance: 5 } } }
    act(() => useWorkflowStore.setState({ nodes: [nodeOf("ugc-creator", { ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/a.png" } })], edges: [] }))
    act(() => paintRunStates({ n: failed } as never, { runId: "exec-1" }))
    expect(useWorkflowStore.getState().nodes[0]!.data).toMatchObject({ executionStatus: "failed", ugcOutputs: { creator: "{\"v\":1}", image: "https://cdn.example/a.png" } })
  })
})

describe("the live lane does not repaint a UGC node on every tick", () => {
  it("UGC Clips, painted once, is left alone by the next tick of the same states", () => {
    act(() => useWorkflowStore.setState({ nodes: [nodeOf("ugc-clips")], edges: [] }))
    act(() => paintRunStates({ n: ran(O["ugc-clips"]!) } as never, { runId: "exec-1" }))
    act(() => useWorkflowStore.setState({ isDirty: false }))
    const before = useWorkflowStore.getState().nodes[0]
    act(() => paintRunStates({ n: ran(O["ugc-clips"]!) } as never, { runId: "exec-1" }))
    expect(useWorkflowStore.getState().nodes[0]).toBe(before)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})
