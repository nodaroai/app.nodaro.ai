import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

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
  /** A `GET /v1/jobs/:id` that answers something other than a row. */
  jobFailure: null as { status: number; body: unknown } | null,
}))

/**
 * NOTHING in this family reads Supabase.
 *
 * Spec §8: every tool dispatches to a §7 route through `mcpInject`, because the
 * ROUTES own the semantics — the owner filter, the outward projection, the 404.
 * A direct read is a second opinion about one row, so this mock refuses to
 * answer rather than quietly standing in for a database.
 */
vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => {
      throw new Error("a studio production tool must not read Supabase directly")
    },
  },
}))

const { registerStudioProductionTools } = await import("../studio-production.js")
const { sanitizeJobForPublic } = await import("../../../../routes/jobs.js")

const JOB = "00000000-0000-4000-8000-0000000000aa"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"

const PLAN = { format: "nodaro-studio-production", version: 2, scenes: [] }

/**
 * A Director run's `jobs` row, shaped as the PLATFORM actually writes it —
 * not as the reader happens to want it.
 *
 * `input_data` is `structuredJobInputData` (lib/llm-structured-request.ts): the
 * request body minus `userId`, plus `type` (stamped at INSERT by
 * `buildJobInputData`), with `system` replaced by a digest and `jsonSchema`
 * replaced by `{ name, bytes }` — so `schemaName` rides through from the body
 * and the schema's name appears twice. `output_data` is what
 * `workers/handlers/llm-structured.ts` writes at completion:
 * `{ output, inputTokens, outputTokens }`.
 *
 * The `job_type` COLUMN is deliberately absent from every fixture here. It is
 * written by the queue worker at pickup (`workers/video-worker.ts`), which is
 * why `GET /v1/jobs` filters `input_data->>type` instead — and this reader
 * follows that same precedent.
 */
function directorRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB,
    status: "completed",
    input_data: {
      type: "llm-structured",
      origin: "studio",
      schemaName: "studio_production",
      jsonSchema: { name: "studio_production", bytes: 41234 },
      system: "sha256:9f2c…",
      input: "A chase in Rome.",
      llmModel: "claude-fable-5",
      label: "Rome",
    },
    output_data: { output: PLAN, inputTokens: 1200, outputTokens: 4300 },
    ...over,
  }
}

