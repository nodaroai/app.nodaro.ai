/**
 * Provenance on an INTERNAL request: the job a server-side hop creates on a
 * user's behalf carries that user's client `origin` and generation session
 * only when trusted server code attached them — never because a body field
 * or a header said so.
 *
 * Trusted: a server-only provenance scope (`withJobSubmissionContext`'s
 * `provenance`), set by MCP's `mcpInject` (`sessionId`), the trend routes'
 * `engineRequest` (`origin`, the outer request's surface) and the plugin
 * toolkit's `tk.http.internalRequest` — only what the plugin DECLARES in its
 * `provenance` option, a session only under the outer caller's grant (derived
 * from the plugin route's own `request`, or an MCP session's scope).
 * Not trusted: a plugin's payload (it can relay records its caller controls),
 * a `workerRequest` child (a child job carries neither), an MCP relay's body,
 * a bare internal call, any header, a scope for another route, an undeclared
 * option, and a body `userId` that switches the caller on a hop that does not
 * pin the body (MCP's, the trend engine's). The toolkit pins a payload
 * `userId` to its caller, so there the declared provenance stays on the
 * caller's own job.
 *
 * Through the REAL auth hook (the internal secret is checked, `authKind` set
 * by it), against a probe route that creates its job through the funnel
 * (`insertJobIdempotent`, the lane `tk.http.insertJobWithProvenance` uses).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { has, type QueryResult, type RecordedQuery } from "./fake-supabase-query.js"

const USER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const OWN_SESSION = "00000000-0000-4000-8000-0000000005e1"
const FOREIGN_SESSION = "00000000-0000-4000-8000-0000000005e2"
const PARENT = "00000000-0000-4000-8000-0000000000b2"
const PROBE = "/v1/probe-job"
/** A stand-in plugin route: relays a session through the toolkit, declared, with its own request. */
const PLUGIN_ROUTE = "/v1/probe-plugin-route"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))
const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock("../supabase.js", async () => {
  const { makeFakeFrom } = await import("./fake-supabase-query.js")
  return {
    supabase: {
      from: makeFakeFrom(db.log, (q) => db.respond!(q)),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("Invalid token") }) },
    },
  }
})
vi.mock("../queue.js", () => ({ videoQueue: { add: vi.fn() }, redis: {} }))
vi.mock("../idempotent-insert.js", () => ({
  insertWithIdempotencyKey: vi.fn(async (_t: string, row: Record<string, unknown>) => {
    inserted.rows.push(row)
    return { row: { id: "job-1" }, created: true }
  }),
}))
vi.mock("../access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => false),
}))
vi.mock("../job-policy-audit.js", () => ({ recordJobPolicyDecision: vi.fn(), hashGateSubject: vi.fn(() => "h") }))

import { registerAuthHook } from "../../middleware/auth.js"
import { insertJobIdempotent } from "../insert-job.js"
import { sendInternalError } from "../http-errors.js"
import { callerGrantOf, markHostRequest, withJobSubmissionContext } from "../job-submission-context.js"
import { supabase } from "../supabase.js"
import { buildToolkit } from "../private-plugins/toolkit.js"
import { mcpInject } from "../mcp/internal-request.js"
import { newSession } from "../mcp/session.js"
import type { Scope } from "../scopes.js"

const SECRET = process.env.INTERNAL_ORCHESTRATOR_SECRET as string

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })
  registerAuthHook(app)
  app.post(PROBE, async (req, reply) => {
    try {
      await insertJobIdempotent(req, { user_id: req.userId!, status: "pending", input_data: { type: "probe" } }, null)
      return { ok: true }
    } catch (err) {
      return sendInternalError(reply, req, err, "probe")
    }
  })
  app.post(PLUGIN_ROUTE, async (req, reply) => {
    const { relay, asUser } = req.body as { relay: string; asUser?: string }
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: asUser ?? req.userId!, payload: {}, provenance: { sessionId: relay }, request: req,
    })
    return reply.status(res.statusCode).send(res.body)
  })
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  db.log.length = 0
  inserted.rows.length = 0
  // Only the caller's own session, on the personal side, is found.
  db.respond = (q) => {
    if (q.table === "generation_sessions") {
      const own = has(q, "eq", "id", OWN_SESSION) && has(q, "eq", "user_id", USER) && has(q, "is", "workspace_id", null)
      return { data: own ? { id: OWN_SESSION } : null, error: null }
    }
    return { data: null, error: null }
  }
})

