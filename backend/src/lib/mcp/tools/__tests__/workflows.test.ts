import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { McpSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")

const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>

const MCP_PROJECT_ID = "11111111-1111-4111-8111-111111111111"
const WORKFLOW_ID = "00000000-0000-0000-0000-000000000001"
const OTHER_WORKFLOW_ID = "00000000-0000-0000-0000-000000000002"

beforeEach(() => {
  vi.clearAllMocks()
})

/**
 * A maximally-permissive chainable supabase stub. Every builder method returns
 * `this`; terminal methods (`maybeSingle`/`single`) resolve `result`, and the
 * thenable resolves `result` too (for `select(...).eq(...).order(...).limit(...)`
 * which awaits the builder directly).
 */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {}
  for (const m of ["select", "eq", "lt", "in", "order", "limit", "insert", "delete", "update"]) {
    obj[m] = vi.fn(() => obj)
  }
  obj.maybeSingle = vi.fn().mockResolvedValue(result)
  obj.single = vi.fn().mockResolvedValue(result)
  // Make the builder awaitable for the non-single query path.
  obj.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return obj
}

/** Session with the mcp-project id pre-cached so `ensureMcpProject` skips the DB. */
function mcpSession(scopes: Scope[]): McpSession {
  const s = newSession({ userId: "u1", scopes, clientName: "Claude" })
  s.mcpProjectId = MCP_PROJECT_ID
  return s
}

const ALL: Scope[] = ["workflows:read", "workflows:write", "workflows:execute"]

// ── list_workflows ──────────────────────────────────────────────────────────

