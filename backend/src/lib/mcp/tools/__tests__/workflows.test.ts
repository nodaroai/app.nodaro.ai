import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerWorkflows } = await import("../workflows.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function mockListWorkflows(rows: unknown[]) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  })
}

describe("list_workflows tool", () => {
  it("returns workflows scoped to userId", async () => {
    mockListWorkflows([
      {
        id: "w1",
        project_id: "p1",
        name: "My Flow",
        created_at: "2026-04-01T00:00:00Z",
      },
    ])
    const server = buildServer()
    registerWorkflows({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_workflows", {})
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"w1\"")
  })

  it("does NOT register without workflows:read scope", async () => {
    const server = buildServer()
    registerWorkflows({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_workflows")
  })
})

describe("run_workflow tool", () => {
  it("calls /v1/workflows/:id/run and returns _meta.task_id + workflow widget", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/workflows/:id/run", async (req) => {
      received = req.body as Record<string, unknown>
      return { executionId: "e-1", status: "pending" }
    })

    // The widget header pulls workflows.name; stub the name lookup.
    ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { name: "My Flow" }, error: null }),
        }),
      }),
    })

    const server = buildServer()
    registerWorkflows({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    const result = await callTool(server, "run_workflow", {
      workflow_id: "00000000-0000-0000-0000-000000000001",
      inputs: { a: { b: 1 } },
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("e-1")
    expect(received?.userId).toBe("u1")
    expect(received?.mcp_client).toBe("Claude")

    // Per MCP Apps spec: text + structuredContent. The iframe template lives
    // at ui://nodaro/widget/workflow (declared on tool _meta.ui.resourceUri).
    expect(result.content.length).toBe(1)
    const sc = (result as { structuredContent?: Record<string, unknown> }).structuredContent
    expect(sc?.executionId).toBe("e-1")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerWorkflows({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("run_workflow")
  })
})
