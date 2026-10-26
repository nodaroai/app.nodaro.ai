import Fastify, { type FastifyInstance } from "fastify"
import { describe, expect, it, vi } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `estimate_full_quality` / `full_quality` — the MCP face of
 * `POST /v1/cast-swap/:jobId/full-quality(/estimate)` (Cloud plugin): a
 * finished Cast Swap or trend DRAFT re-rendered as the same take at 1080p.
 *
 * The contracts under test:
 *  - estimate_full_quality only quotes, and never runs;
 *  - full_quality without `confirm` quotes and never runs; with
 *    `confirm: true` it runs (once, without quoting again) and hands back the
 *    job id, saying so when the draft's Full Quality already existed;
 *  - a job id that is not an id (a slash, a dot segment) is refused before
 *    anything is sent;
 *  - a route refusal is a tool error, and only a router 404 (no error code)
 *    reads `not_available` — the route's own 404 `not_found` stays itself;
 *    `full_quality_pending` (it ends on its own) says to try again later;
 *  - `session_id` reaches the job through the server-side scope, never the
 *    body: the route files it in the caller's own session, and refuses one
 *    that is not theirs, or a grant without `assets:write`, as `cast_swap`'s
 *    route does;
 *  - registered only on Nodaro Cloud, for a session that may execute.
 *
 * The numbers are neutral on purpose: this repo is publicly mirrored.
 */
const h = vi.hoisted(() => ({ credits: true }))
const db = vi.hoisted(() => ({ ownSession: "" }))

vi.mock("../../../supabase.js", async () => {
  const { makeFakeFrom, has } = await import("../../../__tests__/fake-supabase-query.js")
  return {
    supabase: {
      // Only the caller's own session (user u1, personal side) is found.
      from: makeFakeFrom([], (q) => ({
        data: q.table === "generation_sessions" && has(q, "eq", "id", db.ownSession) && has(q, "eq", "user_id", "u1") && has(q, "is", "workspace_id", null)
          ? { id: db.ownSession }
          : null,
        error: null,
      })),
    },
  }
})
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => h.credits }
})

const { registerCastSwapFullQualityTools } = await import("../cast-swap-full-quality.js")
const { buildMcpServer } = await import("../../server.js")
const { resolveRequestSession } = await import("../../../generation-session-scope.js")
const { sendInternalError } = await import("../../../http-errors.js")
const { config } = await import("../../../config.js")

interface InjectCall {
  method?: string
  url?: string
  payload?: unknown
  headers?: Record<string, string>
}

/** A fastify stand-in answering one reply per exact URL, recording every call. */
function stubFastify(routes: Record<string, { statusCode: number; body: unknown }>) {
  const calls: InjectCall[] = []
  const fastify = {
    inject: async (opts: InjectCall) => {
      calls.push(opts)
      const res = routes[opts.url ?? ""]
      if (!res) return { statusCode: 404, body: JSON.stringify({ message: `Route POST:${opts.url} not found`, error: "Not Found" }) }
      return { statusCode: res.statusCode, body: typeof res.body === "string" ? res.body : JSON.stringify(res.body) }
    },
  } as unknown as FastifyInstance
  return { fastify, calls }
}

function serverWith(fastify: FastifyInstance, scopes: Scope[] = ["workflows:execute"]) {
  const server = buildServer()
  registerCastSwapFullQualityTools({ server, session: newSession({ userId: "u1", scopes, clientName: "test" }), fastify })
  return server
}

const QUOTE = { totalCredits: 12, breakdown: { base: 5, motionHd: 7 }, availableUntil: "2026-10-28T10:00:00.000Z" }
/** The same quote from an engine before 0.394.0 (the old key names), answered by the neutral ones. */
const OLD_QUOTE = { ...QUOTE, breakdown: { castSwap: 5, seedanceHd: 7 } }
const EST_URL = "/v1/cast-swap/draft-1/full-quality/estimate"
const RUN_URL = "/v1/cast-swap/draft-1/full-quality"

