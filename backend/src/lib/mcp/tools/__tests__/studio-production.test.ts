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
 * cannot see: that each tool reaches the RIGHT route with the right method,
 * body and query, and that it maps what the route answered rather than
 * inventing a shape of its own.
 *
 * It asserts the REQUEST, never the route's behaviour. The routes are served
 * elsewhere and have their own suites; a test here that asserted what a
 * production looks like after an edit would be asserting the stub.
 */

const h = vi.hoisted(() => ({
  jobRow: null as Record<string, unknown> | null,
  /** A `GET /v1/jobs/:id` that answers something other than a row. */
  jobFailure: null as { status: number; body: unknown } | null,
  /** Force every studio route to answer this instead of its canned reply. */
  routeFailure: null as { status: number; body: unknown } | null,
  /** Force ONLY the reconcile route to answer this — the read lane's
   *  before-the-read call has its own refusals, and the cases that matter are
   *  the ones where reconcile fails and the GET does not. */
  reconcileFailure: null as { status: number; body: unknown } | null,
}))

/**
 * NOTHING in this family reads Supabase.
 *
 * Every tool dispatches to a route, because the ROUTES own the semantics — the
 * owner filter, the outward projection, the 404. A direct read is a second
 * opinion about one row, so this mock refuses to answer rather than quietly
 * standing in for a database.
 */
vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: () => {
      throw new Error("a studio production tool must not read Supabase directly")
    },
  },
}))

const { registerStudioProductionTools } = await import("../studio-production.js")
const { STUDIO_PRODUCTION_TOOL_NAMES } = await import("../_studio-helpers.js")
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
  /** Every studio request in the order it went out. `url`/`method`/`body`
   *  above are the LAST one, which cannot say what came before it — and a tool
   *  that makes two requests is only correct if both are right and in order. */
  calls: Array<{ method: string; url: string; body?: Record<string, unknown> }>
  /** The job read is captured apart from the studio routes: several cases turn
   *  on the import route NOT having been reached, and a shared field would let
   *  the job read answer for it. */
  jobUrl?: string
  jobHeaders?: Record<string, unknown>
}

