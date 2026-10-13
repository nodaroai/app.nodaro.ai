/**
 * A canvas fan-out of UGC Clip (▶ with two or more tickets) is one canvas run:
 * once a take of it lands, the node is stamped with the run on the server's
 * clock, as a single canvas clip is with its job. A reopen then tells its takes
 * from an older or a newer run's: a run that ended between the node's last stamp
 * and the batch never lands over the batch's takes; one that ended after it
 * does. A batch that landed no take leaves the node's older take, and the stamp
 * it came with, as they were.
 *
 * Runs the real fan-out (`executeNodeForList`), the real UGC Clip executor and
 * the real reopen (`restoreEndedEditorRun`); the jobs and the store are stubbed.
 * The URLs are placeholders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  nodes: [] as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>,
  polled: {} as Record<string, Record<string, unknown> | Error>,
  completedAt: {} as Record<string, string>,
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      nodes: h.nodes,
      edges: [],
      updateNodeData: (id: string, patch: Record<string, unknown>) => {
        const n = h.nodes.find((x) => x.id === id)
        if (n) n.data = { ...n.data, ...patch }
      },
    }),
  },
}))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => false }))
vi.mock("../poll-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../poll-job")>()),
  pollJobOutputWithEnd: vi.fn(async (jobId: string) => {
    const r = h.polled[jobId]
    if (r instanceof Error) throw r
    return { output: r ?? {}, completedAt: h.completedAt[jobId] }
  }),
}))
const api = vi.hoisted(() => ({ ugcClipApi: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), ...api }))
// Each iteration runs UGC Clip on its own ticket, as the editor's executor hands it one.
// (Imported when an iteration runs: ugc-execute imports list-execution, which imports this module.)
vi.mock("../execute-node", () => ({
  executeNode: async (node: never, ctx: never, prompt: string | undefined, _mediaUrl: unknown, i: number) => {
    const { executeUgcClip } = await import("../ugc-execute")
    return executeUgcClip(node, {} as never, ctx, { listIterationIndex: i, overrideInput: prompt })
  },
}))

import type { WorkflowNode } from "@/types/nodes"
import { executeNodeForList } from "../list-execution"
import { restoreEndedEditorRun } from "@/hooks/use-workflow-persistence"
import { resultsRunMark } from "../triggered-run-follow"

type Data = Record<string, unknown>
const ticket = (i: number) => JSON.stringify({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })
const ctx = { userId: "user-1", projectId: undefined, isWorkflowStale: () => false } as never

const OLDER_TAKE = "https://cdn.example/older-take.mp4"
/** The node as an earlier run (exec-1) left it: its take, stamped with that run. */
const stampedByExec1 = (): Data => ({
  rerender: {},
  executionStatus: "completed",
  generatedVideoUrl: OLDER_TAKE,
  generatedResults: [{ url: OLDER_TAKE, timestamp: "2026-10-05T09:00:40.000Z", jobId: "exec-1-job" }],
  ugcOutputs: { "video-out": OLDER_TAKE },
  ...resultsRunMark("exec-1", "2026-10-05T09:00:40.000Z"),
})

/** A run that ended while the editor was closed, rendering one take of its own. */
const endedRun = (id: string, completedAt: string, url: string) =>
  ({
    id, completedAt, kind: "run", status: "completed", triggerType: "manual",
    nodeStates: { clip: { status: "completed", startedAt: completedAt, completedAt, output: { videoUrl: url, durationSec: 12, clipWarnings: [], ugcOutputs: { "video-out": url } } } },
  }) as never