describe("estimate_full_quality", () => {
  it("quotes the draft and never runs", async () => {
    const { fastify, calls } = stubFastify({ [EST_URL]: { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${EST_URL}`])
    expect(res.structuredContent).toEqual(QUOTE)
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toContain("2026-10-28T10:00:00.000Z")
    expect(res.content[0]!.text).toMatch(/nothing was charged/i)
  })

  it("answers an older engine's old part names by their neutral ones", async () => {
    const { fastify } = stubFastify({ [EST_URL]: { statusCode: 200, body: OLD_QUOTE } })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.structuredContent).toEqual(QUOTE)
    expect(JSON.stringify(res.structuredContent)).not.toMatch(/seedance|Motion (Pro|Lite)\b/i)
  })

  it("reads the base fee from base, else castSwap (0.396.0 sends both, 0.397.0 base only), and answers base only", async () => {
    const bodies = [
      { ...QUOTE, breakdown: { castSwap: 5, motionHd: 7 } }, // castSwap only (before 0.396.0)
      { ...QUOTE, breakdown: { base: 5, motionHd: 7 } }, // base only (0.397.0)
      { ...QUOTE, breakdown: { base: 5, castSwap: 99, motionHd: 7 } }, // both (0.396.0): base wins
    ]
    for (const body of bodies) {
      const { fastify } = stubFastify({ [EST_URL]: { statusCode: 200, body } })
      const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
      expect(res.isError).toBeFalsy()
      expect(res.structuredContent).toEqual(QUOTE)
      expect(JSON.stringify(res.structuredContent)).not.toContain("castSwap")
    }
  })

  it("cannot read a quote with no base fee under either name", async () => {
    const { fastify } = stubFastify({ [EST_URL]: { statusCode: 200, body: { ...QUOTE, breakdown: { motionHd: 7 } } } })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toMatch(/could not be read/i)
  })

  it("words a Nodaro Motion Pulse new take as one, and passes its kind and every numeric part through", async () => {
    const newTake = { kind: "new-take", totalCredits: 420, breakdown: { castSwap: 40, kling: 380, note: "x" }, availableUntil: "2026-10-28T10:00:00.000Z" }
    const { fastify } = stubFastify({ [EST_URL]: { statusCode: 200, body: newTake } })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ ...newTake, breakdown: { base: 40, motion: 380 } })
    expect(res.content[0]!.text).toMatch(/new take/i)
    expect(res.content[0]!.text).toContain("420 credits")
    expect(res.content[0]!.text).not.toMatch(/reuse/i)
  })

  it("words a same take (or a quote with no kind, from an older engine) as the same take", async () => {
    for (const body of [QUOTE, { ...QUOTE, kind: "same-take" }]) {
      const { fastify } = stubFastify({ [EST_URL]: { statusCode: 200, body } })
      const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
      expect(res.content[0]!.text).toContain("the same take at 1080p")
      expect(res.structuredContent).toEqual(body)
    }
  })

  it("says when an earlier 1080p render is reused", async () => {
    const reused = { ...QUOTE, totalCredits: 5, breakdown: { base: 5, motionHd: 0 } }
    const { fastify } = stubFastify({ [EST_URL]: { statusCode: 200, body: reused } })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.content[0]!.text).toMatch(/reuse/i)
  })

  it("refuses a job id that is not an id, sending nothing", async () => {
    const { fastify, calls } = stubFastify({})
    for (const tool of ["estimate_full_quality", "full_quality"]) {
      const res = await callTool(serverWith(fastify), tool, { job_id: "a/../b?c", confirm: true })
      expect(res.isError).toBe(true)
    }
    expect(calls).toEqual([])
  })

  it("passes the route's own refusal back as a tool error", async () => {
    const { fastify } = stubFastify({
      [EST_URL]: { statusCode: 409, body: { error: { code: "not_a_draft", message: "Full Quality finishes a draft run." } } },
    })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("Full Quality finishes a draft run.")
  })

  it("says to try again later when the route answers full_quality_pending", async () => {
    const pending = { error: { code: "full_quality_pending", message: "An earlier try is still being finished.", retryable: true } }
    const { fastify } = stubFastify({ [EST_URL]: { statusCode: 409, body: pending }, [RUN_URL]: { statusCode: 409, body: pending } })
    for (const [tool, args] of [
      ["estimate_full_quality", { job_id: "draft-1" }],
      ["full_quality", { job_id: "draft-1" }],
      ["full_quality", { job_id: "draft-1", confirm: true }],
    ] as const) {
      const res = await callTool(serverWith(fastify), tool, args)
      expect(res.isError, `${tool} ${JSON.stringify(args)}`).toBe(true)
      expect(res.content[0]!.text).toContain("full_quality_pending")
      expect(res.content[0]!.text).toContain("An earlier try is still being finished.")
      expect(res.content[0]!.text).toMatch(/try again later/i)
    }
  })

  it("does not say to try again later for a final refusal", async () => {
    const { fastify } = stubFastify({
      [EST_URL]: { statusCode: 409, body: { error: { code: "full_quality_unavailable", message: "This run cannot be finished at full quality." } } },
    })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("full_quality_unavailable")
    expect(res.content[0]!.text).not.toMatch(/try again/i)
  })

  it("keeps the route's 404 not_found apart from a route that is not served", async () => {
    const { fastify } = stubFastify({
      [EST_URL]: { statusCode: 404, body: { error: { code: "not_found", message: "No Cast Swap run was found for that id." } } },
    })
    const res = await callTool(serverWith(fastify), "estimate_full_quality", { job_id: "draft-1" })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("No Cast Swap run was found")
    expect(res.content[0]!.text).not.toContain("not_available")
  })
})

describe("full_quality", () => {
  it("quotes without confirm and does not run", async () => {
    const { fastify, calls } = stubFastify({ [EST_URL]: { statusCode: 200, body: QUOTE } })
    const res = await callTool(serverWith(fastify), "full_quality", { job_id: "draft-1", session_id: "s-1" })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${EST_URL}`])
    expect(res.structuredContent).toEqual({ ...QUOTE, confirmed: false })
    expect(res.content[0]!.text).toContain("12 credits")
    expect(res.content[0]!.text).toContain("confirm: true")
    // The quote does not look for an existing Full Quality: the agent is told one is returned free.
    expect(res.content[0]!.text).toContain(
      "If this run already has a Full Quality job running or done, confirming returns it at no charge.",
    )
  })

  it("runs with confirm and returns the job, never putting the session in the body", async () => {
    const { fastify, calls } = stubFastify({ [RUN_URL]: { statusCode: 202, body: { jobId: "fq-9" } } })
    const res = await callTool(serverWith(fastify), "full_quality", { job_id: "draft-1", session_id: "s-1", confirm: true })

    expect(res.isError).toBeFalsy()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${RUN_URL}`])
    // An internal hop ignores a body `sessionId`; it rides the server-side scope (below).
    expect(calls[0]!.payload).toEqual({})
    expect(res.structuredContent).toEqual({ jobId: "fq-9", existing: false, confirmed: true })
    expect(res.content[0]!.text).toContain("fq-9")
    expect(res.content[0]!.text).toContain("wait_for_job")
  })

  it("sends an empty body without a session", async () => {
    const { fastify, calls } = stubFastify({ [RUN_URL]: { statusCode: 202, body: { jobId: "fq-9" } } })
    await callTool(serverWith(fastify), "full_quality", { job_id: "draft-1", confirm: true })
    expect(calls[0]!.payload).toEqual({})
  })

  it("says so when the draft's Full Quality already exists", async () => {
    const { fastify } = stubFastify({ [RUN_URL]: { statusCode: 200, body: { jobId: "fq-0", existing: true } } })
    const res = await callTool(serverWith(fastify), "full_quality", { job_id: "draft-1", confirm: true })

    expect(res.isError).toBeFalsy()
    expect(res.structuredContent).toEqual({ jobId: "fq-0", existing: true, confirmed: true })
    expect(res.content[0]!.text).toContain("fq-0")
    expect(res.content[0]!.text).toMatch(/already/i)
  })

  it("passes a refusal back as a tool error", async () => {
    const { fastify } = stubFastify({
      [RUN_URL]: { statusCode: 410, body: { error: { code: "draft_expired", message: "Full Quality is available for 7 days." } } },
    })
    const res = await callTool(serverWith(fastify), "full_quality", { job_id: "draft-1", confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("Full Quality is available for 7 days.")
  })

  it("answers not_available where the plugin's routes are not served", async () => {
    const { fastify } = stubFastify({})
    for (const confirm of [false, true]) {
      const res = await callTool(serverWith(fastify), "full_quality", { job_id: "draft-1", confirm })
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("not_available")
    }
  })

  it("neither tool is offered to a session that may not execute", async () => {
    const { fastify } = stubFastify({})
    const names = (await listTools(serverWith(fastify, ["workflows:read"]))).map((t) => t.name)
    expect(names).not.toContain("full_quality")
    expect(names).not.toContain("estimate_full_quality")
  })
})

describe("full_quality's session_id reaches the job", () => {
  const OWN = "00000000-0000-4000-8000-0000000005f1"
  const FOREIGN = "00000000-0000-4000-8000-0000000005f2"
  db.ownSession = OWN

  /**
   * A real app: the internal hop as the auth hook sets it, and a Full Quality
   * route that files its job through the funnel's session read, as the
   * plugin's does.
   */
  async function realApp(seen: { sessionId?: string | null; body?: unknown }) {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      if (req.headers["x-internal-orchestrator-secret"] === config.INTERNAL_ORCHESTRATOR_SECRET) {
        req.authKind = "internal"
        req.isInternalCall = true
        req.userId = req.headers["x-internal-user-id"] as string
      }
    })
    app.post("/v1/cast-swap/:jobId/full-quality", async (req, reply) => {
      seen.body = req.body
      try {
        seen.sessionId = await resolveRequestSession(req)
      } catch (err) {
        return sendInternalError(reply, req, err, "full quality")
      }
      return reply.status(202).send({ jobId: "fq-9" })
    })
    await app.ready()
    return app
  }

  it("files the Full Quality job in the caller's own session", async () => {
    const seen: { sessionId?: string | null; body?: unknown } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute", "assets:write"]), "full_quality", { job_id: "draft-1", session_id: OWN, confirm: true })
    expect(res.isError).toBeFalsy()
    expect(seen.sessionId).toBe(OWN)
    expect(seen.body).toEqual({})
    await app.close()
  })

  it("a session that is not the caller's is the route's 404, as a tool error", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute", "assets:write"]), "full_quality", { job_id: "draft-1", session_id: FOREIGN, confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(seen.sessionId).toBeUndefined()
    await app.close()
  })

  it("a grant without assets:write may not file it, even in the caller's own session: the route's 404, as cast_swap's", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app, ["workflows:execute"]), "full_quality", { job_id: "draft-1", session_id: OWN, confirm: true })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("not_found")
    expect(seen.sessionId).toBeUndefined()
    await app.close()
  })

  it("without session_id the job is filed in none", async () => {
    const seen: { sessionId?: string | null } = {}
    const app = await realApp(seen)
    const res = await callTool(serverWith(app), "full_quality", { job_id: "draft-1", confirm: true })
    expect(res.isError).toBeFalsy()
    expect(seen.sessionId).toBeNull()
    await app.close()
  })
})

describe("the Full Quality tools are gated on the edition", () => {
  async function names(credits: boolean) {
    h.credits = credits
    const server = await buildMcpServer({ userId: "u1", scopes: ["workflows:execute"], clientName: "Claude", fastify: Fastify() })
    return (await listTools(server)).map((t) => t.name)
  }

  it("are not registered without credits", async () => {
    const off = await names(false)
    expect(off).not.toContain("full_quality")
    expect(off).not.toContain("estimate_full_quality")
  })

  it("are registered on Nodaro Cloud", async () => {
    const on = await names(true)
    expect(on).toContain("full_quality")
    expect(on).toContain("estimate_full_quality")
  })
})
