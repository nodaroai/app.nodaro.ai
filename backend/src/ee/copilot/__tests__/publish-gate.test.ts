/**
 * The exemption has to be REACHABLE, and reach nothing else.
 *
 * A toggle nothing reads is not a feature — the deny-list change alone was
 * exactly that, and this pins the wiring that made it real: the thread carries
 * the choice, the writer honours it, and everything the choice does NOT cover
 * (a webhook, a destination field) stays refused either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const { fromMock, rpcMock, graphState } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  graphState: { nodes: [] as unknown[], edges: [] as unknown[], version: 1 },
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

const { runEditWorkflow, EditRejected } = await import("../tools/edit-workflow.js")
const { proposeRun } = await import("../tools/run-and-execution.js")
import type { CopilotToolContext } from "../tools/types.js"

const emitted: Array<{ type: string; data: Record<string, unknown> }> = []

function ctxWith(allowPublishing: boolean): CopilotToolContext {
  return {
    userId: "aaaaaaaa-0000-4000-8000-000000000001",
    workflowId: "wf1",
    projectId: "p1",
    threadId: "t1",
    turnId: "turn1",
    allowPublishing,
    userLinks: new Set<string>(),
    fastify: {} as never,
    emit: (event: { type: string; data: Record<string, unknown> }) => emitted.push(event),
  } as CopilotToolContext
}

beforeEach(() => {
  emitted.length = 0
  graphState.nodes = []
  graphState.edges = []
  graphState.version = 1
  fromMock.mockReset()
  fromMock.mockImplementation(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { nodes: graphState.nodes, edges: graphState.edges, version: graphState.version },
      error: null,
    }),
  }))
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [{ ok: true, version: 2, updated_at: "2026-08-25T10:00:00Z" }], error: null })
})

const TELEGRAM = { id: "post", type: "telegram-post", data: { caption: "hello" } }

describe("the toggle is actually wired to the writer", () => {
  it("refuses a publisher while it is off", async () => {
    await expect(
      runEditWorkflow(ctxWith(false), { note: "post it", upsertNodes: [TELEGRAM] }),
    ).rejects.toBeInstanceOf(EditRejected)
  })

  it("writes one while it is on", async () => {
    await runEditWorkflow(ctxWith(true), { note: "post it", upsertNodes: [TELEGRAM] })

    const persisted = rpcMock.mock.calls.at(-1)![1].p_upsert_nodes
    expect(persisted[0].type).toBe("telegram-post")
  })

  it("still refuses a webhook, toggle or no toggle", async () => {
    // That one names an arbitrary host in node data. No per-thread choice
    // reaches it, because the harm is not a post the user dislikes — it is
    // their media arriving at a server they never chose.
    await expect(
      runEditWorkflow(ctxWith(true), {
        note: "x",
        upsertNodes: [{ id: "hook", type: "webhook-output", data: {} }],
      }),
    ).rejects.toBeInstanceOf(EditRejected)
  })

  it("still refuses to write the destination, even with the toggle on", async () => {
    await expect(
      runEditWorkflow(ctxWith(true), {
        note: "x",
        upsertNodes: [{ id: "post", type: "telegram-post", data: { chatId: "@someone-elses-channel" } }],
      }),
    ).rejects.toBeInstanceOf(EditRejected)
  })
})

describe("the default is off, and stays off when the column is missing", () => {
  it("off when the thread says nothing", async () => {
    // Two ways a thread says nothing: it predates the column, or the read was
    // taken on staging before the migration was promoted. Both mean OFF — an
    // exemption that switches itself on when a column is absent is not an
    // exemption.
    const { threadAllowsPublishing } = await import("../store.js")

    expect(threadAllowsPublishing({ allow_publishing: undefined })).toBe(false)
    expect(threadAllowsPublishing({} as { allow_publishing?: boolean })).toBe(false)
  })

  it("off when it says false, on only when it says true", async () => {
    const { threadAllowsPublishing } = await import("../store.js")

    expect(threadAllowsPublishing({ allow_publishing: false })).toBe(false)
    expect(threadAllowsPublishing({ allow_publishing: true })).toBe(true)
  })
})
