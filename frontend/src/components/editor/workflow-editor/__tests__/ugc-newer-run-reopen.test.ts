/**
 * The newer run wins. A UGC run can end while the editor is closed; on reopen,
 * its UGC Script, UGC Clips and UGC Cards results, and UGC Clip's take, replace
 * the older ones the nodes hold, as UGC Creator's options do; so does a result
 * no lane stamped. An older run never replaces a newer result, and a run the
 * node already shows never repaints it (an edit made since stays). "Older" and
 * "newer" are read off the stamp every lane writes beside a result — which run,
 * and when it ended, on the server's clock. Every other video node keeps the
 * fill-only rule.
 *
 * The editor's half: a closed-tab re-run reopened, and the graph a Run from
 * here then starts from is pinned in `ugc-reopened-newer-run.json`. The
 * backend half (`ugc-newer-run-continue.test.ts`) runs Run from here on UGC
 * Clips and on UGC Cards over that graph: they must read the newer script and
 * the newer take.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import type { WorkflowNode } from "@/types/nodes"
import { applyBackendExecutionState, applyCompletedExecutionResults, restoreEndedEditorRun } from "@/hooks/use-workflow-persistence"
import { resultsRunMark } from "../triggered-run-follow"
import { extractNodeOutput } from "../execution-graph"
import outputs from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-run-outputs.json"
import pinned from "../../../../../../backend/src/services/workflow-engine/__tests__/fixtures/ugc-reopened-newer-run.json"

type Data = Record<string, unknown>
const O = outputs as Record<string, Data>

/** The run before: its own script, tickets and Notes (placeholders). */
const OLDER_PLAN = "{\"v\":1,\"hook\":\"An older opening\",\"beats\":[{\"line\":\"l\"}],\"closer\":{\"line\":\"c\"}}"
const OLDER = {
  "ugc-script": { ugcOutputs: { plan: OLDER_PLAN, category: "saas" }, result: { plan: { hook: "An older opening", beats: [{ line: "l" }], closer: { line: "c" } }, productCategory: "saas" } },
  "ugc-clips": { ugcOutputs: { clips: "{\"v\":1,\"index\":0,\"durationSec\":9}", "plan-out": "{\"v\":1}", transcript: "older" }, __listResults: ["{\"v\":1,\"index\":0,\"durationSec\":9}"] },
  "ugc-cards": { ugcOutputs: { layerPlan: "[]", captionPlan: "{\"v\":1}", report: "An older note." }, result: { layerPlan: "[]", captionPlan: "{\"v\":1}", report: "An older note." }, generatedText: "An older note." },
} as const

/** The take the run before rendered. */
const OLDER_TAKE = { url: "https://cdn.example/older-c0.mp4", timestamp: "2026-10-05T09:00:30.000Z", jobId: "exec-clip" }
const NEWER_TAKE = (O["ugc-clip"]!.videoUrl as string)

const RUN_1 = { id: "exec-1", completedAt: "2026-10-05T09:00:40.000Z" }
const RUN_2 = { id: "exec-2", completedAt: "2026-10-05T10:00:40.000Z" }
/** A node that ran in a run, ending at `end`. */
const ran = (output: Data, end: string): Data => ({ status: "completed", startedAt: "2026-10-05T10:00:00.000Z", completedAt: end, output })
const listed = (run: { id: string; completedAt: string }, states: Record<string, unknown>) =>
  ({ ...run, kind: "run", status: "completed", triggerType: "manual", nodeStates: states }) as never

