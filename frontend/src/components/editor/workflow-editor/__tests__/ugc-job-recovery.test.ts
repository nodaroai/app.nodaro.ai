/**
 * A UGC Script or UGC Clip job whose canvas poll died (a reload, a closed tab)
 * still reaches its node on reload — through the two reload lanes, the poll
 * restored for a job still running (`applyRestoredJobCompletion`) and the
 * recovery of one that finished (`reconcile-completed-jobs`) — exactly as the
 * canvas run lands it (`ugcJobResultPatch`, the outputs through `ugcRunPatch`),
 * stamped with the job. It lands over an OLDER result, or one no lane stamped
 * (a stamped result outranks an unstamped one): never over one from a newer job
 * or run, never over the job's own (it already landed), never over a stamped
 * result whose end cannot be read, never over a UGC Clip's fanned-out batch,
 * never while a run of the node is in flight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reconcileCompletedSingleNodeJobs } from "@/lib/reconcile-completed-jobs"
import { applyRestoredJobCompletion } from "../run-handlers"
import { resultsRunMark } from "../triggered-run-follow"

type Data = Record<string, unknown>
const SCRIPT_ROW = { plan: { hook: "h", beats: [{ line: "l" }], closer: { line: "c" } }, productCategory: "saas", warnings: [], notes: ["n"], rounds: 1 }
const PLAN_WIRE = JSON.stringify({ v: 1, ...SCRIPT_ROW.plan })
const CLIP_ROW = { videoUrl: "https://cdn.example/c1.mp4", durationSec: 12, clipWarnings: ["clip_lengthened:12"], thumbnailUrl: "https://cdn.example/c1.jpg" }
const OLD_TAKE = { url: "https://cdn.example/c0.mp4", timestamp: "2026-10-05T09:00:00.000Z", jobId: "job-0" }

const nodeOf = (type: string, data: Data = {}): WorkflowNode =>
  ({ id: "n", type, position: { x: 0, y: 0 }, data: { label: type, ...data } }) as unknown as WorkflowNode
const dataNow = () => useWorkflowStore.getState().nodes[0]!.data as Data

/** The reload recovery over one finished single-node job of node "n". */
async function recover(node: WorkflowNode, job: { id: string; createdAt: string; completedAt: string; output: Data | null }) {
  act(() => useWorkflowStore.setState({ nodes: [node], edges: [] }))
  const item = { id: job.id, triggerType: "single-node", createdAt: job.createdAt, completedAt: job.completedAt, nodeStates: { n: { nodeId: "n", jobId: job.id, status: "completed" } } }
  await reconcileCompletedSingleNodeJobs("wf-1", [node], (id, patch) => useWorkflowStore.getState().updateNodeData(id, patch), {
    listCompleted: async () => ({ data: [item] }),
    fetchOutput: async () => ({ status: "completed", output_data: job.output }),
    nowIso: "2026-10-05T12:00:00.000Z",
    readLiveData: () => dataNow(),
  })
  return dataNow()
}

const J1 = { id: "job-1", createdAt: "2026-10-05T10:00:00.000Z", completedAt: "2026-10-05T10:01:00.000Z" }

beforeEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})
afterEach(() => vi.useRealTimers())

