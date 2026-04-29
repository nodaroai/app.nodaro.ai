import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerApps } = await import("../apps.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function mockListApps(rows: unknown[]) {
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

describe("list_apps tool", () => {
  it("returns marketplace apps", async () => {
    mockListApps([
      {
        id: "a1",
        slug: "headshot-pro",
        name: "Headshot Pro",
        created_at: "2026-04-01T00:00:00Z",
      },
    ])
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["apps:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_apps", { limit: 5 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"headshot-pro\"")
  })

  it("does NOT register without apps:read scope", async () => {
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_apps")
  })
})

describe("run_app tool", () => {
  it("calls /v1/app/:slug/run and returns _meta.task_id", async () => {
    const fastify = Fastify()
    let received: Record<string, unknown> | undefined
    fastify.post("/v1/app/:slug/run", async (req, reply) => {
      received = req.body as Record<string, unknown>
      return reply.status(202).send({
        executionId: "e-app",
        runId: "r-1",
        status: "pending",
      })
    })
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["workflows:execute"] as Scope[],
        clientName: "Claude",
      }),
      fastify,
    })
    const result = await callTool(server, "run_app", {
      slug: "headshot-pro",
      inputs: { node1: { value: "hello" } },
    })
    expect(result.isError).toBeUndefined()
    expect((result._meta as Record<string, unknown>)?.task_id).toBe("e-app")
    expect(received?.userId).toBe("u1")
    expect((received?.inputOverrides as Record<string, unknown>)?.node1).toEqual({ value: "hello" })
  })

  it("does NOT register without workflows:execute scope", async () => {
    const server = buildServer()
    registerApps({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["apps:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("run_app")
  })
})