/** A Fastify stub standing in for the whole `/v1/studio/productions` surface. */
function stubRoutes(): { fastify: FastifyInstance; seen: Captured } {
  const fastify = Fastify()
  const seen: Captured = { calls: [] }
  const capture = (req: { url: string; method: string; body?: unknown }) => {
    seen.url = req.url
    seen.method = req.method
    seen.body = req.body as Record<string, unknown>
    seen.calls.push({
      method: req.method,
      url: req.url,
      body: req.body as Record<string, unknown>,
    })
  }
  /**
   * Register a studio route that records the request and answers `data` — or,
   * when `data` is a function, whatever it makes of the body. The one route
   * that needs the second form is `generate`, whose real answer is a QUOTE
   * when the body said `dryRun` and a job id otherwise: a fixture that always
   * hands back a job id could not tell the two apart.
   */
  const route = (
    method: "get" | "post",
    url: string,
    data: unknown | ((body: Record<string, unknown>) => unknown),
  ): void => {
    fastify[method](url, async (req, reply) => {
      capture(req)
      if (h.routeFailure) {
        return reply.status(h.routeFailure.status).send(h.routeFailure.body)
      }
      return {
        data:
          typeof data === "function"
            ? (data as (body: Record<string, unknown>) => unknown)(
                (req.body ?? {}) as Record<string, unknown>,
              )
            : data,
      }
    })
  }

  const view = { production: { id: PRODUCTION } }

  route("get", "/v1/studio/productions/skill", {
    skill: "# authoring",
    catalog: "# catalog",
    schema: { type: "object" },
    operating: "# operating",
    generatedFrom: { prompts: "1.0.0", shared: "2.0.0", codec: "0.3.0" },
  })
  route("post", "/v1/studio/productions/validate", { valid: true, errors: [], warnings: [] })
  route("get", "/v1/studio/productions", { data: [] })
  route("post", "/v1/studio/productions", view)
  route("get", "/v1/studio/productions/:id", view)
  route("get", "/v1/studio/productions/:id/export-plan", { steps: [], estimate: 0 })
  route("post", "/v1/studio/productions/:id/import", { ...view, warnings: [] })
  route("post", "/v1/studio/productions/:id/ops", {
    ...view,
    version: 4,
    rebased: false,
    receipts: [],
    warnings: [],
  })
  route("post", "/v1/studio/productions/:id/share", view)
  route("post", "/v1/studio/productions/:id/clone", view)
  route("post", "/v1/studio/productions/:id/describe", { ...view, jobId: JOB })
  route("post", "/v1/studio/productions/:id/generate", (body: Record<string, unknown>) =>
    body.dryRun
      ? { dryRun: true, provider: "cheap-model", count: 1, credits: 12 }
      : { ...view, jobIds: [JOB] },
  )
  route("post", "/v1/studio/productions/:id/frame", view)
  route("post", "/v1/studio/productions/:id/voice", { ...view, jobId: JOB })
  route("post", "/v1/studio/productions/:id/revoice", { ...view, jobId: JOB })
  route("post", "/v1/studio/productions/:id/music", { ...view, jobId: JOB })

  /**
   * `POST …/:id/reconcile` — registered by hand rather than through `route()`
   * because it takes a failure switch of its OWN and deliberately ignores the
   * family-wide one. The read lane calls it before the GET, so a shared switch
   * would turn every "the route refuses" case into a test of the first call
   * and leave the GET's own mapping unasserted.
   *
   * Its production is deliberately DISTINGUISHABLE from the GET's. Both routes
   * answer a view, so a shared fixture would make "the view returned is the
   * GET's" unfalsifiable.
   */
  fastify.post("/v1/studio/productions/:id/reconcile", async (req, reply) => {
    capture(req)
    if (h.reconcileFailure) {
      return reply.status(h.reconcileFailure.status).send(h.reconcileFailure.body)
    }
    return { data: { production: { id: PRODUCTION, from: "reconcile" }, landed: [], pending: [] } }
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

const READ: Scope[] = ["workflows:read"]
const WRITE: Scope[] = ["workflows:write"]
/** Everything the family's gates ask for, so a missing tool is never a grant. */
const ALL: Scope[] = ["workflows:read", "workflows:write", "workflows:execute"]

beforeEach(() => {
  h.jobRow = null
  h.jobFailure = null
  h.routeFailure = null
  h.reconcileFailure = null
})

describe("registration", () => {
  it("registers exactly the names the family's one list declares", async () => {
    // The list is what the tool modules register from, what the operating-guide
    // drift check reads, and what the docs rows are written against. If they can
    // disagree, one of them is wrong and nothing says which.
    const names = (await listTools(serverWith(ALL).server)).map((t) => t.name).sort()
    expect(names).toEqual([...STUDIO_PRODUCTION_TOOL_NAMES].sort())
    expect(names).toHaveLength(18)
  })

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

    const read = (await listTools(serverWith(READ).server)).map((t) => t.name)
    expect(read).toContain("validate_studio_plan")

    const write = (await listTools(serverWith(WRITE).server)).map((t) => t.name)
    expect(write).not.toContain("validate_studio_plan")
  })

  it("reading needs workflows:read, writing needs workflows:write", async () => {
    const read = (await listTools(serverWith(READ).server)).map((t) => t.name)
    expect(read).toContain("get_studio_production")
    expect(read).toContain("list_studio_productions")
    expect(read).toContain("plan_studio_export")
    expect(read).not.toContain("create_studio_production")

    const write = (await listTools(serverWith(WRITE).server)).map((t) => t.name)
    expect(write).toContain("create_studio_production")
    expect(write).toContain("import_studio_production")
    expect(write).toContain("edit_studio_production")
    expect(write).toContain("share_studio_production")
    expect(write).toContain("clone_studio_production")
    expect(write).not.toContain("get_studio_production")
  })

  it("spending tools need BOTH workflows:write and workflows:execute", async () => {
    // Their routes authorize on `workflows:write` and they spend, which is
    // `workflows:execute`. Either grant alone would show a tool that the route
    // then refuses with a 403 — the family's rule is that a visible tool is one
    // its route will run.
    const SPENDING = [
      "describe_studio_production",
      "generate_studio_still",
      "generate_studio_keyframe",
      "generate_studio_clip",
      "new_studio_shot_from_frame",
      "voice_studio_shot",
      "revoice_studio_clip",
      "score_studio_production",
    ]
    const write = (await listTools(serverWith(WRITE).server)).map((t) => t.name)
    const execute = (await listTools(serverWith(["workflows:execute"]).server)).map((t) => t.name)
    const both = (await listTools(serverWith(ALL).server)).map((t) => t.name)
    for (const name of SPENDING) {
      expect(write, name).not.toContain(name)
      expect(execute, name).not.toContain(name)
      expect(both, name).toContain(name)
    }
  })

  it("stamps a confirmation class on what spends and on what publishes, and on nothing else", async () => {
    const tools = await listTools(serverWith(ALL).server)
    const confirm = (name: string): unknown =>
      (tools.find((t) => t.name === name) as { _meta?: { nodaro?: { confirm?: unknown } } })?._meta
        ?.nodaro?.confirm
    expect(confirm("generate_studio_still")).toBe("$")
    expect(confirm("generate_studio_keyframe")).toBe("$")
    expect(confirm("score_studio_production")).toBe("$")
    expect(confirm("share_studio_production")).toBe("P")
    // A document edit is neither: it spends nothing, and its operations are
    // opaque to this layer, so a batch cannot be classified here at all.
    expect(confirm("edit_studio_production")).toBeUndefined()
    expect(confirm("get_studio_production")).toBeUndefined()
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
    const { server, seen } = serverWith(READ)
    const res = await callTool(server, "validate_studio_plan", { plan: PLAN })
    expect(seen.url).toBe("/v1/studio/productions/validate")
    expect(seen.body).toMatchObject({ plan: PLAN, userId: "u1" })
    expect(res.structuredContent).toMatchObject({ valid: true })
  })
})

describe("list_studio_productions", () => {
  it("passes limit and cursor through as query", async () => {
    const { server, seen } = serverWith(READ)
    await callTool(server, "list_studio_productions", { limit: 5, cursor: "abc" })
    expect(seen.method).toBe("GET")
    expect(seen.url).toContain("limit=5")
    expect(seen.url).toContain("cursor=abc")
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
    expect(seen.calls).toEqual([])
  })

  /**
   * Reading lands what has finished, THEN reads.
   *
   * Over MCP there is no browser, so nothing else brings a finished generation
   * into the document: a pure read would show an agent the same "still
   * rendering" forever while the media sat completed in the jobs table. The
   * landing call is therefore made before the read — by a session that holds a
   * write grant, and opportunistically even then: every refusal that still
   * leaves a readable production falls through to the GET.
   */
  it("lands what has finished before it reads, and returns the READ's view", async () => {
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })

    expect(seen.calls).toHaveLength(2)
    expect(seen.calls[0].method).toBe("POST")
    expect(seen.calls[0].url).toBe(`/v1/studio/productions/${PRODUCTION}/reconcile`)
    // The provenance stamp rides this POST like every other write in the family.
    expect(seen.calls[0].body).toMatchObject({ mcp_client: "Claude", userId: "u1" })
    expect(seen.calls[1].method).toBe("GET")
    expect(seen.calls[1].url).toContain(`/v1/studio/productions/${PRODUCTION}`)

    // The view is the GET's, taken AFTER the landing call — never the landing
    // call's own, which is why the two fixtures are distinguishable at all.
    expect(res.structuredContent).toEqual({ production: { id: PRODUCTION } })
  })

  it("does not attempt the landing call at all on a read-only grant", async () => {
    // The landing call is a WRITE, and an injected request carries the caller's
    // identity but not their grant — so the route cannot see that the session
    // was consented `workflows:read` only, and would apply the write. The scope
    // is therefore checked HERE, where it is known, and a read-only session
    // goes straight to the GET.
    const { server, seen } = serverWith(READ)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ production: { id: PRODUCTION } })
    expect(seen.calls.map((c) => c.method)).toEqual(["GET"])
  })

  it("still reads when the landing call is refused — a viewer on a shared production", async () => {
    // The route loads the document for EDITING before it lands anything, so a
    // viewer on a production shared with them is refused with a 403 even though
    // their grant is complete. They may read it; that is the whole point.
    h.reconcileFailure = {
      status: 403,
      body: { error: { code: "forbidden", message: "You do not have edit access" } },
    }
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ production: { id: PRODUCTION } })
    expect(seen.calls.map((c) => c.method)).toEqual(["POST", "GET"])
  })

  it("still reads while someone else is writing the production", async () => {
    // The landing write is applied by compare-and-swap, so a concurrent writer
    // — the studio editor's own autosave, on the very production the agent is
    // watching — makes it answer `409 production_busy`. Failing the loop's
    // most-called read on that would break it under exactly the concurrency the
    // design exists to absorb: the read the GET can serve is served.
    h.reconcileFailure = {
      status: 409,
      body: {
        error: {
          code: "production_busy",
          message: "This production changed while the change was being applied.",
        },
      },
    }
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ production: { id: PRODUCTION } })
    expect(seen.calls.map((c) => c.method)).toEqual(["POST", "GET"])
  })

  it("still reads when the landing route is not served at all", async () => {
    // The router's own 404 — no `error.code` in the body — means this
    // deployment does not serve that route. A read whose GET works must not be
    // failed by it.
    h.reconcileFailure = {
      status: 404,
      body: { statusCode: 404, error: "Not Found", message: "Route POST:… not found" },
    }
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ production: { id: PRODUCTION } })
    expect(seen.calls.map((c) => c.method)).toEqual(["POST", "GET"])
  })

  it("says `not_available` when the whole family is unserved", async () => {
    // Both calls land on the router's unmatched handler; the answer is the
    // family's own, not "invalid request".
    const server = buildServer()
    const empty = Fastify()
    registerStudioProductionTools({
      server,
      session: newSession({ userId: "u1", scopes: ALL, clientName: "Claude" }),
      fastify: empty,
    })
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_available")
  })

  it("reports any OTHER failure of the landing call, and does not read past it", async () => {
    // A 500 is not "the caller may not write" and not "the route is absent" —
    // it is the platform failing, and reading past it would hand back a view
    // that silently omits work that had in fact finished.
    h.reconcileFailure = { status: 500, body: { error: { code: "internal", message: "boom" } } }
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("internal")
    expect(seen.calls).toHaveLength(1)
    expect(seen.calls[0].method).toBe("POST")
  })
})

