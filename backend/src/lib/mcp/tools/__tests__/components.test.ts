import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerComponents } = await import("../components.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function mockListComponents(rows: unknown[]) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }),
  })
}

describe("list_components tool", () => {
  it("returns marketplace components", async () => {
    mockListComponents([
      {
        id: "c1",
        slug: "thumbnail-maker",
        name: "Thumbnail Maker",
        created_at: "2026-04-01T00:00:00Z",
      },
    ])
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_components", { limit: 5 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"thumbnail-maker\"")
  })

  it("does NOT register without workflows:read scope", async () => {
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_components")
  })
})

describe("run_component tool", () => {
  it("calls /v1/component/execute and returns _meta.task_id", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/component/execute", async (req, reply) => {
      received = req.body as Record<string, unknown>
      return reply.status(202).send({ jobId: "j-comp" })
    })
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Cursor",
      }),
      fastify,
    })
    const result = await callTool(server, "run_component", {
      component_id: "thumbnail-maker",
    })
    expect(result.isError).toBeUndefined()
    expect(((result.structuredContent as Record<string, unknown>)?.jobId ?? (result.structuredContent as Record<string, unknown>)?.executionId)).toBe("j-comp")
    expect(received?.appSlug).toBe("thumbnail-maker")
    expect(received?.mcp_client).toBe("Cursor")
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerComponents({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("run_component")
  })
})