const nodeOf = (id: string, type: string, data: Data) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string) => ({ id: `${source}-${sourceHandle}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })

const KEPT_CREATOR = JSON.parse((O["ugc-creator:kept"]!.ugcOutputs as Record<string, string>).creator!)
/** The graph as the run before left it: every UGC result stamped with that run. */
const before = (): WorkflowNode[] => [
  nodeOf("site", "text-prompt", { text: "Acme" }),
  nodeOf("script", "ugc-script", { targetDurationSec: 15, keepResult: false, executionStatus: "completed", ...OLDER["ugc-script"], ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:10.000Z") }),
  nodeOf("creator", "ugc-creator", {
    source: "sampled", gender: "woman", keepResult: true, executionStatus: "completed", result: KEPT_CREATOR,
    ugcOutputs: O["ugc-creator:kept"]!.ugcOutputs, generatedImageUrl: KEPT_CREATOR.identityImages[0], ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:15.000Z"),
  }),
  nodeOf("clips", "ugc-clips", { executionStatus: "completed", ...OLDER["ugc-clips"], ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:20.000Z") }),
  nodeOf("clip", "ugc-clip", {
    // Clip 1 was pressed for Re-render since: the re-run renders it.
    rerender: { "1": 1 }, rerenderPending: { "1": true }, executionStatus: "completed",
    generatedVideoUrl: OLDER_TAKE.url, generatedResults: [OLDER_TAKE], activeResultIndex: 0,
    ugcOutputs: { "video-out": OLDER_TAKE.url }, durationSec: 9, clipWarnings: [], ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:30.000Z"),
  }),
  nodeOf("cards", "ugc-cards", { executionStatus: "completed", ...OLDER["ugc-cards"], ...resultsRunMark(RUN_1.id, "2026-10-05T09:00:40.000Z") }),
]
const EDGES = [
  edge("site", "script", "prompt", "site"), edge("script", "creator", "category", "category"), edge("script", "clips", "plan", "plan"),
  edge("creator", "clips", "creator", "creator"), edge("clips", "clip", "clips", "clip"), edge("clips", "cards", "plan-out", "plan"),
  // UGC Cards reads the take and its notes off UGC Clip.
  edge("clip", "cards", "video-out", "video"), edge("clip", "cards", "video-out", "notes"),
]
/** A whole re-run that ended while the editor was closed. */
const RERUN_STATES = {
  script: ran(O["ugc-script"]!, "2026-10-05T10:00:10.000Z"),
  creator: ran(O["ugc-creator:kept"]!, "2026-10-05T10:00:15.000Z"),
  clips: ran(O["ugc-clips"]!, "2026-10-05T10:00:20.000Z"),
  clip: ran(O["ugc-clip"]!, "2026-10-05T10:00:30.000Z"),
  cards: ran(O["ugc-cards"]!, "2026-10-05T10:00:40.000Z"),
}
const dataOf = (nodes: readonly WorkflowNode[], id: string) => nodes.find((n) => n.id === id)!.data as Data

afterEach(() => vi.useRealTimers())

describe("the newer run wins on reopen", () => {
  it("a closed-tab re-run, then a reopen: the newer script, tickets, take and Notes replace the older ones, each stamped with the run", () => {
    // A landed take is dated when it lands: a fixed clock, for the pinned graph.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"))
    const nodes = restoreEndedEditorRun(before(), EDGES as never, listed(RUN_2, RERUN_STATES), [])
    expect(dataOf(nodes, "script")).toMatchObject({ ugcOutputs: (O["ugc-script"]!.ugcOutputs as Data), resultsRunId: "exec-2", resultsRunEndedAt: "2026-10-05T10:00:10.000Z" })
    expect(dataOf(nodes, "clips")).toMatchObject({ ugcOutputs: O["ugc-clips"]!.ugcOutputs as Data, __listResults: O["ugc-clips"]!.listResults, resultsRunId: "exec-2" })
    expect(dataOf(nodes, "cards")).toMatchObject({ ugcOutputs: O["ugc-cards"]!.ugcOutputs as Data, resultsRunId: "exec-2" })
    expect((dataOf(nodes, "cards").result as Data).report).toBe("No issues.")
    // UGC Clip: the newer take in front, the older one kept below it, handed on, and its Re-render mark gone.
    expect(dataOf(nodes, "clip")).toMatchObject({ generatedVideoUrl: NEWER_TAKE, activeResultIndex: 0, ugcOutputs: { "video-out": NEWER_TAKE }, durationSec: 12, resultsRunId: "exec-2", resultsRunEndedAt: "2026-10-05T10:00:30.000Z" })
    expect((dataOf(nodes, "clip").generatedResults as Data[]).map((r) => r.url)).toEqual([NEWER_TAKE, OLDER_TAKE.url])
    expect(dataOf(nodes, "clip").rerenderPending).toBeUndefined()
    expect(dataOf(nodes, "clip").rerender).toEqual({ "1": 1 })
    expect(extractNodeOutput(nodes.find((n) => n.id === "clip")!)).toBe(NEWER_TAKE)
    expect(
      { nodes: nodes.map(({ id, type, data }) => ({ id, type, data })), edges: EDGES },
      "update fixtures/ugc-reopened-newer-run.json, then run the backend's ugc-newer-run-continue test",
    ).toEqual(pinned)
  })

  it("an older run never replaces a newer result: not a run's, not a canvas run's", () => {
    const newer = restoreEndedEditorRun(before(), EDGES as never, listed(RUN_2, RERUN_STATES), [])
    const older = {
      script: ran(OLDER["ugc-script"] as unknown as Data, RUN_1.completedAt),
      clips: ran({ ugcOutputs: OLDER["ugc-clips"].ugcOutputs, listResults: OLDER["ugc-clips"].__listResults } as unknown as Data, RUN_1.completedAt),
      clip: ran({ videoUrl: OLDER_TAKE.url, durationSec: 9, clipWarnings: [], ugcOutputs: { "video-out": OLDER_TAKE.url } }, RUN_1.completedAt),
      cards: ran({ ugcOutputs: OLDER["ugc-cards"].ugcOutputs } as unknown as Data, RUN_1.completedAt),
    }
    expect(restoreEndedEditorRun(newer, EDGES as never, listed(RUN_1, older), [])).toEqual(newer)
    // A canvas run of UGC Clips after the run, stamped on the server's clock, outranks it too.
    const canvas = newer.map((n) => (n.id === "clips" ? { ...n, data: { ...n.data, __listResults: ["{\"v\":1,\"canvas\":1}"], ...resultsRunMark("canvas:clips:2026-10-05T11:00:00.000Z", "2026-10-05T11:00:00.000Z") } } : n)) as WorkflowNode[]
    expect(dataOf(restoreEndedEditorRun(canvas, EDGES as never, listed(RUN_2, RERUN_STATES), []), "clips").__listResults).toEqual(["{\"v\":1,\"canvas\":1}"])
  })

  it("a run the node already shows never repaints it: an edit of the script made since stays", () => {
    const newer = restoreEndedEditorRun(before(), EDGES as never, listed(RUN_2, RERUN_STATES), [])
    const edited = newer.map((n) => (n.id === "script" ? { ...n, data: { ...n.data, ugcOutputs: { plan: "{\"v\":1,\"hook\":\"edited\"}", category: "saas" }, keepResult: true } } : n)) as WorkflowNode[]
    expect(dataOf(restoreEndedEditorRun(edited, EDGES as never, listed(RUN_2, RERUN_STATES), []), "script").ugcOutputs).toEqual({ plan: "{\"v\":1,\"hook\":\"edited\"}", category: "saas" })
  })

  it("a node with no result yet is filled and stamped: UGC Clips and UGC Cards too", () => {
    const empty = [nodeOf("clips", "ugc-clips", {}), nodeOf("cards", "ugc-cards", {})]
    const nodes = applyCompletedExecutionResults(empty, { clips: RERUN_STATES.clips, cards: RERUN_STATES.cards } as never, RUN_2.completedAt, RUN_2)
    expect(dataOf(nodes, "clips")).toMatchObject({ executionStatus: "completed", resultsRunId: "exec-2", resultsRunEndedAt: "2026-10-05T10:00:20.000Z" })
    expect(dataOf(nodes, "cards")).toMatchObject({ executionStatus: "completed", resultsRunId: "exec-2" })
  })
})

describe("a run still going when the editor reopens (applyBackendExecutionState)", () => {
  it("never repaints a node showing it, or a newer run: an edit made since stays, and so does the stamp", () => {
    const showsIt = nodeOf("script", "ugc-script", { executionStatus: "completed", ugcOutputs: { plan: "{\"v\":1,\"hook\":\"edited\"}" }, ...resultsRunMark("exec-2", "2026-10-05T10:00:10.000Z") })
    expect(applyBackendExecutionState([showsIt], { script: RERUN_STATES.script } as never, { runId: "exec-2" })[0]!.data).toEqual(showsIt.data)
    const showsNewer = nodeOf("clips", "ugc-clips", { executionStatus: "completed", ugcOutputs: { clips: "{}" }, __listResults: ["{}"], ...resultsRunMark("exec-3", "2026-10-05T12:00:00.000Z") })
    expect(applyBackendExecutionState([showsNewer], { clips: RERUN_STATES.clips } as never, { runId: "exec-2" })[0]!.data).toEqual(showsNewer.data)
    // …nor marks a newer result failed because this older run's node failed.
    const failed = { status: "failed", error: "boom", completedAt: "2026-10-05T10:00:20.000Z" }
    expect(applyBackendExecutionState([showsNewer], { clips: failed } as never, { runId: "exec-2" })[0]!.data).toEqual(showsNewer.data)
  })

  it("a state whose end cannot be read still paints an older result, as this lane always did", () => {
    const older = nodeOf("cards", "ugc-cards", { executionStatus: "completed", ...OLDER["ugc-cards"], ...resultsRunMark(RUN_1.id, RUN_1.completedAt) })
    const { completedAt: _end, ...noEnd } = RERUN_STATES.cards as Data
    const data = applyBackendExecutionState([older], { cards: noEnd } as never, { runId: "exec-2" })[0]!.data as Data
    expect(data).toMatchObject({ ugcOutputs: O["ugc-cards"]!.ugcOutputs as Data, resultsRunId: "exec-2" })
  })

  it("an older result is painted over, as before", () => {
    const older = nodeOf("cards", "ugc-cards", { executionStatus: "completed", ...OLDER["ugc-cards"], ...resultsRunMark(RUN_1.id, RUN_1.completedAt) })
    const data = applyBackendExecutionState([older], { cards: RERUN_STATES.cards } as never, { runId: "exec-2" })[0]!.data as Data
    expect(data).toMatchObject({ ugcOutputs: O["ugc-cards"]!.ugcOutputs as Data, resultsRunId: "exec-2" })
  })
})

describe("UGC Clip's take on reopen", () => {
  const clipWith = (data: Data) => nodeOf("clip", "ugc-clip", { rerender: {}, ...data })
  const NEWER_STATE = { clip: RERUN_STATES.clip }

  it("a take no lane stamped gives way to the stamped run's", () => {
    const unstamped = clipWith({ executionStatus: "completed", generatedVideoUrl: OLDER_TAKE.url, generatedResults: [OLDER_TAKE], ugcOutputs: { "video-out": OLDER_TAKE.url } })
    const data = applyCompletedExecutionResults([unstamped], NEWER_STATE as never, RUN_2.completedAt, RUN_2)[0]!.data as Data
    expect(data).toMatchObject({ generatedVideoUrl: NEWER_TAKE, resultsRunId: "exec-2" })
  })

  it("a stamped take whose end cannot be read is kept: it may be the newer one", () => {
    const noEnd = clipWith({ executionStatus: "completed", generatedVideoUrl: OLDER_TAKE.url, generatedResults: [OLDER_TAKE], ugcOutputs: { "video-out": OLDER_TAKE.url }, resultsRunId: "exec-9" })
    expect(applyCompletedExecutionResults([noEnd], NEWER_STATE as never, RUN_2.completedAt, RUN_2)[0]!.data).toEqual(noEnd.data)
  })

  it("the run it already shows never repaints it: a take picked since stays", () => {
    const shows = clipWith({ executionStatus: "completed", generatedVideoUrl: OLDER_TAKE.url, generatedResults: [{ url: NEWER_TAKE }, OLDER_TAKE], activeResultIndex: 1,
      ugcOutputs: { "video-out": NEWER_TAKE }, ...resultsRunMark(RUN_2.id, RUN_2.completedAt) })
    expect(applyCompletedExecutionResults([shows], NEWER_STATE as never, RUN_2.completedAt, RUN_2)[0]!.data).toEqual(shows.data)
  })

  it("a run still going when the editor reopens never repaints a take from this run or a newer one; it paints an older one", () => {
    const newer = clipWith({ executionStatus: "completed", generatedVideoUrl: "https://cdn.example/newest.mp4", generatedResults: [{ url: "https://cdn.example/newest.mp4" }],
      ugcOutputs: { "video-out": "https://cdn.example/newest.mp4" }, ...resultsRunMark("exec-3", "2026-10-05T12:00:00.000Z") })
    expect(applyBackendExecutionState([newer], NEWER_STATE as never, { runId: RUN_2.id })[0]!.data).toEqual(newer.data)
    const older = clipWith({ executionStatus: "completed", generatedVideoUrl: OLDER_TAKE.url, generatedResults: [OLDER_TAKE], ugcOutputs: { "video-out": OLDER_TAKE.url }, ...resultsRunMark(RUN_1.id, RUN_1.completedAt) })
    expect(applyBackendExecutionState([older], NEWER_STATE as never, { runId: RUN_2.id })[0]!.data).toMatchObject({ generatedVideoUrl: NEWER_TAKE, resultsRunId: "exec-2" })
  })

  it("a plain Generate Video node keeps the fill-only rule: its older video stays, an empty one is filled", () => {
    const video = (data: Data) => nodeOf("vid", "generate-video", { provider: "p", ...data })
    const state = { vid: ran({ videoUrl: NEWER_TAKE }, RUN_2.completedAt) }
    const holds = video({ executionStatus: "completed", generatedVideoUrl: OLDER_TAKE.url, generatedResults: [OLDER_TAKE], activeResultIndex: 0, ...resultsRunMark(RUN_1.id, RUN_1.completedAt) })
    expect(applyCompletedExecutionResults([holds], state as never, RUN_2.completedAt, RUN_2)[0]!.data).toEqual(holds.data)
    expect(restoreEndedEditorRun([holds], [] as never, listed(RUN_2, state), [])[0]!.data).toEqual(holds.data)
    const unstamped = video({ executionStatus: "completed", generatedVideoUrl: OLDER_TAKE.url, generatedResults: [OLDER_TAKE] })
    expect(applyCompletedExecutionResults([unstamped], state as never, RUN_2.completedAt, RUN_2)[0]!.data).toEqual(unstamped.data)
    const empty = video({})
    expect(applyCompletedExecutionResults([empty], state as never, RUN_2.completedAt, RUN_2)[0]!.data).toMatchObject({ executionStatus: "completed", generatedVideoUrl: NEWER_TAKE })
  })
})
