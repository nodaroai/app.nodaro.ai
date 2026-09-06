import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * The studio production MCP family.
 *
 * Registration and scope gating are pinned by the tool-surface snapshot (exact
 * membership per edition × scope grant), so this suite covers what a snapshot
 * cannot see: that each tool reaches the RIGHT route with the right body, and
 * that `import_studio_production`'s `plan_job_id` lane refuses a job three
 * different ways — a model that gets one generic error back cannot tell
 * "poll and try again" from "you have the wrong id".
 */

const h = vi.hoisted(() => ({
  jobRow: null as Record<string, unknown> | null,
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.jobRow }) }) }),
      }),
    }),
  },
}))

const { registerStudioProductionTools } = await import("../studio-production.js")

const JOB = "00000000-0000-4000-8000-0000000000aa"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"

const PLAN = { format: "nodaro-studio-production", version: 2, scenes: [] }

interface Captured {
  url?: string
  method?: string
  body?: Record<string, unknown>
}

/** A Fastify stub standing in for the whole `/v1/studio/productions` surface. */
function stubRoutes(): { fastify: FastifyInstance; seen: Captured } {
  const fastify = Fastify()
  const seen: Captured = {}
  const capture = (req: { url: string; method: string; body?: unknown }) => {
    seen.url = req.url
    seen.method = req.method
    seen.body = req.body as Record<string, unknown>
  }
  fastify.get("/v1/studio/productions/skill", async (req) => {
    capture(req)
    return {
      data: {
        skill: "# authoring",
        catalog: "# catalog",
        schema: { type: "object" },
        operating: "# operating",
        generatedFrom: { prompts: "1.0.0", shared: "2.0.0" },
      },
    }
  })
  fastify.post("/v1/studio/productions/validate", async (req) => {
    capture(req)
    return { data: { valid: true, errors: [], warnings: [] } }
  })
  fastify.get("/v1/studio/productions", async (req) => {
    capture(req)
    return { data: { data: [] } }
  })
  fastify.post("/v1/studio/productions", async (req) => {
    capture(req)
    return { data: { production: { id: PRODUCTION } } }
  })
  fastify.get("/v1/studio/productions/:id", async (req) => {
    capture(req)
    return { data: { production: { id: PRODUCTION } } }
  })
  fastify.post("/v1/studio/productions/:id/import", async (req) => {
    capture(req)
    return { data: { production: { id: PRODUCTION }, warnings: [] } }
  })
  return { fastify, seen }
}

function serverWith(scopes: Scope[]) {
  const server = buildServer()
  const { fastify, seen } = stubRoutes()
  registerStudioProductionTools({
    server,
    session: newSession({ userId: "u1", scopes, clientName: "Claude" }),
    fastify,
  })
  return { server, seen }
}

const ALL: Scope[] = ["workflows:read", "workflows:write"]

beforeEach(() => {
  h.jobRow = null
})

describe("registration", () => {
  it("the skill and validation are ungated — the free loop has to be reachable", async () => {
    const { server } = serverWith([])
    const names = (await listTools(server)).map((t) => t.name).sort()
    expect(names).toEqual(["get_studio_production_skill", "validate_studio_plan"])
  })

  it("reading needs workflows:read, writing needs workflows:write", async () => {
    const read = (await listTools(serverWith(["workflows:read"]).server)).map((t) => t.name)
    expect(read).toContain("get_studio_production")
    expect(read).toContain("list_studio_productions")
    expect(read).not.toContain("create_studio_production")

    const write = (await listTools(serverWith(["workflows:write"]).server)).map((t) => t.name)
    expect(write).toContain("create_studio_production")
    expect(write).toContain("import_studio_production")
    expect(write).not.toContain("get_studio_production")
  })
})

describe("get_studio_production_skill", () => {
  it("serves the operating guide by default, and each part on request", async () => {
    const { server } = serverWith([])
    const operating = await callTool(server, "get_studio_production_skill", {})
    expect(operating.content[0].text).toBe("# operating")

    const authoring = await callTool(server, "get_studio_production_skill", {
      part: "authoring",
    })
    expect(authoring.content[0].text).toBe("# authoring")

    const schema = await callTool(server, "get_studio_production_skill", { part: "schema" })
    expect(JSON.parse(schema.content[0].text as string)).toEqual({ type: "object" })
  })
})

describe("validate_studio_plan", () => {
  it("posts the plan to the validate route and hands back its verdict", async () => {
    const { server, seen } = serverWith([])
    const res = await callTool(server, "validate_studio_plan", { plan: PLAN })
    expect(seen.url).toBe("/v1/studio/productions/validate")
    expect(seen.body).toMatchObject({ plan: PLAN, userId: "u1" })
    expect(res.structuredContent).toMatchObject({ valid: true })
  })
})

describe("get_studio_production", () => {
  it("passes detail and shot_id through as query", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "get_studio_production", {
      production_id: PRODUCTION,
      detail: "full",
      shot_id: "shot-2",
    })
    expect(seen.url).toContain(`/v1/studio/productions/${PRODUCTION}`)
    expect(seen.url).toContain("detail=full")
    expect(seen.url).toContain("shot_id=shot-2")
  })

  it("rejects a malformed id at the schema, before any query", async () => {
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: "nope" })
    expect(res.isError).toBe(true)
    // The route was never reached — a non-UUID cannot name a production, and
    // Postgres must never see it (`invalid input syntax for type uuid`).
    expect(seen.url).toBeUndefined()
  })
})

describe("create_studio_production", () => {
  it("stamps the calling client on the write", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "create_studio_production", { plan: PLAN, name: "A film" })
    expect(seen.method).toBe("POST")
    expect(seen.body).toMatchObject({
      mcp_client: "Claude",
      userId: "u1",
      name: "A film",
      plan: PLAN,
    })
  })
})

describe("import_studio_production", () => {
  it("appends an explicit plan", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan: PLAN,
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/import`)
    expect(seen.body).toMatchObject({ plan: PLAN, mode: "append", mcp_client: "Claude" })
  })

  it("refuses when neither a plan nor a job id is given", async () => {
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("plan_required")
  })

  it("lands a FINISHED studio_production run's output", async () => {
    h.jobRow = {
      status: "completed",
      job_type: "llm-structured",
      input_data: { schemaName: "studio_production" },
      output_data: { output: PLAN },
    }
    const { server, seen } = serverWith(ALL)
    await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(seen.body).toMatchObject({ plan: PLAN, mode: "append" })
  })

  it("a job still running is `not_finished` — poll, then call again", async () => {
    h.jobRow = {
      status: "processing",
      job_type: "llm-structured",
      input_data: { schemaName: "studio_production" },
    }
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_finished")
    // The status is IN the message: "poll until completed" is only actionable
    // if the model can see what it is waiting on.
    expect(res.content[0].text).toContain("processing")
  })

  it("a failed job is `not_finished` too, and says so", async () => {
    h.jobRow = {
      status: "failed",
      job_type: "llm-structured",
      input_data: { schemaName: "studio_production" },
    }
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.content[0].text).toContain("failed")
  })

  it("a finished job of the WRONG kind is `not_studio_plan`", async () => {
    // A different mistake from "not finished", and it must read differently:
    // the answer here is "you have the wrong job id", not "wait".
    h.jobRow = {
      status: "completed",
      job_type: "generate-image",
      input_data: {},
      output_data: { imageUrl: "https://r2/x.png" },
    }
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_studio_plan")
  })

  it("a job that is not the caller's is simply not found", async () => {
    h.jobRow = null
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_found")
  })
})