describe("plan_studio_export", () => {
  it("asks the export-plan route, and only sends `upscale` when it was asked for", async () => {
    const { server, seen } = serverWith(READ)
    await callTool(server, "plan_studio_export", { production_id: PRODUCTION })
    expect(seen.method).toBe("GET")
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/export-plan`)

    await callTool(server, "plan_studio_export", { production_id: PRODUCTION, upscale: true })
    // The 4K pass is expensive, so it is never implied by an absent argument.
    expect(seen.url).toContain("upscale=true")
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

describe("edit_studio_production", () => {
  it("forwards the batch untouched and maps `expected_version` onto the base it is", async () => {
    const { server, seen } = serverWith(ALL)
    // Deliberately not real operation names: this layer never inspects one, and
    // the vocabulary belongs to the served operating guide, not to a fixture here.
    const ops = [{ op: "example", target: "s1" }, { op: "another", target: "s2" }]
    const res = await callTool(server, "edit_studio_production", {
      production_id: PRODUCTION,
      ops,
      expected_version: 3,
      strict: true,
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/ops`)
    // Untouched: this layer never inspects an operation, so the array that
    // arrived is the array that goes out, in order.
    expect(seen.body?.ops).toEqual(ops)
    expect(seen.body).toMatchObject({ baseVersion: 3, strict: true, mcp_client: "Claude" })
    expect(res.structuredContent).toMatchObject({ version: 4, rebased: false })
  })

  it("surfaces WHICH operation was refused, and that nothing was written", async () => {
    // A batch is atomic, so "operation 2, and why" is the answer; the generic
    // renderer reads only `code` and `message` and would drop the index.
    h.routeFailure = {
      status: 400,
      body: { error: { code: "op_invalid", message: "unknown shot", opIndex: 2 } },
    }
    const { server } = serverWith(ALL)
    const res = await callTool(server, "edit_studio_production", {
      production_id: PRODUCTION,
      ops: [{ op: "example", target: "nope" }],
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("op_invalid")
    expect(res.content[0].text).toContain("unknown shot")
    expect(res.content[0].text).toContain("operation 2")
    expect(res.content[0].text).toContain("nothing was written")
  })

  it("refuses an empty batch at the schema", async () => {
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "edit_studio_production", {
      production_id: PRODUCTION,
      ops: [],
    })
    expect(res.isError).toBe(true)
    expect(seen.url).toBeUndefined()
  })
})