/** A canvas fan-out of the clip over two tickets, whose jobs end at 12:00 on the server's clock. */
async function fanOut(data: Data, outcome: "lands" | "fails") {
  h.nodes = [{ id: "clip", type: "ugc-clip", position: { x: 0, y: 0 }, data: { label: "UGC Clip", ...data } }]
  if (outcome === "lands") {
    api.ugcClipApi.mockResolvedValueOnce({ jobId: "batch-job-b1" }).mockResolvedValueOnce({ jobId: "batch-job-b2" })
    h.polled = { "batch-job-b1": { videoUrl: "https://cdn.example/b1.mp4", durationSec: 12, clipWarnings: [] }, "batch-job-b2": { videoUrl: "https://cdn.example/b2.mp4", durationSec: 12, clipWarnings: [] } }
    h.completedAt = { "batch-job-b1": "2026-10-05T12:00:03.000Z", "batch-job-b2": "2026-10-05T12:00:04.000Z" }
  } else {
    api.ugcClipApi.mockRejectedValue(new Error("render failed"))
  }
  await executeNodeForList(h.nodes[0] as unknown as WorkflowNode, [ticket(0), ticket(1)], ctx)
  return h.nodes.map((n) => ({ ...n })) as unknown as WorkflowNode[]
}
const clipOf = (nodes: readonly WorkflowNode[]) => nodes.find((n) => n.id === "clip")!.data as Data

beforeEach(() => {
  vi.clearAllMocks()
  h.nodes = []
  h.polled = {}
  h.completedAt = {}
  // The batch ends at 12:00:05 on this clock (the server's, as last read).
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-05T12:00:05.000Z"))
})
afterEach(() => vi.useRealTimers())

describe("a canvas fan-out of UGC Clip is one canvas run", () => {
  it("is stamped once its takes land, so a run that ended before it never lands over them on reopen", async () => {
    const after = await fanOut(stampedByExec1(), "lands")
    const batch = clipOf(after)
    expect(String(batch.resultsRunId)).toMatch(/^canvas:clip:/)
    expect(batch.resultsRunEndedAt).toBe("2026-10-05T12:00:05.000Z")
    // exec-2 ended at 10:00 — after exec-1, before the batch.
    const reopened = clipOf(restoreEndedEditorRun(after, [] as never, endedRun("exec-2", "2026-10-05T10:00:00.000Z", "https://cdn.example/exec-2.mp4"), []))
    expect(reopened.generatedVideoUrl).toBe(batch.generatedVideoUrl)
    expect(reopened.ugcOutputs).toEqual(batch.ugcOutputs)
    expect(reopened.__listResults).toEqual(["https://cdn.example/b1.mp4", "https://cdn.example/b2.mp4"])
    expect(reopened.__listResultMeta).toEqual(batch.__listResultMeta)
    expect(reopened.resultsRunId).toBe(batch.resultsRunId)
  })

  it("a run that ended after the batch still replaces it", async () => {
    const after = await fanOut(stampedByExec1(), "lands")
    const reopened = clipOf(restoreEndedEditorRun(after, [] as never, endedRun("exec-3", "2026-10-05T13:00:00.000Z", "https://cdn.example/exec-3.mp4"), []))
    expect(reopened).toMatchObject({ generatedVideoUrl: "https://cdn.example/exec-3.mp4", resultsRunId: "exec-3" })
  })

  it("a node no lane ever stamped takes the batch's stamp, and an older run then keeps off it", async () => {
    const { resultsRunId: _id, resultsRunEndedAt: _end, ...unstamped } = stampedByExec1()
    const after = await fanOut(unstamped, "lands")
    expect(String(clipOf(after).resultsRunId)).toMatch(/^canvas:clip:/)
    const reopened = clipOf(restoreEndedEditorRun(after, [] as never, endedRun("exec-2", "2026-10-05T10:00:00.000Z", "https://cdn.example/exec-2.mp4"), []))
    expect(reopened.generatedVideoUrl).toBe(clipOf(after).generatedVideoUrl)
  })

  it("a batch that landed no take leaves the stamp as it was, and a newer run still lands over the older take", async () => {
    const after = await fanOut(stampedByExec1(), "fails")
    expect(clipOf(after)).toMatchObject({ resultsRunId: "exec-1", resultsRunEndedAt: "2026-10-05T09:00:40.000Z" })
    const reopened = clipOf(restoreEndedEditorRun(after, [] as never, endedRun("exec-2", "2026-10-05T10:00:00.000Z", "https://cdn.example/exec-2.mp4"), []))
    expect(reopened).toMatchObject({ generatedVideoUrl: "https://cdn.example/exec-2.mp4", resultsRunId: "exec-2" })
  })
})