interface Captured {
  url?: string
  method?: string
  body?: Record<string, unknown>
  /** The job read is captured apart from the studio routes: several cases turn
   *  on the import route NOT having been reached, and a shared field would let
   *  the job read answer for it. */
  jobUrl?: string
  jobHeaders?: Record<string, unknown>
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
  /**
   * `GET /v1/jobs/:id` — the route the `plan_job_id` lane reads a finished
   * Director run through, answering with the route's OWN outward projection
   * (`sanitizeJobForPublic`, routes/jobs.ts) rather than the raw row: a key the
   * platform strips on the way out can then never be one this reader depends
   * on. A job that is not the caller's is a 404 there, which is why the "not
   * the caller's" fixture below is simply an absent row.
   */
  fastify.get("/v1/jobs/:id", async (req, reply) => {
    seen.jobUrl = req.url
    seen.jobHeaders = req.headers as Record<string, unknown>
    if (h.jobFailure) return reply.status(h.jobFailure.status).send(h.jobFailure.body)
    if (!h.jobRow) {
      return reply
        .status(404)
        .send({ error: { code: "not_found", message: "Job not found" } })
    }
    return { data: sanitizeJobForPublic(h.jobRow as never, false) }
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
  h.jobFailure = null
})

describe("registration", () => {
  it("only the skill is ungated — reading the format is the one thing that costs nothing", async () => {
    const { server } = serverWith([])
    const names = (await listTools(server)).map((t) => t.name).sort()
    expect(names).toEqual(["get_studio_production_skill"])
  })

  it("validation needs workflows:read, exactly as its route does", async () => {
    // `POST /v1/studio/productions/validate` authorizes on `workflows:read`,
    // because validating resolves every `cast` name against the caller's own
    // characters, locations, objects and creatures — a name-existence oracle
    // over four entity tables. A tool that is registered more widely than the
    // route it calls just moves the 403 later; register it where the route is.
    const none = (await listTools(serverWith([]).server)).map((t) => t.name)
    expect(none).not.toContain("validate_studio_plan")

    const read = (await listTools(serverWith(["workflows:read"]).server)).map((t) => t.name)
    expect(read).toContain("validate_studio_plan")

    const write = (await listTools(serverWith(["workflows:write"]).server)).map((t) => t.name)
    expect(write).not.toContain("validate_studio_plan")
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
    const { server, seen } = serverWith(["workflows:read"])
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
    h.jobRow = directorRow()
    const { server, seen } = serverWith(ALL)
    await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(seen.body).toMatchObject({ plan: PLAN, mode: "append" })
  })

  it("reads the run through the jobs ROUTE, as the job's owner", async () => {
    // The whole point of §8: the tool asks a route, and the route is what makes
    // the read the CALLER's. The owner header is that scoping — without it the
    // injected request has no user at all and the route's owner filter has
    // nothing to filter on.
    h.jobRow = directorRow()
    const { server, seen } = serverWith(ALL)
    await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(seen.jobUrl).toBe(`/v1/jobs/${JOB}`)
    expect(seen.jobHeaders?.["x-internal-user-id"]).toBe("u1")
  })

  it("a malformed job id never reaches the route", async () => {
    // Postgres answers `invalid input syntax for type uuid` with a 500, and a
    // 500 is not an answer a model can correct itself from.
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: "nope",
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_found")
    expect(seen.jobUrl).toBeUndefined()
  })

  it("a job still running is `not_finished` — poll, then call again", async () => {
    h.jobRow = directorRow({ status: "processing", output_data: { stage: "drafting" } })
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
    h.jobRow = directorRow({ status: "failed", output_data: null })
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
    h.jobRow = directorRow({
      input_data: { type: "generate-image", userPrompt: "a cat" },
      output_data: { imageUrl: "https://r2/x.png" },
    })
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_studio_plan")
  })

  it("an llm-structured run for a DIFFERENT schema is `not_studio_plan`", async () => {
    // The nearest miss: right job type, wrong document. Only the schema name
    // separates a production run from every other structured draft.
    h.jobRow = directorRow({
      input_data: { type: "llm-structured", schemaName: "recast_script" },
      output_data: { output: { scenes: [] } },
    })
    const { server } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_studio_plan")
  })

  it("never lands the ENVELOPE when the row carries no `output`", async () => {
    // `output_data` is the worker's envelope — `{ output, inputTokens }`. A
    // completed row missing `output` must refuse, not import the token counts
    // as if they were a production.
    h.jobRow = directorRow({ output_data: { inputTokens: 1200, outputTokens: 0 } })
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(seen.url).toBeUndefined()
    // A TERMINAL row, so it must not read as `not_finished`: that would send
    // the model polling a job that will never change. The studio client calls
    // this same row failed ("The run finished without a plan.").
    expect(res.content[0].text).toContain("no_output")
    expect(res.content[0].text).not.toContain("not_finished")
  })

  it("passes a refusal that is not a 404 through in the route's own words", async () => {
    // The job read is a ROUTE call now, so a failure there is the route's to
    // explain: rephrasing it as one of this reader's four verdicts would tell
    // the model to fix a plan when what broke was the platform.
    h.jobFailure = {
      status: 401,
      body: { error: { code: "unauthorized", message: "Authentication required" } },
    }
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "import_studio_production", {
      production_id: PRODUCTION,
      plan_job_id: JOB,
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("unauthorized")
    expect(res.content[0].text).toContain("Authentication required")
    // And nothing was imported on the strength of a job nobody could read.
    expect(seen.url).toBeUndefined()
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

describe("the open-editor warning", () => {
  // A production the user has open in the studio editor is held in the
  // browser's store and written back WHOLE on a debounce, so an editor that
  // was already open when an import landed overwrites it the next time the
  // user touches anything. Nothing on this side can stop that today, so the
  // two places an agent actually reads — this tool's description, and the
  // operating guide it is told to read first — both have to say it plainly.
  const importDescription = async (): Promise<string> => {
    const tools = await listTools(serverWith(ALL).server)
    return tools.find((t) => t.name === "import_studio_production")?.description ?? ""
  }

  it("import_studio_production tells the caller to have the user reload the editor", async () => {
    const description = await importDescription()
    expect(description).toMatch(/reload/i)
    expect(description).toMatch(/editor/i)
  })

  it("create_studio_production does not — a production that does not exist yet is open nowhere", async () => {
    const tools = await listTools(serverWith(ALL).server)
    const create = tools.find((t) => t.name === "create_studio_production")?.description ?? ""
    expect(create).not.toMatch(/reload/i)
  })

  it("the operating skill says the same thing", () => {
    // Tool/skill parity for one warning, not a route test: the file read here
    // is exactly the one `get_studio_production_skill` serves as
    // `part: "operating"`, so an agent that reads the guide once and never
    // re-reads a description still learns it.
    const here = dirname(fileURLToPath(import.meta.url))
    const skill = readFileSync(resolve(here, "../../../../../skills/studio-production.md"), "utf8")
    expect(skill).toMatch(/reload/i)
    expect(skill).toMatch(/editor/i)
  })
})