describe("list_workflows tool", () => {
  it("returns workflows scoped to the mcp project", async () => {
    fromMock.mockReturnValue(
      chain({
        data: [
          {
            id: "w1",
            project_id: MCP_PROJECT_ID,
            name: "My Flow",
            created_at: "2026-04-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "list_workflows", {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"w1"')
  })

  it("does NOT register without workflows:read scope", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession([]), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_workflows")
  })
})

// ── get_workflow ────────────────────────────────────────────────────────────

describe("get_workflow tool", () => {
  it("returns metadata when the workflow is in the mcp project", async () => {
    fromMock.mockReturnValue(
      chain({ data: { id: WORKFLOW_ID, project_id: MCP_PROJECT_ID, name: "Flow" }, error: null }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "get_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"Flow"')
  })

  it("rejects a workflow that lives in another project", async () => {
    fromMock.mockReturnValue(
      chain({ data: { id: WORKFLOW_ID, project_id: "some-other-project", name: "Flow" }, error: null }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "get_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("mcp project")
  })
})

// ── get_workflow_json ───────────────────────────────────────────────────────

describe("get_workflow_json tool", () => {
  it("returns nodes, edges, settings and updated_at", async () => {
    fromMock.mockReturnValue(
      chain({
        data: {
          id: WORKFLOW_ID,
          project_id: MCP_PROJECT_ID,
          name: "Flow",
          nodes: [{ id: "n1", type: "text-prompt", data: {} }],
          edges: [{ source: "n1", target: "n2" }],
          settings: { foo: "bar" },
          updated_at: "2026-04-02T00:00:00Z",
        },
        error: null,
      }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "get_workflow_json", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>
    expect(payload.name).toBe("Flow")
    expect(payload.nodes).toHaveLength(1)
    expect(payload.edges).toHaveLength(1)
    expect(payload.settings).toEqual({ foo: "bar" })
    expect(payload.updated_at).toBe("2026-04-02T00:00:00Z")
  })

  it("errors when the workflow is not in the mcp project", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "get_workflow_json", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBe(true)
  })
})

// ── create_workflow ─────────────────────────────────────────────────────────

describe("create_workflow tool", () => {
  it("inserts into the mcp project and returns the new id", async () => {
    fromMock.mockReturnValue(
      chain({ data: { id: WORKFLOW_ID, name: "New Flow", created_at: "x", updated_at: "x" }, error: null }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "create_workflow", { name: "New Flow" })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.id).toBe(WORKFLOW_ID)
    // The INSERT payload must carry project_id = the mcp project.
    const insertCalls = fromMock.mock.results
      .map((r) => r.value as Record<string, unknown>)
      .filter((b) => (b.insert as ReturnType<typeof vi.fn>)?.mock.calls.length)
    const insertArg = (insertCalls[0]?.insert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertArg.project_id).toBe(MCP_PROJECT_ID)
  })

  it("does NOT register without workflows:write scope", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("create_workflow")
  })
})

// ── delete_workflow ─────────────────────────────────────────────────────────

describe("delete_workflow tool", () => {
  it("deletes a workflow that belongs to the mcp project", async () => {
    fromMock
      .mockReturnValueOnce(chain({ data: { id: WORKFLOW_ID, project_id: MCP_PROJECT_ID }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "delete_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.deleted).toBe(true)
  })

  it("rejects a workflow from another project (and never issues the DELETE)", async () => {
    fromMock.mockReturnValueOnce(
      chain({ data: { id: OTHER_WORKFLOW_ID, project_id: "another-project" }, error: null }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "delete_workflow", { workflow_id: OTHER_WORKFLOW_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("mcp project")
    // Only the lookup ran — no second .from() call for the delete.
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it("returns an error when the workflow does not exist", async () => {
    fromMock.mockReturnValueOnce(chain({ data: null, error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "delete_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBe(true)
  })
})

// ── update_workflow_json ────────────────────────────────────────────────────

describe("update_workflow_json tool", () => {
  it("updates the graph when expected_updated_at matches", async () => {
    fromMock
      .mockReturnValueOnce(
        chain({ data: { id: WORKFLOW_ID, project_id: MCP_PROJECT_ID, updated_at: "2026-04-02T00:00:00Z" }, error: null }),
      )
      .mockReturnValueOnce(
        chain({ data: { id: WORKFLOW_ID, name: "Flow", updated_at: "2026-04-03T00:00:00Z" }, error: null }),
      )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      nodes: [{ id: "n1", type: "text-prompt", data: {} }],
      edges: [],
      expected_updated_at: "2026-04-02T00:00:00Z",
    })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.updated_at).toBe("2026-04-03T00:00:00Z")
  })

  it("returns a conflict error when expected_updated_at is stale", async () => {
    fromMock.mockReturnValueOnce(
      chain({ data: { id: WORKFLOW_ID, project_id: MCP_PROJECT_ID, updated_at: "2026-04-05T00:00:00Z" }, error: null }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      nodes: [],
      edges: [],
      expected_updated_at: "2026-04-02T00:00:00Z",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("modified since")
    // No UPDATE issued — just the lookup.
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it("updates without a concurrency check when expected_updated_at is omitted", async () => {
    fromMock
      .mockReturnValueOnce(
        chain({ data: { id: WORKFLOW_ID, project_id: MCP_PROJECT_ID, updated_at: "whatever" }, error: null }),
      )
      .mockReturnValueOnce(
        chain({ data: { id: WORKFLOW_ID, name: "Flow", updated_at: "2026-04-09T00:00:00Z" }, error: null }),
      )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "update_workflow_json", {
      workflow_id: WORKFLOW_ID,
      nodes: [],
      edges: [],
    })
    expect(result.isError).toBeUndefined()
  })
})

// ── export_workflow ─────────────────────────────────────────────────────────

describe("export_workflow tool", () => {
  it("exports in template mode (no assets), stripping generated fields", async () => {
    fromMock.mockReturnValue(
      chain({
        data: {
          id: WORKFLOW_ID,
          name: "Exported Flow",
          nodes: [
            { id: "n1", type: "generate-image", data: { prompt: "a cat", generatedImageUrl: "https://r2/x.png" } },
          ],
          edges: [{ source: "n1", target: "n2" }],
          settings: { theme: "dark" },
        },
        error: null,
      }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "export_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBeUndefined()
    const bundle = JSON.parse(result.content[0]?.text ?? "{}") as {
      version: number
      name: string
      nodes: Array<{ data: Record<string, unknown> }>
      assets?: unknown
    }
    expect(bundle.version).toBe(1)
    expect(bundle.name).toBe("Exported Flow")
    expect(bundle.assets).toBeUndefined()
    // stripExportContent removed the transient field but kept the prompt.
    expect(bundle.nodes[0]?.data.prompt).toBe("a cat")
    expect(bundle.nodes[0]?.data.generatedImageUrl).toBeUndefined()
  })

  it("works on a workflow outside the mcp project (not scoped)", async () => {
    // The query never filters on project_id, so any owned row is exportable.
    fromMock.mockReturnValue(
      chain({
        data: { id: OTHER_WORKFLOW_ID, name: "Other", nodes: [], edges: [], settings: {} },
        error: null,
      }),
    )
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "export_workflow", { workflow_id: OTHER_WORKFLOW_ID })
    expect(result.isError).toBeUndefined()
    const bundle = JSON.parse(result.content[0]?.text ?? "{}") as { name: string }
    expect(bundle.name).toBe("Other")
  })

  it("errors when the workflow is not owned by the caller", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const result = await callTool(server, "export_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBe(true)
  })
})

// ── import_workflow ─────────────────────────────────────────────────────────

describe("import_workflow tool", () => {
  it("creates a new workflow in the mcp project from a bundle", async () => {
    fromMock.mockReturnValueOnce(
      chain({ data: { id: WORKFLOW_ID, name: "Imported", created_at: "x", updated_at: "x" }, error: null }),
    )
    const bundle = {
      version: 1,
      exportedAt: "2026-04-01T00:00:00Z",
      name: "Imported",
      nodes: [{ id: "n1", type: "text-prompt", data: { text: "hi" } }],
      edges: [],
      settings: {},
    }
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "import_workflow", {
      workflow_json: JSON.stringify(bundle),
    })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.id).toBe(WORKFLOW_ID)
    const insertArg = (fromMock.mock.results[0]?.value as { insert: ReturnType<typeof vi.fn> }).insert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertArg.project_id).toBe(MCP_PROJECT_ID)
    expect(insertArg.name).toBe("Imported")
  })

  it("rejects invalid JSON", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "import_workflow", { workflow_json: "{not json" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("not valid JSON")
  })

  it("rejects a JSON object that isn't a workflow bundle", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:write"]), fastify: Fastify() })
    const result = await callTool(server, "import_workflow", {
      workflow_json: JSON.stringify({ hello: "world" }),
    })
    expect(result.isError).toBe(true)
  })
})

// ── run_workflow ────────────────────────────────────────────────────────────

describe("run_workflow tool", () => {
  it("validates the workflow is in the mcp project, then calls /v1/workflows/:id/run", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/workflows/:id/run", async (req) => {
      received = req.body as Record<string, unknown>
      return { executionId: "e-1", status: "pending" }
    })
    fromMock.mockReturnValue(chain({ data: { name: "My Flow", project_id: MCP_PROJECT_ID }, error: null }))

    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:execute"]), fastify })
    const result = await callTool(server, "run_workflow", {
      workflow_id: WORKFLOW_ID,
      inputs: { a: { b: 1 } },
    })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.executionId).toBe("e-1")
    expect(received?.userId).toBe("u1")
    expect(received?.mcp_client).toBe("Claude")
    expect(result.content.length).toBe(1)
  })

  it("rejects a workflow that is not in the mcp project (no run issued)", async () => {
    const fastify = Fastify()
    let hit = false
    fastify.post("/v1/workflows/:id/run", async () => {
      hit = true
      return { executionId: "e-1" }
    })
    fromMock.mockReturnValue(chain({ data: { name: "Other", project_id: "elsewhere" }, error: null }))
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:execute"]), fastify })
    const result = await callTool(server, "run_workflow", { workflow_id: WORKFLOW_ID })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("mcp project")
    expect(hit).toBe(false)
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(["workflows:read"]), fastify: Fastify() })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("run_workflow")
  })
})

// ── full-catalog gate (all 9 tools present with all scopes) ─────────────────

describe("registerWorkflows catalog", () => {
  it("registers all 9 workflow tools when every scope is granted", async () => {
    const server = buildServer()
    registerWorkflows({ server, session: mcpSession(ALL), fastify: Fastify() })
    const names = (await listTools(server)).map((t) => t.name)
    for (const t of [
      "list_workflows",
      "get_workflow",
      "get_workflow_json",
      "export_workflow",
      "create_workflow",
      "delete_workflow",
      "update_workflow_json",
      "import_workflow",
      "run_workflow",
    ]) {
      expect(names).toContain(t)
    }
  })
})
