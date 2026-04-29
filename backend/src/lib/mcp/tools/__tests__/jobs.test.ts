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
      id: "j1",
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
    const result = await callTool(server, "get_job", { job_id: "j1" })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("\"j1\"")
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
    const result = await callTool(server, "get_job", { job_id: "missing" })
    expect(result.isError).toBe(true)
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