describe("the reload recovery of a finished UGC job (reconcile-completed-jobs)", () => {
  it("a Script whose canvas poll died, reloaded: its paid plan appears, stamped with the job", async () => {
    const data = await recover(nodeOf("ugc-script", { targetDurationSec: 15, keepResult: false }), { ...J1, output: SCRIPT_ROW })
    expect(data.ugcOutputs).toEqual({ plan: PLAN_WIRE, category: "saas" })
    expect(data.result).toMatchObject({ plan: SCRIPT_ROW.plan, productCategory: "saas", notes: ["n"], rounds: 1 })
    expect(data).toMatchObject({ executionStatus: "completed", ...resultsRunMark("job-1", J1.completedAt) })
  })
  it("a re-run whose poll died lands over the older script the node still held", async () => {
    const older = { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"old\"}" }, ...resultsRunMark("job-0", "2026-10-05T09:00:00.000Z") }
    const data = await recover(nodeOf("ugc-script", { targetDurationSec: 15, keepResult: false, ...older }), { ...J1, output: SCRIPT_ROW })
    expect((data.ugcOutputs as Data).plan).toBe(PLAN_WIRE)
    expect(data.resultsRunId).toBe("job-1")
  })
  it("a node that ran again after that job is left untouched", async () => {
    const newer = { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"newer\"}" }, ...resultsRunMark("exec-2", "2026-10-05T11:00:00.000Z") }
    const node = nodeOf("ugc-script", { targetDurationSec: 15, keepResult: false, ...newer })
    const data = await recover(node, { ...J1, output: SCRIPT_ROW })
    expect(data).toEqual(node.data)
  })
  it("a node already showing the job, or holding a stamped result whose end cannot be read, is left untouched", async () => {
    const shown = nodeOf("ugc-script", { ugcOutputs: { plan: PLAN_WIRE }, ...resultsRunMark("job-1", J1.completedAt) })
    expect(await recover(shown, { ...J1, output: SCRIPT_ROW })).toEqual(shown.data)
    const noEnd = nodeOf("ugc-script", { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"mine\"}" }, resultsRunId: "exec-7" })
    expect(await recover(noEnd, { ...J1, output: SCRIPT_ROW })).toEqual(noEnd.data)
  })
  it("a result no lane stamped gives way to the stamped job, as UGC Creator's options do", async () => {
    const unstamped = nodeOf("ugc-script", { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"mine\"}" } })
    const data = await recover(unstamped, { ...J1, output: SCRIPT_ROW })
    expect(data).toMatchObject({ ugcOutputs: { plan: PLAN_WIRE, category: "saas" }, resultsRunId: "job-1" })
  })
  it("a node with a run in flight is left to that run", async () => {
    const running = nodeOf("ugc-script", { executionStatus: "running", currentJobId: "job-2" })
    expect(await recover(running, { ...J1, output: SCRIPT_ROW })).toEqual(running.data)
  })
  it("a script job that finished without its plan lands nothing", async () => {
    const empty = nodeOf("ugc-script", { targetDurationSec: 15 })
    expect(await recover(empty, { ...J1, output: { productCategory: "saas" } })).toEqual(empty.data)
  })
  it("a clip's take lands ahead of the older takes it held, with the clip's own fields", async () => {
    const node = nodeOf("ugc-clip", { rerender: {}, generatedVideoUrl: OLD_TAKE.url, generatedResults: [OLD_TAKE], activeResultIndex: 0,
      ugcOutputs: { "video-out": OLD_TAKE.url }, ...resultsRunMark("job-0", OLD_TAKE.timestamp) })
    const data = await recover(node, { ...J1, output: CLIP_ROW })
    expect(data).toMatchObject({ generatedVideoUrl: CLIP_ROW.videoUrl, activeResultIndex: 0, ugcOutputs: { "video-out": CLIP_ROW.videoUrl }, clipWarnings: CLIP_ROW.clipWarnings, durationSec: 12, resultsRunId: "job-1" })
    expect((data.generatedResults as Data[]).map((r) => r.url)).toEqual([CLIP_ROW.videoUrl, OLD_TAKE.url])
    expect((data.generatedResults as Data[])[0]).toMatchObject({ jobId: "job-1", thumbnailUrl: CLIP_ROW.thumbnailUrl })
  })
  it("a clip's take that lands takes its Re-render marks away: the run rendered it", async () => {
    const node = nodeOf("ugc-clip", { rerender: { "1": 1 }, rerenderPending: { "1": true }, generatedVideoUrl: OLD_TAKE.url, generatedResults: [OLD_TAKE],
      ugcOutputs: { "video-out": OLD_TAKE.url }, ...resultsRunMark("job-0", OLD_TAKE.timestamp) })
    const data = await recover(node, { ...J1, output: CLIP_ROW })
    expect(data.rerenderPending).toBeUndefined()
    expect(data.rerender).toEqual({ "1": 1 })
  })
  it("a clip holding a fanned-out batch is never collapsed into one of its jobs", async () => {
    const batch = nodeOf("ugc-clip", { rerender: {}, __listResults: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"], __listResultMeta: [{ warnings: [], durationSec: 12 }, { warnings: [], durationSec: 12 }] })
    expect(await recover(batch, { ...J1, output: CLIP_ROW })).toEqual(batch.data)
  })
  it("a job that settled before Clear results never paints the cleared node", async () => {
    const cleared = nodeOf("ugc-script", { targetDurationSec: 15, resultsClearedAt: "2026-10-05T11:00:00.000Z" })
    expect(await recover(cleared, { ...J1, output: SCRIPT_ROW })).toEqual(cleared.data)
  })
})

