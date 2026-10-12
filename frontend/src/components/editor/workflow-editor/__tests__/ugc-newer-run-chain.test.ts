/**
 * The newer run wins over a UGC video's whole chain. Its finish nodes — the
 * join of its clips, the overlay drawing its screenshot cards, the captions on
 * its caption plan, each the video's only by its place in the chain
 * (`ugcFinishNodeIds`), whatever else they take or hold: a join taking an intro
 * beside the clips, an overlay with a logo of its own — take a newer run's video
 * on reopen as UGC Clip takes its newer take: by the same stamp (which run, and
 * when it ended on the server's clock), a stamped video over one no lane
 * stamped, never over the run the node shows, a newer one, or a stamped one
 * whose end cannot be read. Every lane that lands one stamps it: the reopen of
 * an ended run, the reopen of a run still going, the poll restored after a
 * reload, the reload's recovery of a finished job, the canvas run and a canvas
 * pass-through.
 *
 * A Combine Videos, Video Overlay or Add Captions outside a UGC video keeps
 * the fill-only rule, and so does a plain Generate Video.
 *
 * The graph a closed-tab re-run reopens to is pinned in
 * `ugc-reopened-newer-chain.json`; the backend half
 * (`ugc-newer-run-continue.test.ts`) runs Run from here on UGC Cards over it:
 * the cards and the overlay must finish the newer joined video. The URLs and
 * text are placeholders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ugcFinishNodeIds } from "@nodaro/render-rules"
import { applyBackendExecutionState, applyCompletedExecutionResults, restoreEndedEditorRun } from "@/hooks/use-workflow-persistence"
import { reconcileCompletedSingleNodeJobs } from "@/lib/reconcile-completed-jobs"
import { applyRestoredJobCompletion } from "../run-handlers"
import { completeAsPassThrough } from "../pass-through"
import { resultsRunMark } from "../triggered-run-follow"
import outputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-run-outputs.json"
import pinned from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-reopened-newer-chain.json"

type Data = Record<string, unknown>
const O = outputs as Record<string, Data>

const OLDER = { joined: "https://cdn.example/older-joined.mp4", carded: "https://cdn.example/older-carded.mp4", captioned: "https://cdn.example/older-captioned.mp4" }
const NEWER = { joined: "https://cdn.example/joined.mp4", carded: "https://cdn.example/carded.mp4", captioned: "https://cdn.example/captioned.mp4" }
const OLDER_TAKE = "https://cdn.example/older-c0.mp4"
const NEWER_TAKE = O["ugc-clip"]!.videoUrl as string

const RUN_1 = { id: "exec-1", completedAt: "2026-10-05T09:01:00.000Z" }
const RUN_2 = { id: "exec-2", completedAt: "2026-10-05T10:01:00.000Z" }
const ran = (output: Data, end: string): Data => ({ status: "completed", startedAt: "2026-10-05T10:00:00.000Z", completedAt: end, output })
const listed = (run: { id: string; completedAt: string }, states: Record<string, unknown>) =>
  ({ ...run, kind: "run", status: "completed", triggerType: "manual", nodeStates: states }) as never

const nodeOf = (id: string, type: string, data: Data) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, sourceHandle: string | null, targetHandle: string) =>
  ({ id: `${source}-${sourceHandle ?? "out"}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })

/** A video result as every video node holds one, stamped with the run that rendered it. */
const video = (url: string, run: { id: string; completedAt: string }): Data => ({
  executionStatus: "completed",
  generatedVideoUrl: url,
  generatedResults: [{ url, timestamp: run.completedAt, jobId: `${run.id}-job` }],
  activeResultIndex: 0,
  ...resultsRunMark(run.id, run.completedAt),
})

