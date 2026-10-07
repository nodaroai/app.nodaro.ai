import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * The edge write boundary. An MCP client takes handle names from docs that
 * can lag the canvas, and often sends edges without ids — so every write
 * that carries a graph (`create_workflow`, `update_workflow_json`,
 * `import_workflow`) rewires recorded legacy names, gives ids, reports both,
 * warns about a handle the node does not declare (stored as sent), and
 * refuses a structurally broken graph before anything is written.
 */

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../media-portability.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../media-portability.js")>()
  return {
    ...actual,
    rehostForeignMedia: async (
      nodes: readonly unknown[],
      userId: string,
      opts: { assets?: unknown; settings?: Record<string, unknown> } = {},
    ) => {
      const { report } = await actual.rehostForeignMedia([], userId)
      return {
        nodes: [...nodes],
        ...(opts.assets ? { assets: opts.assets } : {}),
        ...(opts.settings ? { settings: opts.settings } : {}),
        report,
      }
    },
  }
})

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")
const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001"

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "lt", "in", "order", "limit", "insert", "delete", "update"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

function session(): McpSession {
  const s = newSession({ userId: "u1", scopes: ["workflows:read", "workflows:write"], clientName: "Claude" })
  s.mcpProjectId = MCP_PROJECT_ID
  return s
}

const NODES = [
  { id: "p", type: "text-prompt", position: { x: 0, y: 0 }, data: { text: "News" } },
  { id: "c", type: "combine-text", position: { x: 300, y: 0 }, data: {} },
  { id: "l", type: "llm-chat", position: { x: 600, y: 0 }, data: { systemPrompt: "Rewrite" } },
]
/** A legacy target name on each edge, no ids on either — the shape an agent writes from stale docs. */
const LEGACY_EDGES = [
  { source: "p", sourceHandle: "prompt", target: "c", targetHandle: "in" },
  { source: "c", sourceHandle: "text", target: "l", targetHandle: "in" },
]
const STORED_EDGES = [
  { id: "e-p-prompt-c-text", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "text" },
  { id: "e-c-text-l-prompt", source: "c", sourceHandle: "text", target: "l", targetHandle: "prompt" },
]

/** The argument of the first `insert` / `update` call across every `from()` builder, or null. */
function firstCall(method: "insert" | "update"): Record<string, unknown> | null {
  for (const r of fromMock.mock.results) {
    const fn = (r.value as Record<string, ReturnType<typeof vi.fn>>)[method]
    if (fn?.mock.calls.length) return fn.mock.calls[0]![0] as Record<string, unknown>
  }
  return null
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("\n")
}

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() =>
    chain({ data: { id: WORKFLOW_ID, name: "Flow", created_at: "x", updated_at: "t1", version: 2 }, error: null }),
  )
})