describe("the poll restored after a reload (applyRestoredJobCompletion)", () => {
  const restored = (type: string, data: Data) => act(() => useWorkflowStore.setState({ nodes: [nodeOf(type, { executionStatus: "running", currentJobId: "job-1", ...data })], edges: [] }))

  it("a Script's job lands its plan, stamped with the job, and the run settles", () => {
    restored("ugc-script", { targetDurationSec: 15 })
    act(() => applyRestoredJobCompletion("n", "ugc-script", { output_data: SCRIPT_ROW }, "job-1"))
    const data = dataNow()
    expect(data).toMatchObject({ executionStatus: "completed", ugcOutputs: { plan: PLAN_WIRE, category: "saas" }, resultsRunId: "job-1" })
    expect(data.currentJobId).toBeUndefined()
    expect(data.result).toMatchObject({ plan: SCRIPT_ROW.plan })
  })
  it("a Clip's job lands its take ahead of the ones it held", () => {
    restored("ugc-clip", { rerender: {}, generatedResults: [OLD_TAKE], generatedVideoUrl: OLD_TAKE.url, ugcOutputs: { "video-out": OLD_TAKE.url }, ...resultsRunMark("job-0", OLD_TAKE.timestamp) })
    act(() => applyRestoredJobCompletion("n", "ugc-clip", { output_data: CLIP_ROW }, "job-1"))
    const data = dataNow()
    expect(data).toMatchObject({ generatedVideoUrl: CLIP_ROW.videoUrl, ugcOutputs: { "video-out": CLIP_ROW.videoUrl }, durationSec: 12 })
    expect((data.generatedResults as Data[]).map((r) => r.url)).toEqual([CLIP_ROW.videoUrl, OLD_TAKE.url])
  })
  it("a node showing a run that ended after this job keeps it; its run settles", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-05T10:01:00.000Z"))
    const newer = { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"newer\"}" }, ...resultsRunMark("exec-2", "2026-10-05T10:05:00.000Z") }
    restored("ugc-script", newer)
    act(() => applyRestoredJobCompletion("n", "ugc-script", { output_data: SCRIPT_ROW }, "job-1"))
    const data = dataNow()
    expect(data).toMatchObject({ executionStatus: "completed", ...newer })
    expect(data.currentJobId).toBeUndefined()
  })
  it("the job lands stamped with its own end on the server's clock, not this browser's", () => {
    restored("ugc-script", { targetDurationSec: 15 })
    act(() => applyRestoredJobCompletion("n", "ugc-script", { output_data: SCRIPT_ROW, completed_at: "2026-10-05T10:00:20.000Z" }, "job-1"))
    expect(dataNow()).toMatchObject({ resultsRunId: "job-1", resultsRunEndedAt: "2026-10-05T10:00:20.000Z" })
  })
  it("a newer result is kept by the server's own times, whatever this browser's clock says", () => {
    vi.useFakeTimers()
    // This browser runs two hours fast: read on its clock, the job would look the newer one.
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"))
    const newer = { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"newer\"}" }, ...resultsRunMark("exec-2", "2026-10-05T10:05:00.000Z") }
    restored("ugc-script", newer)
    act(() => applyRestoredJobCompletion("n", "ugc-script", { output_data: SCRIPT_ROW, completed_at: "2026-10-05T10:01:00.000Z" }, "job-1"))
    expect(dataNow()).toMatchObject({ executionStatus: "completed", ...newer })
  })
  it("what the node held before the run in flight began is older, stamped or not", () => {
    restored("ugc-clip", { rerender: {}, generatedResults: [OLD_TAKE], generatedVideoUrl: OLD_TAKE.url })
    act(() => applyRestoredJobCompletion("n", "ugc-clip", { output_data: CLIP_ROW }, "job-1"))
    expect(dataNow()).toMatchObject({ generatedVideoUrl: CLIP_ROW.videoUrl, resultsRunId: "job-1" })
  })
  it("a node already showing this job is left as it is; its run settles", () => {
    restored("ugc-script", { ugcOutputs: { plan: "{\"v\":1,\"hook\":\"edited\"}" }, ...resultsRunMark("job-1", "2026-10-05T10:01:00.000Z") })
    act(() => applyRestoredJobCompletion("n", "ugc-script", { output_data: SCRIPT_ROW }, "job-1"))
    expect(dataNow()).toMatchObject({ executionStatus: "completed", ugcOutputs: { plan: "{\"v\":1,\"hook\":\"edited\"}" } })
  })
  it("a fanned-out clip is never collapsed into one restored job", () => {
    restored("ugc-clip", { rerender: {}, __listResults: ["https://cdn.example/a.mp4"], __listResultMeta: [{ warnings: [], durationSec: 12 }] })
    act(() => applyRestoredJobCompletion("n", "ugc-clip", { output_data: CLIP_ROW }, "job-1"))
    expect(dataNow()).toMatchObject({ executionStatus: "completed", __listResults: ["https://cdn.example/a.mp4"] })
    expect(dataNow().generatedVideoUrl).toBeUndefined()
  })
  it("a job that finished without its plan fails the node, as the canvas run does", () => {
    restored("ugc-script", {})
    act(() => applyRestoredJobCompletion("n", "ugc-script", { output_data: { productCategory: "saas" } }, "job-1"))
    expect(dataNow()).toMatchObject({ executionStatus: "failed", errorMessage: "Job job-1 completed but produced no output — provider may have returned an empty result" })
  })
})
