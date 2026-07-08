import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { registerJobs } = await import("../jobs.js")
const { supabase } = await import("../../../supabase.js")

beforeEach(() => {
  vi.clearAllMocks()
})

function mockListJobs(rows: unknown[]) {
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

function mockGetJob(row: unknown | null) {
  ;(supabase.from as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    }),
  })
}

describe("list_jobs tool", () => {
  it("returns rows scoped to the session userId", async () => {
    mockListJobs([
      {
        id: "j1",
        status: "completed",
        job_type: "generate-image",
        created_at: "2026-04-01T00:00:00Z",
        credits: 2,
      },
    ])
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "list_jobs", { limit: 10 })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"j1\"")
  })

  it("does NOT register without jobs:read scope", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("list_jobs")
  })
})

describe("get_job tool", () => {
  it("returns single job row when owned", async () => {
    mockGetJob({
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "u1",
      status: "completed",
      output_data: { imageUrl: "https://r2/x.png" },
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", {
      job_id: "11111111-1111-1111-1111-111111111111",
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("11111111-1111-1111-1111-111111111111")
  })

  it("adds retryable=false for a content-policy failure", async () => {
    mockGetJob({
      id: "22222222-2222-2222-2222-222222222222",
      user_id: "u1",
      status: "failed",
      error_message:
        "Content policy violation: The output was blocked by the provider's safety filter. Try modifying your prompt or input image.",
    })
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", {
      job_id: "22222222-2222-2222-2222-222222222222",
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('"retryable": false')
    expect(result.content[0]?.text).toMatch(/Content policy violation/)
  })

  it("returns isError when job not found", async () => {
    mockGetJob(null)
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    // Valid UUID that resolves to no row — exercises the maybeSingle-null
    // not-found path (a non-UUID would short-circuit at the guard below).
    const result = await callTool(server, "get_job", {
      job_id: "00000000-0000-0000-0000-000000000000",
    })
    expect(result.isError).toBe(true)
  })

  it("returns a clean not-found for a non-UUID job_id (no raw uuid-cast error)", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["jobs:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const result = await callTool(server, "get_job", { job_id: "not-a-uuid" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/not found/)
    // The raw Postgres "invalid input syntax for type uuid" must never leak.
    expect(result.content[0]?.text).not.toMatch(/invalid input syntax/)
    // Guard short-circuits before touching Supabase.
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it("does NOT register without jobs:read scope", async () => {
    const server = buildServer()
    registerJobs({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:read"] as Scope[],
        clientName: "Claude",
      }),
      fastify: Fastify(),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("get_job")
  })
})