describe("MCP workflow writes normalize their edges", () => {
  it("create_workflow: legacy names rewired, ids given, both reported — and the stored edges are the normalized ones", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", { name: "Flow", nodes: NODES, edges: LEGACY_EDGES })
    expect(result.isError).toBeUndefined()
    expect(firstCall("insert")!.edges).toEqual(STORED_EDGES)
    const structured = result.structuredContent as { edgeAdjustments?: unknown[]; edgeWarnings?: unknown }
    expect(structured.edgeAdjustments).toHaveLength(4)
    expect(structured.edgeWarnings).toBeUndefined()
    expect(text(result)).toContain("Adjusted 4 edge field(s)")
    expect(text(result)).toContain('targetHandle "in" → "text"')
  })

  it("create_workflow: a handle the node does not declare is stored as sent and warned about", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const odd = [{ id: "e1", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "words" }]
    const result = await callTool(server, "create_workflow", { name: "Flow", nodes: NODES, edges: odd })
    expect(result.isError).toBeUndefined()
    expect(firstCall("insert")!.edges).toEqual(odd)
    const structured = result.structuredContent as { edgeAdjustments?: unknown; edgeWarnings?: string[] }
    expect(structured.edgeAdjustments).toBeUndefined()
    expect(structured.edgeWarnings).toHaveLength(1)
    expect(text(result)).toContain("Edge warnings:")
    expect(text(result)).toContain('"words" is not an input of combine-text')
  })

  it("create_workflow: a duplicate edge id refuses the write — nothing is inserted", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", {
      name: "Flow",
      nodes: NODES,
      edges: [{ id: "same", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "text" }, { id: "same", source: "c", sourceHandle: "text", target: "l", targetHandle: "prompt" }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("nothing was written")
    expect(text(result)).toContain("duplicate edge id")
    expect(firstCall("insert")).toBeNull()
  })

  it("create_workflow: an edge naming no node or looping on itself is dropped with a warning; the rest is stored", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", {
      name: "Flow",
      nodes: NODES,
      edges: [{ id: "e1", source: "p", target: "ghost" }, { id: "e2", source: "c", target: "c" }, STORED_EDGES[0]],
    })
    expect(result.isError).toBeUndefined()
    expect(firstCall("insert")!.edges).toEqual([STORED_EDGES[0]])
    const structured = result.structuredContent as { edgeWarnings?: string[] }
    expect(structured.edgeWarnings).toHaveLength(2)
    expect(text(result)).toContain('target node "ghost" does not exist — dropped')
    expect(text(result)).toContain("cannot connect a node to itself — dropped")
  })

  it("create_workflow: a clean graph is stored as written, with nothing to report", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", { name: "Flow", nodes: NODES, edges: STORED_EDGES })
    expect(result.isError).toBeUndefined()
    expect(firstCall("insert")!.edges).toEqual(STORED_EDGES)
    expect(result.structuredContent).toEqual({ id: WORKFLOW_ID, name: "Flow" })
    expect(text(result)).not.toContain("Adjusted")
  })

  it("update_workflow_json does the same, beside the node adjustments", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: NODES, edges: LEGACY_EDGES })
    expect(result.isError).toBeUndefined()
    expect(firstCall("update")!.edges).toEqual(STORED_EDGES)
    expect((result.structuredContent as { edgeAdjustments?: unknown[] }).edgeAdjustments).toHaveLength(4)
    expect(text(result)).toContain("Adjusted 4 edge field(s)")
  })

  it("update_workflow_json refuses a broken graph before the update", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      nodes: NODES,
      edges: [{ id: "same", source: "p", target: "c" }, { id: "same", source: "c", target: "l" }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("duplicate edge id")
    expect(firstCall("update")).toBeNull()
  })

  it("update_workflow_json (delta form) relays what the route normalised and warned about", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.patch("/v1/workflows/:id", async (req) => {
      received = req.body as Record<string, unknown>
      return {
        data: {
          id: WORKFLOW_ID,
          version: 3,
          updatedAt: "t3",
          edgeAdjustments: [{ edgeId: "e1", field: "targetHandle", from: "in", to: "text", reason: "alias" }],
          edgeWarnings: ['edge "e2": "words" is not a declared input of combine-text (declared: text) — stored as sent'],
        },
      }
    })
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      delta: { base_version: 2, upsert_edges: [{ id: "e1", source: "p", sourceHandle: "prompt", target: "c", targetHandle: "in" }] },
    })
    expect(result.isError).toBeUndefined()
    expect((received?.delta as { upsertEdges?: unknown[] }).upsertEdges).toHaveLength(1)
    const structured = result.structuredContent as { version?: number; edgeAdjustments?: unknown[]; edgeWarnings?: string[] }
    expect(structured.version).toBe(3)
    expect(structured.edgeAdjustments).toHaveLength(1)
    expect(structured.edgeWarnings).toHaveLength(1)
    expect(text(result)).toContain("Adjusted 1 edge field(s)")
    expect(text(result)).toContain("Edge warnings:")
  })

  it("import_workflow does the same on the bundle's edges", async () => {
    const bundle = { version: 1, exportedAt: "2026-10-06T00:00:00Z", name: "Flow", nodes: NODES, edges: LEGACY_EDGES, settings: {} }
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "import_workflow", { workflow_json: JSON.stringify(bundle) })
    expect(result.isError).toBeUndefined()
    expect(firstCall("insert")!.edges).toEqual(STORED_EDGES)
    expect((result.structuredContent as { edgeAdjustments?: unknown[] }).edgeAdjustments).toHaveLength(4)
    expect(text(result)).toContain("Adjusted 4 edge field(s)")
  })
})
