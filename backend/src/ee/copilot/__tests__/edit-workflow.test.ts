/**
 * `edit_workflow` is the only write the model has. These pin the guards that
 * make that safe (denied types, locked URLs, id rules, caps, sub-workflow and
 * edge validation), the write pipeline's order, and the CAS rebase.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const { fromMock, rpcMock, graphState } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  graphState: { nodes: [] as unknown[], edges: [] as unknown[], version: 1 },
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const { runEditWorkflow, EditRejected } = await import("../tools/edit-workflow.js")
import type { CopilotToolContext } from "../tools/types.js"

const emitted: Array<{ type: string; data: Record<string, unknown> }> = []
const ctx = {
  userId: "u1",
  workflowId: "wf1",
  projectId: "p1",
  threadId: "t1",
  turnId: "turn1",
  fastify: {} as never,
  emit: (event: { type: string; data: Record<string, unknown> }) => emitted.push(event),
} as CopilotToolContext

function graphChain() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { nodes: graphState.nodes, edges: graphState.edges, version: graphState.version },
      error: null,
    }),
  }
}

beforeEach(() => {
  emitted.length = 0
  graphState.nodes = []
  graphState.edges = []
  graphState.version = 1
  fromMock.mockReset()
  fromMock.mockImplementation(() => graphChain())
  rpcMock.mockReset()
  rpcMock.mockResolvedValue({ data: [{ ok: true, version: 2, updated_at: "2026-08-23T10:00:00Z" }], error: null })
})

describe("edit_workflow — guards", () => {
  it("refuses a node type that sends data out of the platform", async () => {
    await expect(
      runEditWorkflow(ctx, {
        note: "hook it up",
        upsertNodes: [{ id: "hook", type: "webhook-output", data: {} }],
      }),
    ).rejects.toBeInstanceOf(EditRejected)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it("refuses a URL the model introduces", async () => {
    await expect(
      runEditWorkflow(ctx, {
        note: "add an image",
        upsertNodes: [{ id: "img", type: "upload-image", data: { imageUrl: "https://evil.test/x.png" } }],
      }),
    ).rejects.toThrow(/imageUrl/)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it("allows preserving a URL the user already put on the node", async () => {
    graphState.nodes = [{ id: "img", type: "upload-image", data: { imageUrl: "https://mine.test/x.png" } }]
    await runEditWorkflow(ctx, {
      note: "relabel",
      patchNodes: [{ id: "img", data: { label: "Hero shot" } }],
    })
    expect(rpcMock).toHaveBeenCalledOnce()
  })

  it("rejects an unusable node id and suggests a real type for a typo", async () => {
    await expect(
      runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "Bad Id!", type: "text-prompt", data: {} }] }),
    ).rejects.toThrow(/not allowed/)
    await expect(
      runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "n1", type: "generate-imag", data: {} }] }),
    ).rejects.toThrow(/generate-image/)
  })

  it("blocks a structurally broken edge", async () => {
    await expect(
      runEditWorkflow(ctx, {
        note: "wire",
        upsertEdges: [{ source: "ghost", target: "alsoGhost" }],
      }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe("edit_workflow — write pipeline", () => {
  it("strips run state, adds a position, and reports what changed", async () => {
    const result = await runEditWorkflow(ctx, {
      note: "add a prompt",
      upsertNodes: [
        { id: "p1", type: "text-prompt", data: { prompt: "a cat", executionStatus: "completed", currentJobId: "j1" } },
      ],
    })

    const args = rpcMock.mock.calls[0]![1] as { p_upsert_nodes: Array<{ id: string; position?: unknown; data: Record<string, unknown> }> }
    const node = args.p_upsert_nodes[0]!
    expect(node.data.prompt).toBe("a cat")
    expect(node.data.currentJobId).toBeUndefined()
    expect(node.position).toBeDefined()

    expect(result.version).toBe(2)
    expect(result.addedNodeIds).toEqual(["p1"])
    expect(result.addedNodeTypes).toEqual(["text-prompt"])
    expect(emitted[0]?.type).toBe("workflow_updated")
  })

  it("deletes the edges of a deleted node so the graph never dangles", async () => {
    graphState.nodes = [
      { id: "a", type: "text-prompt", data: {} },
      { id: "b", type: "generate-image", data: {} },
    ]
    graphState.edges = [{ id: "e-a-b", source: "a", target: "b" }]

    await runEditWorkflow(ctx, { note: "drop a", deleteNodeIds: ["a"] })
    const args = rpcMock.mock.calls[0]![1] as { p_delete_edge_ids: string[] }
    expect(args.p_delete_edge_ids).toContain("e-a-b")
  })

  it("merges patchNodes onto the CURRENT node, not a stale copy", async () => {
    graphState.nodes = [{ id: "p1", type: "text-prompt", data: { prompt: "old", label: "Keep me" } }]
    await runEditWorkflow(ctx, { note: "edit", patchNodes: [{ id: "p1", data: { prompt: "new" } }] })
    const args = rpcMock.mock.calls[0]![1] as { p_upsert_nodes: Array<{ data: Record<string, unknown> }> }
    expect(args.p_upsert_nodes[0]!.data).toMatchObject({ prompt: "new", label: "Keep me" })
  })

  it("rebases once on a version conflict, then gives up with a re-read instruction", async () => {
    rpcMock.mockResolvedValue({ data: [{ ok: false, version: 9, updated_at: "…" }], error: null })
    await expect(runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "p1", type: "text-prompt", data: {} }] })).rejects.toThrow(
      /changed while I was editing/,
    )
    expect(rpcMock).toHaveBeenCalledTimes(2)
  })

  it("passes the caller's user id to the RPC (a thread binding is not authorization)", async () => {
    await runEditWorkflow(ctx, { note: "x", upsertNodes: [{ id: "p1", type: "text-prompt", data: {} }] })
    const args = rpcMock.mock.calls[0]![1] as { p_user_id: string; p_base_version: number }
    expect(args.p_user_id).toBe("u1")
    expect(args.p_base_version).toBe(1)
  })

  it("refuses to grow the graph past the node cap", async () => {
    graphState.nodes = Array.from({ length: 250 }, (_, i) => ({ id: `n${i}`, type: "text-prompt", data: {} }))
    await expect(
      runEditWorkflow(ctx, { note: "one more", upsertNodes: [{ id: "extra", type: "text-prompt", data: {} }] }),
    ).rejects.toThrow(/limit is 250/)
  })
})
