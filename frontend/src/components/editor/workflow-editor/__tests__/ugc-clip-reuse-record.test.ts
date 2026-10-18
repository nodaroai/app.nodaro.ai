/**
 * The record a run of UGC Clip is priced by, written by the REAL canvas fan-out.
 *
 * A run of UGC Clip whose UGC Clips does not run is priced from the saved clips,
 * each clip the node's last batch made a take of at nothing (`ugcClipTicketQuote`,
 * @nodaro/render-rules). That rule reads what the batch wrote: the ticket each row
 * ran on (`__listInputs`) beside its take (`__listResults`), and on each take the job
 * that made it and the Re-render count it was sent (`ugcClipNonce`). This pins the
 * shape end to end: the real fan-out plan over UGC Clips' saved clips hands the batch
 * exactly those tickets, and the real batch writes them beside its takes, a failed
 * row "", each take naming its job and count.
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

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { planFanOut } from "@nodaro/shared/workflow"
import { ugcClipTicketQuote } from "@nodaro/render-rules"
import { executeNodeForList } from "../list-execution"
import { getListFanOutForNode } from "../node-input-resolver"

const ticket = (i: number) => JSON.stringify({ v: 1, index: i, durationSec: 8, video: { tool: "t", args: {} } })
const TICKETS = [ticket(0), ticket(1), ticket(2)]
const ctx = { userId: "user-1", projectId: undefined, isWorkflowStale: () => false } as never
const clipsData = { label: "UGC Clips", __listResults: TICKETS, ugcOutputs: { "plan-out": JSON.stringify({ v: 1, plan: {} }) } }
/** The clip route's job for a ticket (a uuid, as it makes them). */
const jobOf = (index: number) => `00000000-0000-4000-8000-00000000000${index}`
const EDGES = [{ id: "e1", source: "clips", target: "clip", sourceHandle: "clips", targetHandle: "clip" }] as unknown as WorkflowEdge[]

beforeEach(() => {
  vi.clearAllMocks()
  h.polled = {}
  h.completedAt = {}
  h.nodes = [
    { id: "clips", type: "ugc-clips", position: { x: 0, y: 0 }, data: clipsData },
    { id: "clip", type: "ugc-clip", position: { x: 0, y: 0 }, data: { label: "UGC Clip", rerender: {} } },
  ]
  // Clip 2 fails; clips 1 and 3 land.
  api.ugcClipApi.mockImplementation(async (body: { ticket: { index: number } }) => {
    if (body.ticket.index === 1) throw new Error("render failed")
    return { jobId: jobOf(body.ticket.index) }
  })
  h.polled = { [jobOf(0)]: { videoUrl: "https://cdn.example/c0.mp4", durationSec: 8, clipWarnings: [] }, [jobOf(2)]: { videoUrl: "https://cdn.example/c2.mp4", durationSec: 8, clipWarnings: [] } }
})
afterEach(() => vi.useRealTimers())

describe("the batch record the run price reads", () => {
  it("the fan-out over UGC Clips' saved clips hands the batch those very tickets, and the batch writes them beside its takes", async () => {
    const nodes = h.nodes as unknown as WorkflowNode[]
    const clip = nodes.find((n) => n.id === "clip")!
    const plan = planFanOut(getListFanOutForNode(clip, nodes, EDGES), "ugc-clip", clip.data as Record<string, unknown>)
    expect(plan?.items).toEqual(TICKETS)
    await executeNodeForList(clip, plan!.items, ctx, plan!)
    const data = h.nodes.find((n) => n.id === "clip")!.data
    expect(data.__listInputs).toEqual(TICKETS)
    expect(data.__listResults).toEqual(["https://cdn.example/c0.mp4", "", "https://cdn.example/c2.mp4"])
    // Each take names the job that made it and the Re-render count its job was sent.
    expect((data.generatedResults as Array<Record<string, unknown>>).map((r) => [r.url, r.jobId, r.ugcClipNonce]).sort()).toEqual([
      ["https://cdn.example/c0.mp4", jobOf(0), 0],
      ["https://cdn.example/c2.mp4", jobOf(2), 0],
    ])
    // The next run of UGC Clip alone expects clips 1 and 3 back (the quote checks each): only clip 2 is priced.
    expect(ugcClipTicketQuote(clipsData, data)).toEqual({
      tickets: TICKETS,
      reusedClips: [{ clip: 1, jobId: jobOf(0), nonce: 0 }, { clip: 3, jobId: jobOf(2), nonce: 0 }],
      finishes: false,
      reuseKnown: true,
    })
  })

  it("a take made after a Re-render records that count; a later press moves the count and the take is no longer claimed", async () => {
    h.nodes[1]!.data = { label: "UGC Clip", rerender: { "1": 2 } }
    const nodes = h.nodes as unknown as WorkflowNode[]
    const clip = nodes.find((n) => n.id === "clip")!
    const plan = planFanOut(getListFanOutForNode(clip, nodes, EDGES), "ugc-clip", clip.data as Record<string, unknown>)
    await executeNodeForList(clip, plan!.items, ctx, plan!)
    const data = h.nodes.find((n) => n.id === "clip")!.data
    expect(api.ugcClipApi.mock.calls.find(([b]) => (b as { ticket: { index: number } }).ticket.index === 0)![0]).toMatchObject({ nonce: 2 })
    expect(ugcClipTicketQuote(clipsData, data)?.reusedClips).toEqual([{ clip: 1, jobId: jobOf(0), nonce: 2 }, { clip: 3, jobId: jobOf(2), nonce: 0 }])
    // Pressed again (count 3), the mark undone: the take at count 2 is not what the run sends.
    expect(ugcClipTicketQuote(clipsData, { ...data, rerender: { "1": 3 } })?.reusedClips).toEqual([{ clip: 3, jobId: jobOf(2), nonce: 0 }])
  })
})