describe("share_studio_production", () => {
  it("sends the wanted audience to the one route that owns it", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "share_studio_production", {
      production_id: PRODUCTION,
      shared: false,
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/share`)
    // `false` is a value, not an absence: un-sharing goes through the same door
    // as sharing, so an omitted key would silently publish nothing back.
    expect(seen.body).toMatchObject({ shared: false })
  })
})

describe("clone_studio_production", () => {
  it("copies, with a name only when one was given", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "clone_studio_production", { production_id: PRODUCTION })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/clone`)
    expect(seen.body).not.toHaveProperty("name")

    await callTool(server, "clone_studio_production", { production_id: PRODUCTION, name: "Take 2" })
    expect(seen.body).toMatchObject({ name: "Take 2" })
  })
})

describe("the tools that spend", () => {
  it("describe posts the brief and the model the run needs", async () => {
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "describe_studio_production", {
      production_id: PRODUCTION,
      brief: "A chase in Rome.",
      llm_model: "claude-fable-5",
      mode: "replace",
      label: "Rome",
      client_request_id: "retry-token-1",
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/describe`)
    expect(seen.body).toMatchObject({
      brief: "A chase in Rome.",
      llmModel: "claude-fable-5",
      mode: "replace",
      label: "Rome",
      clientRequestId: "retry-token-1",
      mcp_client: "Claude",
    })
    expect(res.structuredContent).toMatchObject({ jobId: JOB })
  })

  it("the two generate tools are one route, told which kind to run", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "generate_studio_still", {
      production_id: PRODUCTION,
      shot_id: "s1",
      count: 3,
      overrides: { provider: "cheap-model" },
      dry_run: true,
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/generate`)
    expect(seen.body).toMatchObject({
      kind: "still",
      shotId: "s1",
      count: 3,
      overrides: { provider: "cheap-model" },
      dryRun: true,
    })

    await callTool(server, "generate_studio_clip", {
      production_id: PRODUCTION,
      shot_id: "s1",
      mode: "references",
    })
    expect(seen.body).toMatchObject({ kind: "clip", shotId: "s1", mode: "references" })
    // A lane is chosen from the inputs unless one was forced, so an absent
    // `mode` must not become a default here.
    expect(seen.body).not.toHaveProperty("dryRun")
  })

  it("carries an explicitly reviewed retake without rebuilding its inputs", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "generate_studio_clip", {
      production_id: PRODUCTION, shot_id: "AB", retake_result_key: "job:original",
      expected_input_hash: "a".repeat(64), client_request_id: "retake-click",
    })
    expect(seen.calls).toHaveLength(1)
    expect(seen.body).toEqual({ mcp_client: "Claude", userId: "u1", kind: "clip", shotId: "AB", retakeResultKey: "job:original",
      expectedInputHash: "a".repeat(64), clientRequestId: "retake-click" })
  })

  it("generates one planned frame with its reviewed revision and retry token", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "generate_studio_keyframe", {
      production_id: PRODUCTION, keyframe_id: "frame-A", expected_revision: 2,
      overrides: { resolution: "2K" }, client_request_id: "frame-attempt-1",
    })
    expect(seen.calls).toHaveLength(1)
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/generate`)
    expect(seen.body).toMatchObject({ kind: "keyframe", keyframeId: "frame-A", expectedRevision: 2,
      overrides: { resolution: "2K" }, clientRequestId: "frame-attempt-1" })
    expect(seen.body).not.toHaveProperty("dryRun")
    expect(seen.body).not.toHaveProperty("count")
  })

  it.each([{ expected_revision: 0 }, { expected_revision: 1, dry_run: true }, {}])("refuses an unreviewed revision or unsupported quote before dispatch: %j", async (extra) => {
    const { server, seen } = serverWith(ALL)
    const result = await callTool(server, "generate_studio_keyframe", {
      production_id: PRODUCTION, keyframe_id: "frame-A", ...extra,
    })
    expect(result.isError).toBe(true)
    expect(seen.calls).toHaveLength(0)
  })

  it("a frame grab names what to do with the frame", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "new_studio_shot_from_frame", {
      production_id: PRODUCTION,
      shot_id: "s1",
      mode: "timestamp",
      timestamp: 2.5,
      target: "end-frame",
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/frame`)
    expect(seen.body).toMatchObject({
      shotId: "s1",
      mode: "timestamp",
      timestamp: 2.5,
      target: "end-frame",
    })
  })

  it("voice sends the line, revoice sends the plan, score sends the prompt", async () => {
    const { server, seen } = serverWith(ALL)
    await callTool(server, "voice_studio_shot", {
      production_id: PRODUCTION,
      shot_id: "s1",
      text: "We are late.",
      voice_id: "v1",
      delivery: { speed: 1.1 },
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/voice`)
    expect(seen.body).toMatchObject({
      shotId: "s1",
      text: "We are late.",
      voiceId: "v1",
      delivery: { speed: 1.1 },
    })

    await callTool(server, "revoice_studio_clip", {
      production_id: PRODUCTION,
      shot_id: "s1",
      plan: { speakers: [] },
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/revoice`)
    expect(seen.body).toMatchObject({ shotId: "s1", plan: { speakers: [] } })

    await callTool(server, "score_studio_production", {
      production_id: PRODUCTION,
      prompt: "Slow strings.",
      duration: 40,
      instrumental: true,
    })
    expect(seen.url).toBe(`/v1/studio/productions/${PRODUCTION}/music`)
    expect(seen.body).toMatchObject({
      prompt: "Slow strings.",
      duration: 40,
      instrumental: true,
    })
  })

  it("every spending tool carries the caller's retry token as the route names it", async () => {
    // A dropped connection on a call that spends must not be able to charge
    // twice, and the token is the only thing that can say so.
    const { server, seen } = serverWith(ALL)
    for (const [name, args] of [
      ["generate_studio_still", { shot_id: "s1" }],
      ["generate_studio_keyframe", { keyframe_id: "frame-A", expected_revision: 1 }],
      ["generate_studio_clip", { shot_id: "s1" }],
      ["new_studio_shot_from_frame", { shot_id: "s1" }],
      ["voice_studio_shot", { shot_id: "s1", text: "hi there" }],
      ["revoice_studio_clip", { shot_id: "s1", plan: {} }],
      ["score_studio_production", { prompt: "strings" }],
      ["describe_studio_production", { brief: "a film", llm_model: "m" }],
    ] as Array<[string, Record<string, unknown>]>) {
      await callTool(server, name, {
        production_id: PRODUCTION,
        ...args,
        client_request_id: "retry-token-1",
      })
      expect(seen.body, name).toMatchObject({ clientRequestId: "retry-token-1" })
    }
  })

  it("passes a route's refusal on in the route's own words", async () => {
    h.routeFailure = {
      status: 402,
      body: { error: { code: "insufficient_credits", message: "Not enough credits" } },
    }
    const { server } = serverWith(ALL)
    const res = await callTool(server, "generate_studio_still", {
      production_id: PRODUCTION,
      shot_id: "s1",
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("insufficient credits")
  })
})

describe("a deployment that does not serve the family", () => {
  it("renders the router's own 404 as `not_available`, not as a bad request", async () => {
    // The router's body has no `error.code`, so the shared renderer would call
    // it "invalid request" and send a model round a repair loop for a document
    // that was never the problem.
    const server = buildServer()
    const empty = Fastify()
    registerStudioProductionTools({
      server,
      session: newSession({ userId: "u1", scopes: ALL, clientName: "Claude" }),
      fastify: empty,
    })
    const res = await callTool(server, "list_studio_productions", {})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_available")
    expect(res.content[0].text).toContain("Nodaro Cloud")
  })

  it("says the same on a write and on a spend", async () => {
    const server = buildServer()
    const empty = Fastify()
    registerStudioProductionTools({
      server,
      session: newSession({ userId: "u1", scopes: ALL, clientName: "Claude" }),
      fastify: empty,
    })
    for (const [name, args] of [
      ["create_studio_production", {}],
      ["edit_studio_production", { production_id: PRODUCTION, ops: [{ op: "example" }] }],
      ["generate_studio_clip", { production_id: PRODUCTION, shot_id: "s1" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await callTool(server, name, args)
      expect(res.isError, name).toBe(true)
      expect(res.content[0].text, name).toContain("not_available")
    }
  })

  it("a REAL 404 from the family keeps its own code", async () => {
    // Otherwise "this production does not exist" and "this deployment does not
    // serve productions" would read identically, and only one of them is worth
    // giving up on.
    h.routeFailure = {
      status: 404,
      body: { error: { code: "not_found", message: "Production not found" } },
    }
    const { server, seen } = serverWith(ALL)
    const res = await callTool(server, "get_studio_production", { production_id: PRODUCTION })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("not_found")
    expect(res.content[0].text).not.toContain("not_available")
    // The refusal came from the READ: the landing call before it succeeded.
    expect(seen.calls.map((c) => c.method)).toEqual(["POST", "GET"])
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
    // The whole point: the tool asks a route, and the route is what makes the
    // read the CALLER's. The owner header is that scoping — without it the
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
  // one place an agent actually reads — this tool's description — has to say
  // it plainly. (The operating guide says it too; that copy is served at
  // runtime and is checked against this family by the acceptance script
  // `backend/scripts/check-operating-skill-names.ts`.)
  const description = async (name: string): Promise<string> => {
    const tools = await listTools(serverWith(ALL).server)
    return tools.find((t) => t.name === name)?.description ?? ""
  }

  it("import_studio_production tells the caller to have the user reload the editor", async () => {
    const text = await description("import_studio_production")
    expect(text).toMatch(/reload/i)
    expect(text).toMatch(/editor/i)
  })

  it("create_studio_production does not — a production that does not exist yet is open nowhere", async () => {
    expect(await description("create_studio_production")).not.toMatch(/reload/i)
  })
})

describe("the landing contract", () => {
  /**
   * A generation over MCP finishes in TWO places, and only the first is
   * obvious: the job completes (and `get_job` says so, with a CDN url), and
   * then the result has to be written into the production — which, by D5,
   * happens on the next `get_studio_production` and nowhere else.
   *
   * A user drove the studio over MCP on 2026-09-09, polled `wait_for_job`
   * until three stills reported `completed` with urls, and saw an empty film:
   * every step they took reported success and none of them landed anything.
   * The guide says so under a heading nobody reads before they need it, so
   * this suite pins the two places a client that never opens the guide DOES
   * read — the answer it just got, and the description of the tool it is
   * about to call.
   */
  const description = async (name: string): Promise<string> => {
    const tools = await listTools(serverWith(ALL).server)
    return tools.find((t) => t.name === name)?.description ?? ""
  }

  /** The tools that answer with a job id and leave a marker behind. */
  const MARKER_TOOLS: Array<[string, Record<string, unknown>]> = [
    ["describe_studio_production", { brief: "A chase in Rome.", llm_model: "claude-fable-5" }],
    ["generate_studio_still", { shot_id: "s1" }],
    ["generate_studio_keyframe", { keyframe_id: "frame-A", expected_revision: 1 }],
    ["generate_studio_clip", { shot_id: "s1" }],
    ["revoice_studio_clip", { shot_id: "s1", plan: {} }],
    ["score_studio_production", { prompt: "strings" }],
  ]

  it.each(MARKER_TOOLS)(
    "%s answers with the step that lands what it started",
    async (name, args) => {
      const { server } = serverWith(ALL)
      const res = await callTool(server, name, { production_id: PRODUCTION, ...args })
      const landing = (res.structuredContent as { landing?: unknown }).landing
      expect(landing, `${name} handed back a job id and no way to land it`).toEqual(
        expect.stringContaining("get_studio_production"),
      )
      // And it says the thing the user actually got wrong: that the job tools
      // report status and write nothing.
      expect(landing).toEqual(expect.stringContaining("get_job"))
      expect(landing).toEqual(expect.stringContaining("wait_for_job"))
      // The answer's own text carries it too — a client reading the rendered
      // result rather than `structuredContent` is the common one.
      expect(res.content[0].text).toContain("get_studio_production")
    },
  )

  it("says nothing when the call only PRICED the run — a quote starts nothing", async () => {
    const { server } = serverWith(ALL)
    const res = await callTool(server, "generate_studio_still", {
      production_id: PRODUCTION,
      shot_id: "s1",
      dry_run: true,
    })
    expect(res.structuredContent).toMatchObject({ dryRun: true })
    expect(res.structuredContent).not.toHaveProperty("landing")
  })

  it("says nothing when the route already applied the result — nothing is pending", async () => {
    // `new_studio_shot_from_frame` waits inside the call and answers with the
    // production itself. There is no job to land, so a line telling the caller
    // to go and land one would be a step that does nothing.
    const { server } = serverWith(ALL)
    const res = await callTool(server, "new_studio_shot_from_frame", {
      production_id: PRODUCTION,
      shot_id: "s1",
    })
    expect(res.structuredContent).not.toHaveProperty("landing")
  })

  it.each(MARKER_TOOLS.map(([name]) => name))(
    "%s's own description names the read that lands it",
    async (name) => {
      const text = await description(name)
      expect(text).toContain("get_studio_production")
      // "lands by itself" was the phrasing that made three finished images
      // look like a studio bug. Nothing lands by itself over MCP.
      expect(text).not.toMatch(/by (itself|themselves)/i)
    },
  )

  it("the read says out loud that reading is what WRITES", async () => {
    const text = await description("get_studio_production")
    expect(text).toMatch(/get_job/)
    expect(text).toMatch(/wait_for_job/)
  })
})