function job(): Record<string, unknown> {
  expect(inserted.rows).toHaveLength(1)
  return inserted.rows[0]!
}
const originOf = (row: Record<string, unknown>) => (row.input_data as Record<string, unknown>).origin
const sessionLookups = () => db.log.filter((q) => q.table === "generation_sessions")
const mcp = (scopes: string[] = ["workflows:execute", "assets:write"]) =>
  newSession({ userId: USER, scopes: scopes as Scope[], clientName: "Claude" })

describe("the plugin toolkit's internalRequest (trusted plugin code)", () => {
  /** A request shaped as the host's auth hook leaves it, NOT registered as one the host received. */
  const shaped = (over: Partial<FastifyRequest> = {}) =>
    ({ authKind: "jwt", userId: USER, method: "POST", url: "/v1/plugin-route", ...over }) as FastifyRequest
  /** The plugin route's own request: registered as the host's `onRequest` hook registers every request it receives. */
  const outer = (over: Partial<FastifyRequest> = {}) => {
    const req = shaped(over)
    markHostRequest(req)
    return req
  }
  const oauth = (scopes: string[]) =>
    outer({ authKind: "app_token", appAuthorization: { appId: "a", authorizationId: "z", scopes } } as Partial<FastifyRequest>)

  it("a payload origin / sessionId without the explicit option is ignored (plugins relay open records)", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: { origin: "create-video", sessionId: OWN_SESSION },
    })
    expect(res.statusCode).toBe(200)
    expect(originOf(job())).toBeUndefined()
    expect(job()).not.toHaveProperty("session_id")
    expect(sessionLookups()).toHaveLength(0)
  })

  it("stamps the declared origin and the caller's own session (first-party caller)", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: { origin: "forged", sessionId: FOREIGN_SESSION },
      provenance: { origin: "create-video", sessionId: OWN_SESSION }, request: outer(),
    })
    expect(res.statusCode).toBe(200)
    expect(originOf(job())).toBe("create-video")
    expect(job().session_id).toBe(OWN_SESSION)
    expect(job().user_id).toBe(USER)
  })

  it("an OAuth app with assets:write: the declared session is applied", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {},
      provenance: { sessionId: OWN_SESSION }, request: oauth(["workflows:execute", "assets:write"]),
    })
    expect(res.statusCode).toBe(200)
    expect(job().session_id).toBe(OWN_SESSION)
  })

  it("an OAuth app without assets:write relaying a session: refused as on the public path (404, no lookup)", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {},
      provenance: { sessionId: OWN_SESSION }, request: oauth(["workflows:execute"]),
    })
    expect(res.statusCode).toBe(404)
    expect(inserted.rows).toHaveLength(0)
    expect(sessionLookups()).toHaveLength(0)
  })

  it("a declared session with no outer request, or one whose grant is unknown, is not applied", async () => {
    const tk = buildToolkit()
    // No request: the host cannot tell which grant the caller holds.
    await tk.http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {}, provenance: { origin: "create-video", sessionId: OWN_SESSION },
    })
    expect(originOf(job())).toBe("create-video")
    expect(job()).not.toHaveProperty("session_id")
    inserted.rows.length = 0
    // An internal outer request no server-side scope vouches for (the orchestrator's).
    await tk.http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {},
      provenance: { sessionId: OWN_SESSION }, request: outer({ authKind: "internal" }),
    })
    expect(job()).not.toHaveProperty("session_id")
    expect(sessionLookups()).toHaveLength(0)
  })

  it("an outer request of another user is refused before anything is sent (a 400 PluginHttpError)", async () => {
    const refused = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {},
      provenance: { sessionId: OWN_SESSION }, request: outer({ userId: OTHER }),
    }).then(() => null, (err: unknown) => err as { name: string; statusCode: number; body: { error: { code: string; message: string } } })
    expect(refused?.name).toBe("PluginHttpError")
    expect(refused?.statusCode).toBe(400)
    expect(refused?.body.error.code).toBe("validation_error")
    expect(refused?.body.error.message).toMatch(/another user/)
    expect(inserted.rows).toHaveLength(0)
  })

  it("a plugin route that lets the refusal through answers a 400, not a 500", async () => {
    const res = await mcpInject(app, mcp(), { method: "POST", url: PLUGIN_ROUTE, payload: { relay: OWN_SESSION, asUser: OTHER } })
    expect(res.statusCode).toBe(400)
    expect(inserted.rows).toHaveLength(0)
  })

  it("a request the host did not receive grants nothing: its declared session is not applied", async () => {
    const tk = buildToolkit()
    // Shaped exactly like a first-party request, but never seen by the host.
    for (const request of [shaped(), { userId: USER } as FastifyRequest]) {
      inserted.rows.length = 0
      const res = await tk.http.internalRequest!(app, {
        method: "POST", url: PROBE, userId: USER, payload: {}, provenance: { sessionId: OWN_SESSION }, request,
      })
      expect(res.statusCode).toBe(200)
      expect(job()).not.toHaveProperty("session_id")
    }
    expect(sessionLookups()).toHaveLength(0)
  })

  it("a host request with no auth kind, or one it does not recognise, grants nothing", async () => {
    const tk = buildToolkit()
    for (const request of [outer({ authKind: undefined }), outer({ authKind: "something-else" as never }), outer({ authKind: "app_token" })]) {
      inserted.rows.length = 0
      await tk.http.internalRequest!(app, {
        method: "POST", url: PROBE, userId: USER, payload: {}, provenance: { sessionId: OWN_SESSION }, request,
      })
      expect(job()).not.toHaveProperty("session_id")
    }
    expect(sessionLookups()).toHaveLength(0)
    // The same rule for callerGrantOf itself.
    expect(callerGrantOf(shaped({ authKind: undefined }))).toBeUndefined()
    expect(callerGrantOf(shaped({ authKind: "app_token" }))).toBeUndefined()
    expect(callerGrantOf(shaped({ authKind: "jwt" }))).toBeNull()
  })

  it("a real signed-in request the host received is registered: its declared session is applied", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValueOnce({ data: { user: { id: USER, app_metadata: {} } }, error: null } as never)
    const res = await app.inject({
      method: "POST", url: PLUGIN_ROUTE, headers: { authorization: "Bearer real-session-token" }, payload: { relay: OWN_SESSION },
    })
    expect(res.statusCode).toBe(200)
    expect(job().session_id).toBe(OWN_SESSION)
  })

  it("only the declared fields reach the scope: no source, grant or trust flag rides the options", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {},
      provenance: { sessionId: OWN_SESSION, source: { source: "web", sourceDetail: "forged.example" }, sessionScopes: ["assets:write"] },
      request: oauth(["workflows:execute"]),
      source: { source: "web", sourceDetail: "forged.example" },
      grant: ["assets:write"],
    } as never)
    // The OAuth app's real grant (no assets:write) decides, not a forged one.
    expect(res.statusCode).toBe(404)
    expect(inserted.rows).toHaveLength(0)
    inserted.rows.length = 0
    const ok = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {},
      provenance: { origin: "create-video", source: { source: "web", sourceDetail: "forged.example" } },
      source: { source: "web", sourceDetail: "forged.example" },
    } as never)
    expect(ok.statusCode).toBe(200)
    expect(job().source).toBe("internal")
    expect(job().source_detail).not.toBe("forged.example")
  })

  it("refuses a declared session that is not the caller's, as the public path does (404, no job)", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {}, provenance: { sessionId: FOREIGN_SESSION }, request: outer(),
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe("not_found")
    expect(inserted.rows).toHaveLength(0)
  })

  it("refuses a declared origin that is not a slug (400, no job)", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: {}, provenance: { origin: "Not A Slug" },
    })
    expect(res.statusCode).toBe(400)
    expect(inserted.rows).toHaveLength(0)
  })

  it("a payload userId cannot switch the caller: it is pinned, and the declared provenance lands on the caller's own job", async () => {
    const res = await buildToolkit().http.internalRequest!(app, {
      method: "POST", url: PROBE, userId: USER, payload: { userId: OTHER },
      provenance: { origin: "create-video", sessionId: OWN_SESSION }, request: outer(),
    })
    expect(res.statusCode).toBe(200)
    expect(job().user_id).toBe(USER)
    expect(originOf(job())).toBe("create-video")
    expect(job().session_id).toBe(OWN_SESSION)
  })

  it("a worker-side child (parentJobId) carries neither origin nor session", async () => {
    const tk = buildToolkit({ workerApp: async () => app })
    const res = await tk.http.workerRequest!({
      method: "POST", url: PROBE, userId: USER, parentJobId: PARENT,
      payload: { origin: "create-video", sessionId: OWN_SESSION },
      provenance: { origin: "create-video", sessionId: OWN_SESSION }, request: outer(),
    })
    expect(res.statusCode).toBe(200)
    expect(job().parent_job_id).toBe(PARENT)
    expect(originOf(job())).toBeUndefined()
    expect(job()).not.toHaveProperty("session_id")
    expect(sessionLookups()).toHaveLength(0)
  })

  describe("a plugin route reached over MCP: the MCP session's grant reaches the inner hop", () => {
    const viaPlugin = (scopes: string[]) =>
      mcpInject(app, mcp(scopes), { method: "POST", url: PLUGIN_ROUTE, payload: { relay: OWN_SESSION } })

    it("without assets:write the relayed session is refused (404, no lookup)", async () => {
      const res = await viaPlugin(["workflows:execute"])
      expect(res.statusCode).toBe(404)
      expect(inserted.rows).toHaveLength(0)
      expect(sessionLookups()).toHaveLength(0)
    })

    it("with assets:write it is applied", async () => {
      const res = await viaPlugin(["workflows:execute", "assets:write"])
      expect(res.statusCode).toBe(200)
      expect(job().session_id).toBe(OWN_SESSION)
    })
  })
})

