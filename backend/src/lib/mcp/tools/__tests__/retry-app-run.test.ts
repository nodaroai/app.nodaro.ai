/**
 * MCP `retry_app_run` — the app's Retry of a failed run
 * (POST /v1/app/:slug/runs/:runId/resume): the body the tool sends, the dry
 * quote (price confirmation as render_final: quote first, run only with
 * `confirm: true`), the started Retry, and the way on after each refusal. One
 * case reaches the REAL route, whose body is strict: the user travels in
 * mcpInject's header, never in the body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

vi.mock("../../../supabase.js", () => {
  // Every read finds nothing: enough for the real route to answer "no such run".
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })
  return { supabase: { from: () => chain } }
})
vi.mock("../../../orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("../../../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config.js")>()),
  hasCredits: () => edition.credits,
}))

const { registerApps, retryRefusalNext } = await import("../apps.js")

const RUN = "33333333-3333-4333-8333-333333333333"
const session = () => newSession({ userId: "u1", scopes: ["workflows:execute"] as Scope[], clientName: "Claude" })

function register(fastify: FastifyInstance) {
  const server = buildServer()
  registerApps({ server, session: session(), fastify })
  return server
}

const QUOTE = {
  runId: RUN,
  continuesExecutionId: "ex-failed",
  appVersion: 3,
  nodeIds: ["clip", "join"],
  steps: [{ nodeId: "clip", type: "ugc-clip", label: "Clips" }, { nodeId: "join", type: "combine-videos", label: null }],
  estimatedCredits: 120,
  reusedClips: 2,
  sufficient: true,
  available: 900,
}

/** The resume route: the quote for a dryRun body, else `run` (status, answer). */
function stubRoute(run: [number, unknown] = [202, {}], quote: [number, unknown] = [200, { data: QUOTE }]) {
  const fastify = Fastify()
  const calls: Array<{ body: unknown; url: string; user: unknown }> = []
  fastify.post("/v1/app/:slug/runs/:runId/resume", async (req, reply) => {
    calls.push({ body: req.body, url: req.url, user: req.headers["x-internal-user-id"] })
    const [status, answer] = (req.body as { dryRun?: boolean } | undefined)?.dryRun ? quote : run
    return reply.status(status).send(answer)
  })
  return { fastify, calls }
}

beforeEach(() => {
  vi.clearAllMocks()
  edition.credits = true
})