/** The template's UGC video as the run before left it, its clip's take, cards, join, overlay and captions all that run's. */
const before = (): WorkflowNode[] => [
  nodeOf("clips", "ugc-clips", { executionStatus: "completed", ugcOutputs: { clips: "{\"v\":1}", "plan-out": "{\"v\":1}", transcript: "older" }, ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:20.000Z") }),
  nodeOf("clip", "ugc-clip", { rerender: {}, ...video(OLDER_TAKE, { id: RUN_1.id, completedAt: "2026-10-05T09:00:30.000Z" }), ugcOutputs: { "video-out": OLDER_TAKE }, durationSec: 9, clipWarnings: [] }),
  nodeOf("join", "combine-videos", { transition: "cut", audioMode: "keep", smartCutEnabled: false, ...video(OLDER.joined, { id: RUN_1.id, completedAt: "2026-10-05T09:00:35.000Z" }) }),
  nodeOf("cards", "ugc-cards", { executionStatus: "completed", ugcOutputs: { layerPlan: "[]", captionPlan: "{\"v\":1}", report: "An older note." }, generatedText: "An older note.", ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:40.000Z") }),
  nodeOf("overlay", "video-overlay", { layers: [], layerCount: 0, ...video(OLDER.carded, { id: RUN_1.id, completedAt: "2026-10-05T09:00:50.000Z" }), warnings: [], width: 720, height: 1280, durationSec: 9 }),
  nodeOf("captions", "add-captions", { style: "body", ...video(OLDER.captioned, { id: RUN_1.id, completedAt: RUN_1.completedAt }) }),
]
const EDGES = [
  edge("clips", "clip", "clips", "clip"), edge("clip", "join", null, "in"), edge("clip", "cards", "video-out", "notes"),
  edge("clips", "cards", "plan-out", "plan"), edge("clips", "cards", "transcript", "transcript"), edge("join", "cards", null, "video"),
  edge("join", "overlay", null, "video"), edge("cards", "overlay", "layerPlan", "layerPlan"), edge("cards", "captions", "captionPlan", "captionPlan"),
  edge("overlay", "captions", null, "in"),
]
/** A whole re-run that ended while the editor was closed. */
const RERUN = {
  clips: ran(O["ugc-clips"]!, "2026-10-05T10:00:20.000Z"),
  clip: ran(O["ugc-clip"]!, "2026-10-05T10:00:30.000Z"),
  join: ran({ videoUrl: NEWER.joined }, "2026-10-05T10:00:35.000Z"),
  cards: ran(O["ugc-cards"]!, "2026-10-05T10:00:40.000Z"),
  overlay: ran({ videoUrl: NEWER.carded, warnings: [], width: 720, height: 1280, durationSec: 12 }, "2026-10-05T10:00:50.000Z"),
  captions: ran({ videoUrl: NEWER.captioned }, RUN_2.completedAt),
}
const dataOf = (nodes: readonly WorkflowNode[], id: string) => nodes.find((n) => n.id === id)!.data as Data
const urlsOf = (data: Data) => (data.generatedResults as Data[]).map((r) => r.url)

afterEach(() => vi.useRealTimers())

describe("a closed-tab re-run of the whole video, reopened", () => {
  it("its join, overlay and captions take the newer videos, the older ones kept below, each stamped with the run", () => {
    // A landed take is dated when it lands: a fixed clock, for the pinned graph.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"))
    const nodes = restoreEndedEditorRun(before(), EDGES as never, listed(RUN_2, RERUN), [])
    expect(dataOf(nodes, "join")).toMatchObject({ generatedVideoUrl: NEWER.joined, activeResultIndex: 0, resultsRunId: "exec-2", resultsRunEndedAt: "2026-10-05T10:00:35.000Z", transition: "cut" })
    expect(urlsOf(dataOf(nodes, "join"))).toEqual([NEWER.joined, OLDER.joined])
    expect(dataOf(nodes, "overlay")).toMatchObject({ generatedVideoUrl: NEWER.carded, durationSec: 12, resultsRunId: "exec-2", resultsRunEndedAt: "2026-10-05T10:00:50.000Z" })
    expect(urlsOf(dataOf(nodes, "overlay"))).toEqual([NEWER.carded, OLDER.carded])
    expect(dataOf(nodes, "captions")).toMatchObject({ generatedVideoUrl: NEWER.captioned, resultsRunId: "exec-2", resultsRunEndedAt: RUN_2.completedAt })
    expect(urlsOf(dataOf(nodes, "captions"))).toEqual([NEWER.captioned, OLDER.captioned])
    // UGC Clip's take and UGC Cards, as before.
    expect(dataOf(nodes, "clip")).toMatchObject({ generatedVideoUrl: NEWER_TAKE, resultsRunId: "exec-2" })
    expect(dataOf(nodes, "cards")).toMatchObject({ ugcOutputs: O["ugc-cards"]!.ugcOutputs as Data, resultsRunId: "exec-2" })
    expect(
      { nodes: nodes.map(({ id, type, data }) => ({ id, type, data })), edges: EDGES },
      "update fixtures/ugc-reopened-newer-chain.json, then run the backend's ugc-newer-run-continue test",
    ).toEqual(pinned)
  })

  it("an older run never replaces the newer videos, and a canvas run of the join after it outranks it", () => {
    const newer = restoreEndedEditorRun(before(), EDGES as never, listed(RUN_2, RERUN), [])
    const older = {
      join: ran({ videoUrl: OLDER.joined }, RUN_1.completedAt),
      overlay: ran({ videoUrl: OLDER.carded }, RUN_1.completedAt),
      captions: ran({ videoUrl: OLDER.captioned }, RUN_1.completedAt),
    }
    expect(restoreEndedEditorRun(newer, EDGES as never, listed(RUN_1, older), [])).toEqual(newer)
    // A ▶ on the join after the run, stamped with its job on the server's clock.
    const canvas = newer.map((n) => (n.id === "join" ? { ...n, data: { ...n.data, ...video("https://cdn.example/rejoined.mp4", { id: "job-9", completedAt: "2026-10-05T11:00:00.000Z" }) } } : n)) as WorkflowNode[]
    expect(dataOf(restoreEndedEditorRun(canvas, EDGES as never, listed(RUN_2, RERUN), []), "join").generatedVideoUrl).toBe("https://cdn.example/rejoined.mp4")
  })

  it("a video no lane stamped gives way to the stamped run's; a stamped one whose end cannot be read is kept", () => {
    const { resultsRunId: _id, resultsRunEndedAt: _end, ...unstampedJoin } = dataOf(before(), "join")
    const unstamped = before().map((n) => (n.id === "join" ? { ...n, data: unstampedJoin } : n)) as WorkflowNode[]
    expect(dataOf(restoreEndedEditorRun(unstamped, EDGES as never, listed(RUN_2, RERUN), []), "join").generatedVideoUrl).toBe(NEWER.joined)
    const noEnd = before().map((n) => (n.id === "join" ? { ...n, data: { ...unstampedJoin, resultsRunId: "exec-9" } } : n)) as WorkflowNode[]
    expect(dataOf(restoreEndedEditorRun(noEnd, EDGES as never, listed(RUN_2, RERUN), []), "join").generatedVideoUrl).toBe(OLDER.joined)
  })

  it("an empty join is filled and stamped", () => {
    const empty = before().map((n) => (n.id === "join" ? nodeOf("join", "combine-videos", { transition: "cut" }) : n)) as WorkflowNode[]
    expect(dataOf(restoreEndedEditorRun(empty, EDGES as never, listed(RUN_2, RERUN), []), "join")).toMatchObject({ generatedVideoUrl: NEWER.joined, resultsRunId: "exec-2" })
  })
})

describe("a run still going when the editor reopens", () => {
  it("never repaints a finish node showing it or a newer run; paints an older one, stamped", () => {
    const ids = new Set(["join", "overlay", "captions"])
    const showsNewer = nodeOf("join", "combine-videos", { transition: "cut", ...video("https://cdn.example/newest.mp4", { id: "exec-3", completedAt: "2026-10-05T12:00:00.000Z" }) })
    expect(applyBackendExecutionState([showsNewer], { join: RERUN.join } as never, { runId: RUN_2.id, ugcFinishIds: ids })[0]!.data).toEqual(showsNewer.data)
    const showsIt = nodeOf("join", "combine-videos", { transition: "cut", ...video(NEWER.joined, { id: RUN_2.id, completedAt: "2026-10-05T10:00:35.000Z" }), activeResultIndex: 0 })
    expect(applyBackendExecutionState([showsIt], { join: RERUN.join } as never, { runId: RUN_2.id, ugcFinishIds: ids })[0]!.data).toEqual(showsIt.data)
    const olderJoin = before().find((n) => n.id === "join")!
    expect(applyBackendExecutionState([olderJoin], { join: RERUN.join } as never, { runId: RUN_2.id, ugcFinishIds: ids })[0]!.data).toMatchObject({ generatedVideoUrl: NEWER.joined, resultsRunId: "exec-2" })
  })
})

describe("a Combine Videos outside a UGC video keeps the fill-only rule", () => {
  const plain = (data: Data) => nodeOf("outro", "combine-videos", { transition: "cut", ...data })
  const state = { outro: ran({ videoUrl: NEWER.joined }, RUN_2.completedAt) }

  it("its older video stays on reopen, stamped or not; an empty one is filled", () => {
    const holds = plain(video(OLDER.joined, RUN_1))
    expect(applyCompletedExecutionResults([holds], state as never, RUN_2.completedAt, RUN_2, { ugcFinishIds: new Set() })[0]!.data).toEqual(holds.data)
    expect(restoreEndedEditorRun([holds], [] as never, listed(RUN_2, state), [])[0]!.data).toEqual(holds.data)
    const { resultsRunId: _id, resultsRunEndedAt: _end, ...unstamped } = video(OLDER.joined, RUN_1)
    expect(restoreEndedEditorRun([plain(unstamped)], [] as never, listed(RUN_2, state), [])[0]!.data).toEqual(plain(unstamped).data)
    expect(restoreEndedEditorRun([plain({})], [] as never, listed(RUN_2, state), [])[0]!.data).toMatchObject({ executionStatus: "completed", generatedVideoUrl: NEWER.joined })
  })

  it("a join after a UGC video's captions (an outro) is not the video's: it keeps its own", () => {
    const outro = nodeOf("outro", "combine-videos", { transition: "cut", ...video(OLDER.joined, RUN_1) })
    const nodes = [...before(), nodeOf("intro", "upload-video", { url: "https://cdn.example/intro.mp4" }), outro]
    const edges = [...EDGES, edge("captions", "outro", null, "in"), edge("intro", "outro", null, "in2")]
    const reopened = restoreEndedEditorRun(nodes, edges as never, listed(RUN_2, { ...RERUN, ...state }), [])
    expect(dataOf(reopened, "outro")).toEqual(outro.data)
    expect(dataOf(reopened, "captions").generatedVideoUrl).toBe(NEWER.captioned)
  })
})

describe("the lanes that land one job of a finish node", () => {
  const J = { id: "job-1", createdAt: "2026-10-05T10:00:00.000Z", completedAt: "2026-10-05T10:01:00.000Z" }
  const dataNow = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Data
  const setGraph = (nodes: WorkflowNode[], edges = EDGES) => act(() => useWorkflowStore.setState({ nodes, edges: edges as never, isDirty: false, isReadOnly: false }))

  /** The reload recovery over one finished single-node job of `nodeId`. */
  async function recover(nodeId: string, output: Data) {
    const item = { id: J.id, triggerType: "single-node", createdAt: J.createdAt, completedAt: J.completedAt, nodeStates: { [nodeId]: { nodeId, jobId: J.id, status: "completed" } } }
    await reconcileCompletedSingleNodeJobs("wf-1", useWorkflowStore.getState().nodes, (id, patch) => useWorkflowStore.getState().updateNodeData(id, patch), {
      listCompleted: async () => ({ data: [item] }),
      fetchOutput: async () => ({ status: "completed", output_data: output }),
      nowIso: "2026-10-05T12:00:00.000Z",
      readLiveData: (id) => dataNow(id),
      edges: useWorkflowStore.getState().edges,
    })
    return dataNow(nodeId)
  }

  beforeEach(() => setGraph([]))

  it("the reload recovery lands a newer join over the older one it held, in front, stamped with the job", async () => {
    setGraph(before())
    const data = await recover("join", { videoUrl: NEWER.joined })
    expect(data).toMatchObject({ generatedVideoUrl: NEWER.joined, resultsRunId: "job-1", resultsRunEndedAt: J.completedAt })
    expect(urlsOf(data)).toEqual([NEWER.joined, OLDER.joined])
  })

  it("the reload recovery leaves a join showing a newer run, and a plain Combine Videos holding a video", async () => {
    const newer = before().map((n) => (n.id === "join" ? { ...n, data: { ...n.data, ...video("https://cdn.example/newest.mp4", { id: "exec-3", completedAt: "2026-10-05T11:00:00.000Z" }) } } : n)) as WorkflowNode[]
    setGraph(newer)
    expect((await recover("join", { videoUrl: NEWER.joined })).generatedVideoUrl).toBe("https://cdn.example/newest.mp4")
    setGraph([nodeOf("outro", "combine-videos", { transition: "cut", ...video(OLDER.joined, RUN_1) })], [])
    expect((await recover("outro", { videoUrl: NEWER.joined })).generatedVideoUrl).toBe(OLDER.joined)
  })

  it("the poll restored after a reload lands a finish node's job stamped with its end, and keeps a newer video", () => {
    const running = before().map((n) => (n.id === "overlay" ? { ...n, data: { ...n.data, executionStatus: "running", currentJobId: "job-1" } } : n)) as WorkflowNode[]
    setGraph(running)
    act(() => applyRestoredJobCompletion("overlay", "video-overlay", { output_data: { videoUrl: NEWER.carded, durationSec: 12 }, completed_at: J.completedAt }, "job-1"))
    expect(dataNow("overlay")).toMatchObject({ generatedVideoUrl: NEWER.carded, resultsRunId: "job-1", resultsRunEndedAt: J.completedAt, durationSec: 12 })
    const newer = before().map((n) => (n.id === "overlay" ? { ...n, data: { ...n.data, ...video("https://cdn.example/newest.mp4", { id: "exec-3", completedAt: "2026-10-05T11:00:00.000Z" }), executionStatus: "running", currentJobId: "job-1" } } : n)) as WorkflowNode[]
    setGraph(newer)
    act(() => applyRestoredJobCompletion("overlay", "video-overlay", { output_data: { videoUrl: NEWER.carded }, completed_at: J.completedAt }, "job-1"))
    expect(dataNow("overlay")).toMatchObject({ executionStatus: "completed", generatedVideoUrl: "https://cdn.example/newest.mp4" })
    expect(dataNow("overlay").currentJobId).toBeUndefined()
  })

  it("the restored poll of a plain Combine Videos lands as before, with no stamp", () => {
    setGraph([nodeOf("outro", "combine-videos", { transition: "cut", executionStatus: "running", currentJobId: "job-1" })], [])
    act(() => applyRestoredJobCompletion("outro", "combine-videos", { output_data: { videoUrl: NEWER.joined }, completed_at: J.completedAt }, "job-1"))
    expect(dataNow("outro").generatedVideoUrl).toBe(NEWER.joined)
    expect(dataNow("outro").resultsRunId).toBeUndefined()
  })
})

describe("a join taking an intro and an overlay with a logo of its own are still the video's, on every lane", () => {
  const LOGO = "https://cdn.example/logo.png"
  const INTRO = "https://cdn.example/intro.mp4"
  /** The overlay holds a layer of its own (a stored logo); the join also takes an intro. Neither is in the price, both are the video's. */
  const custom = (): WorkflowNode[] => [
    ...before().map((n) =>
      n.id === "overlay" ? { ...n, data: { ...n.data, layers: [{ imageUrl: LOGO }], layerCount: 1 } } : n,
    ),
    nodeOf("intro", "upload-video", { url: INTRO }),
  ] as WorkflowNode[]
  const CUSTOM_EDGES = [edge("intro", "join", null, "in"), ...EDGES]
  const J = { id: "job-1", createdAt: "2026-10-05T10:00:00.000Z", completedAt: "2026-10-05T10:01:00.000Z" }
  const dataNow = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Data
  const setGraph = (nodes: WorkflowNode[]) => act(() => useWorkflowStore.setState({ nodes, edges: CUSTOM_EDGES as never, isDirty: false, isReadOnly: false }))

  beforeEach(() => setGraph([]))

  it("are members by place", () => {
    expect([...ugcFinishNodeIds(custom(), CUSTOM_EDGES)].sort()).toEqual(["captions", "join", "overlay"])
  })

  it("the reopen of an ended run lands the newer videos on both, the older ones below, stamped", () => {
    const nodes = restoreEndedEditorRun(custom(), CUSTOM_EDGES as never, listed(RUN_2, RERUN), [])
    expect(dataOf(nodes, "join")).toMatchObject({ generatedVideoUrl: NEWER.joined, resultsRunId: "exec-2" })
    expect(urlsOf(dataOf(nodes, "join"))).toEqual([NEWER.joined, OLDER.joined])
    expect(dataOf(nodes, "overlay")).toMatchObject({ generatedVideoUrl: NEWER.carded, resultsRunId: "exec-2", layers: [{ imageUrl: LOGO }] })
    expect(urlsOf(dataOf(nodes, "overlay"))).toEqual([NEWER.carded, OLDER.carded])
    // An older run reopened after it changes neither.
    const older = { join: ran({ videoUrl: OLDER.joined }, RUN_1.completedAt), overlay: ran({ videoUrl: OLDER.carded }, RUN_1.completedAt) }
    expect(restoreEndedEditorRun(nodes, CUSTOM_EDGES as never, listed(RUN_1, older), [])).toEqual(nodes)
  })

  it("the reopen of a run still going paints both over the older run, stamped, and never over a newer one", () => {
    const graph = custom()
    const ids = ugcFinishNodeIds(graph, CUSTOM_EDGES)
    const painted = applyBackendExecutionState(graph, { join: RERUN.join, overlay: RERUN.overlay } as never, { runId: RUN_2.id, ugcFinishIds: ids })
    expect(dataOf(painted, "join")).toMatchObject({ generatedVideoUrl: NEWER.joined, resultsRunId: "exec-2" })
    expect(dataOf(painted, "overlay")).toMatchObject({ generatedVideoUrl: NEWER.carded, resultsRunId: "exec-2" })
    const newest = graph.map((n) => (n.id === "join" || n.id === "overlay" ? { ...n, data: { ...n.data, ...video("https://cdn.example/newest.mp4", { id: "exec-3", completedAt: "2026-10-05T12:00:00.000Z" }) } } : n)) as WorkflowNode[]
    const kept = applyBackendExecutionState(newest, { join: RERUN.join, overlay: RERUN.overlay } as never, { runId: RUN_2.id, ugcFinishIds: ids })
    expect(dataOf(kept, "join").generatedVideoUrl).toBe("https://cdn.example/newest.mp4")
    expect(dataOf(kept, "overlay").generatedVideoUrl).toBe("https://cdn.example/newest.mp4")
  })

  it("the poll restored after a reload stamps both with the job", () => {
    for (const [id, type, url] of [["join", "combine-videos", NEWER.joined], ["overlay", "video-overlay", NEWER.carded]] as const) {
      setGraph(custom().map((n) => (n.id === id ? { ...n, data: { ...n.data, executionStatus: "running", currentJobId: "job-1" } } : n)) as WorkflowNode[])
      act(() => applyRestoredJobCompletion(id, type, { output_data: { videoUrl: url }, completed_at: J.completedAt }, "job-1"))
      expect(dataNow(id), id).toMatchObject({ generatedVideoUrl: url, resultsRunId: "job-1", resultsRunEndedAt: J.completedAt })
    }
  })

  it("the reload's recovery lands both over the older videos, stamped", async () => {
    for (const [id, url, olderUrl] of [["join", NEWER.joined, OLDER.joined], ["overlay", NEWER.carded, OLDER.carded]] as const) {
      setGraph(custom())
      const item = { id: J.id, triggerType: "single-node", createdAt: J.createdAt, completedAt: J.completedAt, nodeStates: { [id]: { nodeId: id, jobId: J.id, status: "completed" } } }
      await reconcileCompletedSingleNodeJobs("wf-1", useWorkflowStore.getState().nodes, (nodeId, patch) => useWorkflowStore.getState().updateNodeData(nodeId, patch), {
        listCompleted: async () => ({ data: [item] }),
        fetchOutput: async () => ({ status: "completed", output_data: { videoUrl: url } }),
        nowIso: "2026-10-05T12:00:00.000Z",
        readLiveData: (nodeId) => dataNow(nodeId),
        edges: useWorkflowStore.getState().edges,
      })
      expect(dataNow(id), id).toMatchObject({ generatedVideoUrl: url, resultsRunId: "job-1", resultsRunEndedAt: J.completedAt })
      expect(urlsOf(dataNow(id))).toEqual([url, olderUrl])
    }
  })
})

describe("a canvas pass-through of a finish node is stamped as every other lane stamps it", () => {
  const PASSED = "https://cdn.example/passed-through.mp4"
  const NOW = "2026-10-05T11:00:00.000Z"
  const dataNow = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Data
  const setGraph = (nodes: WorkflowNode[], edges: unknown[] = EDGES) => act(() => useWorkflowStore.setState({ nodes, edges: edges as never, isDirty: false, isReadOnly: false }))

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  it("a one-clip join that passes its clip through, over an older run's video, is stamped now — and a replay of a run that ended before it keeps it", () => {
    setGraph(before())
    act(() => { completeAsPassThrough("join", { videoUrl: PASSED, warning: "single_input" }) })
    expect(dataNow("join")).toMatchObject({ generatedVideoUrl: PASSED, resultsRunId: `pass-through-${NOW}`, resultsRunEndedAt: NOW })
    // RUN_2 is newer than the join's old stamp, but ended before the pass-through.
    const replayed = restoreEndedEditorRun(useWorkflowStore.getState().nodes, EDGES as never, listed(RUN_2, RERUN), [])
    expect(dataOf(replayed, "join").generatedVideoUrl).toBe(PASSED)
  })

  it("so is the join that also takes an intro: the video's by its place", () => {
    const edges = [edge("intro", "join", null, "in"), ...EDGES]
    setGraph([...before(), nodeOf("intro", "upload-video", { url: "https://cdn.example/intro.mp4" })], edges)
    act(() => { completeAsPassThrough("join", { videoUrl: PASSED, warning: "single_input" }) })
    expect(dataNow("join")).toMatchObject({ resultsRunId: `pass-through-${NOW}`, resultsRunEndedAt: NOW })
  })

  it("a Combine Videos outside a UGC video is not stamped", () => {
    setGraph([nodeOf("outro", "combine-videos", { transition: "cut" })], [])
    act(() => { completeAsPassThrough("outro", { videoUrl: PASSED, warning: "single_input" }) })
    expect(dataNow("outro").generatedVideoUrl).toBe(PASSED)
    expect(dataNow("outro").resultsRunId).toBeUndefined()
  })
})