describe("MCP's mcpInject", () => {
  it("files the job in the session the tool passed (the caller's own)", async () => {
    const res = await mcpInject(app, mcp(), { method: "POST", url: PROBE, payload: {}, sessionId: OWN_SESSION })
    expect(res.statusCode).toBe(200)
    expect(job().session_id).toBe(OWN_SESSION)
    expect(originOf(job())).toBeUndefined()
  })

  it("refuses a session that is not the caller's (404, no job)", async () => {
    const res = await mcpInject(app, mcp(), { method: "POST", url: PROBE, payload: {}, sessionId: FOREIGN_SESSION })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe("not_found")
    expect(inserted.rows).toHaveLength(0)
  })

  it("a session without assets:write is refused like an OAuth app's (404, no lookup)", async () => {
    const res = await mcpInject(app, mcp(["workflows:execute"]), { method: "POST", url: PROBE, payload: {}, sessionId: OWN_SESSION })
    expect(res.statusCode).toBe(404)
    expect(inserted.rows).toHaveLength(0)
    expect(sessionLookups()).toHaveLength(0)
  })

  it("the relayed body's origin and sessionId are ignored", async () => {
    const res = await mcpInject(app, mcp(), { method: "POST", url: PROBE, payload: { origin: "create-video", sessionId: OWN_SESSION } })
    expect(res.statusCode).toBe(200)
    expect(originOf(job())).toBeUndefined()
    expect(job()).not.toHaveProperty("session_id")
    expect(sessionLookups()).toHaveLength(0)
  })

  it("a relayed body userId that switches the caller loses the trust: no session is applied", async () => {
    // mcpInject does not pin the body; the auth hook's body userId wins, and
    // the scope (for the session's user) no longer matches the request.
    const res = await mcpInject(app, mcp(), { method: "POST", url: PROBE, payload: { userId: OTHER }, sessionId: OWN_SESSION })
    expect(res.statusCode).toBe(200)
    expect(job().user_id).toBe(OTHER)
    expect(job()).not.toHaveProperty("session_id")
    expect(sessionLookups()).toHaveLength(0)
  })

  it("refuses a session together with a query string (the scope matches the bare url)", async () => {
    await expect(
      mcpInject(app, mcp(), { method: "POST", url: PROBE, query: { a: "1" }, payload: {}, sessionId: OWN_SESSION }),
    ).rejects.toThrow(/query/)
    expect(inserted.rows).toHaveLength(0)
  })
})