describe("retry_app_run", () => {
  it("is registered under workflows:execute only", async () => {
    const withExec = await listTools(register(Fastify()))
    expect(withExec.map((t) => t.name)).toContain("retry_app_run")
    const server = buildServer()
    registerApps({ server, session: newSession({ userId: "u1", scopes: ["apps:read"] as Scope[], clientName: "Claude" }), fastify: Fastify() })
    expect((await listTools(server)).map((t) => t.name)).not.toContain("retry_app_run")
  })

  it("without confirm: the quote only — the steps and the price, nothing started", async () => {
    const { fastify, calls } = stubRoute()
    const result = await callTool(register(fastify), "retry_app_run", { slug: "my app", run_id: RUN })
    expect(result.isError).toBeUndefined()
    expect(calls).toEqual([{ body: { dryRun: true }, url: `/v1/app/my%20app/runs/${RUN}/resume`, user: "u1" }])
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("2 step(s) again (Clips, join)")
    expect(text).toContain("about 120 credits")
    expect(text).toContain("2 finished clip(s)")
    expect(text).toContain("confirm: true")
    expect(result.structuredContent).toMatchObject({ estimatedCredits: 120, confirmed: false })
  })

  it("a quote the balance cannot cover says so", async () => {
    const { fastify } = stubRoute(undefined, [200, { data: { steps: [], estimatedCredits: 50, reusedClips: 0, sufficient: false, available: 10 } }])
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN })
    expect(result.content[0]?.text).toContain("cannot cover it (10 available)")
  })

  it("a quote the app credits cannot cover names the app credits, not the balance", async () => {
    const { fastify } = stubRoute(undefined, [200, { data: { ...QUOTE, sufficient: false, available: 900, appCreditsAllowance: 0 } }])
    const text = (await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN })).content[0]?.text ?? ""
    expect(text).toContain("no app credits left")
    expect(text).not.toContain("900 available")
  })

  it("an edition without credits: not billed", async () => {
    edition.credits = false
    const { fastify } = stubRoute(undefined, [200, { data: { ...QUOTE, estimatedCredits: null, sufficient: null, available: null } }])
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN })
    expect(result.content[0]?.text).toContain("not billed in credits")
  })

  it("confirm: true quotes, then starts the Retry (sending version when given) and names its execution", async () => {
    const { fastify, calls } = stubRoute([202, { executionId: "ex-2", runId: RUN, status: "pending", nodeIds: ["clip"] }])
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN, version: 2, confirm: true })
    expect(calls.map((c) => c.body)).toEqual([{ dryRun: true, version: 2 }, { version: 2 }])
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain("execution ex-2")
    expect(result.content[0]?.text).toContain("get_app_run")
    expect(result.structuredContent).toEqual({ executionId: "ex-2", runId: RUN, status: "pending", nodeIds: ["clip"], estimatedCredits: 120, confirmed: true })
  })

  it("a concurrent second press is the same Retry", async () => {
    const { fastify } = stubRoute([200, { executionId: "ex-2", runId: RUN, status: "pending", nodeIds: [], deduped: true }])
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN, confirm: true })
    expect(result.content[0]?.text).toContain("already started")
    expect(result.structuredContent).toMatchObject({ deduped: true })
  })

  it("a refused quote runs nothing, even with confirm: the refusal plus both ways on after a version change", async () => {
    const { fastify, calls } = stubRoute(undefined, [
      409,
      {
        error: { code: "app_run_version_changed", message: "This run used version 2 of the app, which is now on version 3" },
        runVersion: 2,
        appVersion: 3,
      },
    ])
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN, confirm: true })
    expect(calls).toHaveLength(1)
    expect(result.isError).toBe(true)
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("app_run_version_changed")
    expect(text).toContain("run_app")
    expect(text).toContain(`retry_app_run({ slug: "a", run_id: "${RUN}", version: 2 })`)
  })

  it("a 402 keeps the route's own message (which allowance), not the generic credits line", async () => {
    const { fastify } = stubRoute([402, { error: { code: "insufficient_app_credits", message: "You have used this month's app credits." } }])
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN, confirm: true })
    expect(result.isError).toBe(true)
    const text = result.content[0]?.text ?? ""
    expect(text).toContain("402 insufficient_app_credits")
    expect(text).toContain("this month's app credits")
    expect(text).toContain("app credits cannot cover")
  })

  it("a run id that is no uuid is refused before any request", async () => {
    const { fastify, calls } = stubRoute()
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: "exec-1", confirm: true })
    expect(result.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it("reaches the real route: its strict body accepts what the tool sends (no such run → 404, not a 400)", async () => {
    const { appRunResumeRoutes } = await import("../../../../routes/app-run-resume.js")
    const fastify = Fastify()
    // The auth hook's part: the user from mcpInject's header.
    fastify.addHook("onRequest", async (req) => {
      req.userId = req.headers["x-internal-user-id"] as string
    })
    await fastify.register(appRunResumeRoutes)
    const result = await callTool(register(fastify), "retry_app_run", { slug: "a", run_id: RUN, version: 2, confirm: true })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("404 not_found")
    expect(result.content[0]?.text).not.toContain("validation_error")
  })
})

describe("retryRefusalNext", () => {
  it("a run that did not fail, or whose version is gone, is started over", () => {
    for (const code of ["continuation_not_failed", "app_run_version_unavailable"]) {
      expect(retryRefusalNext("a", RUN, { error: { code } })).toContain("run_app")
    }
  })
  it("a run still running is polled", () => {
    expect(retryRefusalNext("a", RUN, { error: { code: "already_running" }, executionId: "ex-live" })).toBe('Poll get_app_run({ execution_id: "ex-live" }) instead.')
  })
  it("a Retry that would stop at a Preview is sent to the app page", () => {
    expect(retryRefusalNext("a", RUN, { error: { code: "preview_review_required" } })).toContain("app page")
  })
  it("anything else adds nothing", () => {
    expect(retryRefusalNext("a", RUN, { error: { code: "locked_field" } })).toBeNull()
    expect(retryRefusalNext("a", RUN, {})).toBeNull()
  })
})
