/**
 * The id-keyed DELTA save — PATCH /v1/workflows/:id with `delta`, the form MCP
 * `update_workflow_json` forwards verbatim and the one agents are steered
 * toward — runs its edges through the same normalizer as every other
 * server-side write (lib/workflow-edge-normalization.ts): a recorded legacy
 * handle name is rewired against the node types the delta leaves behind
 * (stored nodes minus deletes plus upserts), an edge naming no node is dropped
 * with a warning, a duplicate id refuses the write before the RPC, and what
 * changed rides back on the response. A delta without edges pays no read. A
 * base the row has moved past is a 409 before any content-dependent answer,
 * and access is judged on the read first, so a caller below `edit` learns
 * nothing about the stored node ids.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "combine-text", category: "processing" },
    { type: "llm-chat", category: "ai" },
  ],
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const STRANGER = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000030"
const STORED_NODES = [
  { id: "p", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Prompt", text: "News" } },
  { id: "c", type: "combine-text", position: { x: 300, y: 0 }, data: { label: "Combine" } },
]
const GRAPH_SELECT = "id, user_id, workspace_id, visibility, share_token, is_presentation_enabled, nodes, version, updated_at"

/** Serves the stored row; records every `select` on `workflows`. */
function serve() {
  const workflowReads: string[] = []
  const row = {
    id: WORKFLOW_ID, project_id: null, user_id: OWNER, workspace_id: null, visibility: "private",
    nodes: STORED_NODES, edges: [], settings: {}, version: 1, updated_at: "2026-10-06T00:00:00.000Z",
    share_token: null, is_presentation_enabled: false,
  }
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["eq", "is", "in", "order", "limit", "upsert", "delete", "insert", "update"]) chain[m] = vi.fn(() => chain)
    chain.select = vi.fn((cols?: string) => {
      if (table === "workflows") workflowReads.push(String(cols))
      return chain
    })
    const result = table === "workflows" ? { data: row, error: null } : { data: null, error: null }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 0, error: null })
    return chain
  }) as never)
  vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, version: 2, updated_at: "2026-10-06T00:00:01.000Z" }, error: null } as never)
  return { workflowReads }
}

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

const deltaSave = (delta: Record<string, unknown>, as = OWNER) =>
  app.inject({ method: "PATCH", url: `/v1/workflows/${WORKFLOW_ID}`, headers: { "x-user-id": as }, payload: { delta: { baseVersion: 1, ...delta } } })

const rpcArgs = () => vi.mocked(supabase.rpc).mock.calls[0]![1] as { p_upsert_edges: Array<Record<string, unknown>> }

describe("PATCH /v1/workflows/:id — delta — edges normalised", () => {
  it("rewires a legacy handle name against the stored node types and reports it", async () => {
    const { workflowReads } = serve()
    const res = await deltaSave({ upsertEdges: [{ id: "e1", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "in" }] })
    expect(res.statusCode).toBe(200)
    expect(workflowReads).toContain(GRAPH_SELECT)
    expect(rpcArgs().p_upsert_edges).toEqual([{ id: "e1", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "text" }])
    const body = res.json() as { data: { version: number; edgeAdjustments?: unknown[]; edgeWarnings?: unknown } }
    expect(body.data.version).toBe(2)
    expect(body.data.edgeAdjustments).toEqual([{ edgeId: "e1", field: "targetHandle", from: "in", to: "text", reason: "alias" }])
    expect(body.data.edgeWarnings).toBeUndefined()
  })

  it("sees a node the SAME delta upserts; an edge into a stored node it deletes is dropped with a warning", async () => {
    serve()
    const llm = { id: "l", type: "llm-chat", position: { x: 600, y: 0 }, data: { label: "Writer" } }
    const res = await deltaSave({
      upsertNodes: [llm],
      deleteNodeIds: ["c"],
      upsertEdges: [
        { id: "e1", source: "p", sourceHandle: "prompt", target: "l", targetHandle: "in" },
        { id: "e2", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "text" },
      ],
    })
    expect(res.statusCode).toBe(200)
    expect(rpcArgs().p_upsert_edges).toEqual([{ id: "e1", source: "p", sourceHandle: "prompt", target: "l", targetHandle: "prompt" }])
    const body = res.json() as { data: { edgeWarnings?: string[] } }
    expect(body.data.edgeWarnings).toHaveLength(1)
    expect(body.data.edgeWarnings![0]).toContain('target node "c" does not exist — dropped')
  })

  it("a duplicate edge id is refused by the delta protocol's own id check, before the RPC", async () => {
    serve()
    const res = await deltaSave({
      upsertEdges: [
        { id: "same", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "text" },
        { id: "same", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "text" },
      ],
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe("validation_error")
    expect(body.error.message).toContain("delta ids must be unique")
    expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled()
  })

  it("a base the row has moved past is a 409 workflow_conflict, before any content-dependent answer", async () => {
    serve()
    const res = await deltaSave({ baseVersion: 2, upsertEdges: [{ id: "e1", source: "p", sourceHandle: "prompt", target: "ghost", targetHandle: "in" }] })
    expect(res.statusCode).toBe(409)
    const body = res.json() as { error: { code: string; currentVersion?: number } }
    expect(body.error.code).toBe("workflow_conflict")
    expect(body.error.currentVersion).toBe(1)
    expect(vi.mocked(supabase.rpc)).not.toHaveBeenCalled()
  })

  it("llm-chat's legacy `in` from a text node lands on prompt", async () => {
    serve()
    const llm = { id: "l", type: "llm-chat", position: { x: 600, y: 0 }, data: { label: "Writer" } }
    const res = await deltaSave({ upsertNodes: [llm], upsertEdges: [{ id: "e1", source: "p", sourceHandle: "prompt", target: "l", targetHandle: "in" }] })
    expect(res.statusCode).toBe(200)
    expect(rpcArgs().p_upsert_edges[0]!.targetHandle).toBe("prompt")
  })

  it("a handle the node does not declare is stored as sent and reported as a warning", async () => {
    serve()
    const edge = { id: "e1", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "words" }
    const res = await deltaSave({ upsertEdges: [edge] })
    expect(res.statusCode).toBe(200)
    expect(rpcArgs().p_upsert_edges).toEqual([edge])
    const body = res.json() as { data: { edgeAdjustments?: unknown; edgeWarnings?: string[] } }
    expect(body.data.edgeAdjustments).toBeUndefined()
    expect(body.data.edgeWarnings).toHaveLength(1)
    expect(body.data.edgeWarnings![0]).toContain('"words" is not an input of combine-text')
  })

  it("a delta without edges pays no read of the graph", async () => {
    const { workflowReads } = serve()
    const res = await deltaSave({ upsertNodes: [{ id: "t", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "T", text: "x" } }] })
    expect(res.statusCode).toBe(200)
    expect(workflowReads).not.toContain(GRAPH_SELECT)
  })

  it("a caller below `edit` gets no content-dependent answer: the delta reaches the RPC as sent", async () => {
    serve()
    const dangling = { id: "e1", source: "p", target: "ghost" }
    const res = await deltaSave({ upsertEdges: [dangling] }, STRANGER)
    expect(res.statusCode).toBe(200)
    expect(rpcArgs().p_upsert_edges).toEqual([dangling])
  })
})
