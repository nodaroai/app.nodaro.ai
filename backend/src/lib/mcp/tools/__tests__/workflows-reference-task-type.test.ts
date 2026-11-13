import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import { buildServer, callTool } from "./_helpers.js"

/**
 * A video node's stored Seedance reference task type (`referenceTaskType`) at
 * the workflow-JSON write boundary (decided 2026-11-13): every MCP write that
 * carries a graph — create_workflow, update_workflow_json, import_workflow —
 * runs the catalog normalizer (`normalizeNodeModelParams`), which removes a
 * value no model the node runs lists (and `auto`, or any value no model
 * lists), so it can never ride hidden on a model that ignores it and come back
 * when the node is later switched to Seedance 2.5. A model that lists it keeps
 * it unchanged; a node of another type is untouched.
 */

vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
// The bundle carries no media to copy onto this install.
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

const at = { x: 0, y: 0 }
const NODES = [
  // Kling lists no task type: a stored Edit is removed.
  { id: "kling", type: "generate-video", position: at, data: { provider: "kling-3.0", prompt: "a cat", referenceTaskType: "edit" } },
  // Seedance 2.5 lists Edit: kept exactly.
  { id: "sd25", type: "generate-video", position: at, data: { provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" } },
  // `auto` is no declaration (Auto is the key left unset): removed, even on Seedance 2.5.
  { id: "auto", type: "text-to-video", position: at, data: { provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "auto" } },
  // A node of another type is untouched.
  { id: "ext", type: "extend-video", position: at, data: { provider: "seedance-2-5-extend", referenceTaskType: "edit" } },
]

/** Every `insert` / `update` argument that writes a node list, in call order. */
function nodeWrites(method: "insert" | "update"): Array<Array<{ id: string; data: Record<string, unknown> }>> {
  const out: Array<Array<{ id: string; data: Record<string, unknown> }>> = []
  for (const r of fromMock.mock.results) {
    const fn = (r.value as Record<string, ReturnType<typeof vi.fn>>)[method]
    for (const call of fn?.mock.calls ?? []) {
      const arg = call[0] as Record<string, unknown>
      if (Array.isArray(arg?.nodes)) out.push(arg.nodes as Array<{ id: string; data: Record<string, unknown> }>)
    }
  }
  return out
}

function assertWritten(written: Array<{ id: string; data: Record<string, unknown> }>) {
  const byId = new Map(written.map((n) => [n.id, n.data]))
  expect(byId.get("kling")).toStrictEqual({ provider: "kling-3.0", prompt: "a cat" })
  expect(byId.get("sd25")).toStrictEqual({ provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" })
  expect(byId.get("auto")).toStrictEqual({ provider: "seedance-2-5", prompt: "a cat" })
  expect(byId.get("ext")).toStrictEqual({ provider: "seedance-2-5-extend", referenceTaskType: "edit" })
}

beforeEach(() => {
  vi.clearAllMocks()
  fromMock.mockImplementation(() =>
    chain({ data: { id: WORKFLOW_ID, name: "Flow", created_at: "x", updated_at: "t1" }, error: null }),
  )
})

describe("a stored reference task type at the workflow-JSON write boundary", () => {
  it("create_workflow removes one no model the node runs lists, and keeps one Seedance 2.5 lists", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", { name: "Flow", nodes: NODES, edges: [] })
    expect(result.isError).toBeUndefined()
    assertWritten(nodeWrites("insert")[0]!)
  })

  it("update_workflow_json does the same, and tells the agent what it removed", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", { workflow_id: WORKFLOW_ID, nodes: NODES, edges: [] })
    expect(result.isError).toBeUndefined()
    assertWritten(nodeWrites("update")[0]!)
    const text = JSON.stringify(result.content)
    expect(text).toContain('kling (kling-3.0): referenceTaskType \\"edit\\" → removed')
    expect(text).toContain('auto (seedance-2-5): referenceTaskType \\"auto\\" → removed')
    expect(text).not.toContain("sd25 (seedance-2-5)")
  })

  it("import_workflow does the same", async () => {
    const bundle = { version: 1, exportedAt: "2026-11-13T00:00:00Z", name: "Flow", nodes: NODES, edges: [], settings: {} }
    const server = buildServer()
    registerWorkflows({ server, session: session(), fastify: Fastify() })
    const result = await callTool(server, "import_workflow", { workflow_json: JSON.stringify(bundle) })
    expect(result.isError).toBeUndefined()
    assertWritten(nodeWrites("insert")[0]!)
  })
})