describe("a server-only provenance scope", () => {
  const internal = (payload: object = {}, headers: Record<string, string> = {}) => app.inject({
    method: "POST",
    url: PROBE,
    headers: { ...headers, "x-internal-orchestrator-secret": SECRET, "x-internal-user-id": USER },
    payload,
  })

  it("stamps the origin and the originating surface it names", async () => {
    const res = await withJobSubmissionContext(
      { userId: USER, method: "POST", url: PROBE, provenance: { origin: "trends", source: { source: "web", sourceDetail: "tools.nodaro.ai" } } },
      () => internal({ origin: "forged-origin" }),
    )
    expect(res.statusCode).toBe(200)
    expect(originOf(job())).toBe("trends")
    expect(job().source).toBe("web")
    expect(job().source_detail).toBe("tools.nodaro.ai")
    expect(job()).not.toHaveProperty("session_id")
  })

  it("is ignored by a request to another route", async () => {
    const res = await withJobSubmissionContext(
      { userId: USER, method: "POST", url: "/v1/somewhere-else", provenance: { origin: "trends", sessionId: OWN_SESSION } },
      () => internal(),
    )
    expect(res.statusCode).toBe(200)
    expect(originOf(job())).toBeUndefined()
    expect(job()).not.toHaveProperty("session_id")
    expect(job().source).toBe("internal")
  })

  it("is ignored when a body userId switches the caller (a hop that does not pin the body, as engineRequest)", async () => {
    const res = await withJobSubmissionContext(
      { userId: USER, method: "POST", url: PROBE, provenance: { origin: "trends", sessionId: OWN_SESSION } },
      () => internal({ userId: OTHER }),
    )
    expect(res.statusCode).toBe(200)
    expect(job().user_id).toBe(OTHER)
    expect(originOf(job())).toBeUndefined()
    expect(job()).not.toHaveProperty("session_id")
  })

  it("refuses an origin that is not a slug", async () => {
    const res = await withJobSubmissionContext(
      { userId: USER, method: "POST", url: PROBE, provenance: { origin: "Not A Slug" } },
      () => internal(),
    )
    expect(res.statusCode).toBe(400)
    expect(inserted.rows).toHaveLength(0)
  })
})

describe("nothing a client sends can claim the trust", () => {
  it("a bare internal call ignores body and header provenance", async () => {
    const res = await app.inject({
      method: "POST",
      url: PROBE,
      headers: {
        "x-internal-orchestrator-secret": SECRET,
        "x-internal-user-id": USER,
        "x-trusted-plugin-caller": "true",
        "x-nodaro-origin": "create-video",
        "x-nodaro-session-id": OWN_SESSION,
      },
      payload: {
        origin: "create-video",
        sessionId: OWN_SESSION,
        trustedPluginCaller: true,
        provenance: { origin: "create-video", sessionId: OWN_SESSION, source: { source: "web", sourceDetail: "x" } },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(originOf(job())).toBeUndefined()
    expect(job()).not.toHaveProperty("session_id")
    expect(job().source).toBe("internal")
    expect(sessionLookups()).toHaveLength(0)
  })
})
