/**
 * The request's generation session (`lib/generation-session-scope.ts`) and the
 * job funnel that stamps it (`lib/insert-job.ts`).
 *
 * The invariant: a job's `session_id` is ONLY ever the request's validated
 * session — the caller's own, on the request's side of the workspace line —
 * on every request lane; a caller-written `session_id` column is dropped; an
 * internal creator stamps none; a session the caller may not use refuses the
 * insert before any row exists and answers 404.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import { argOf, has, type QueryResult, type RecordedQuery } from "./fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const SESSION = "00000000-0000-4000-8000-0000000005e1"
const WORKSPACE = "00000000-0000-4000-8000-0000000000f1"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  sessionFound: true,
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))
const idempotent = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

vi.mock("../supabase.js", async () => {
  const { makeFakeFrom: make } = await import("./fake-supabase-query.js")
  return { supabase: { from: make(db.log, (q) => db.respond!(q)) } }
})
vi.mock("../idempotent-insert.js", () => ({
  insertWithIdempotencyKey: vi.fn(async (_t: string, row: Record<string, unknown>) => {
    idempotent.rows.push(row)
    return { row: { id: "job-1" }, created: true }
  }),
}))
vi.mock("../access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => false),
}))
vi.mock("../job-policy-audit.js", () => ({ recordJobPolicyDecision: vi.fn(), hashGateSubject: vi.fn(() => "h") }))

import {
  GenerationSessionNotFoundError,
  rawSessionIdOf,
  resolveRequestSession,
  withoutSessionColumn,
} from "../generation-session-scope.js"
import { insertInternalJob, insertJob, insertJobIdempotent, insertJobs } from "../insert-job.js"
import { sendInternalError } from "../http-errors.js"

function makeReq(body: unknown, extra: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/v1/generate-image",
    routeOptions: { url: "/v1/generate-image" },
    headers: {},
    body,
    userId: OWNER,
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    ...extra,
  } as unknown as FastifyRequest
}

function sessionLookups(): RecordedQuery[] {
  return db.log.filter((q) => q.table === "generation_sessions")
}
function jobInserts(): Record<string, unknown>[] {
  return db.log
    .filter((q) => q.table === "jobs" && argOf(q, "insert"))
    .flatMap((q) => {
      const rows = argOf(q, "insert")![0]
      return (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]
    })
}

beforeEach(() => {
  db.log.length = 0
  idempotent.rows.length = 0
  db.sessionFound = true
  db.respond = (q) => {
    if (q.table === "generation_sessions") {
      return { data: db.sessionFound ? { id: SESSION } : null, error: null }
    }
    if (q.table === "jobs" && argOf(q, "insert")) {
      const rows = argOf(q, "insert")![0]
      return { data: Array.isArray(rows) ? rows.map((_, i) => ({ id: `job-${i}` })) : { id: "job-1" }, error: null }
    }
    return { data: null, error: null }
  }
})

describe("rawSessionIdOf / withoutSessionColumn", () => {
  it("reads sessionId off a plain body; null and absent mean none", () => {
    expect(rawSessionIdOf({ sessionId: SESSION })).toBe(SESSION)
    expect(rawSessionIdOf({ sessionId: null })).toBeUndefined()
    expect(rawSessionIdOf({ sessionId: "" })).toBeUndefined()
    expect(rawSessionIdOf({})).toBeUndefined()
    expect(rawSessionIdOf(undefined)).toBeUndefined()
    expect(rawSessionIdOf([SESSION])).toBeUndefined()
  })

  it("drops a caller-written session_id and leaves the rest alone", () => {
    const row = { user_id: OWNER, session_id: "forged" }
    expect(withoutSessionColumn(row)).toEqual({ user_id: OWNER })
    expect(row).toEqual({ user_id: OWNER, session_id: "forged" })
  })
})

describe("resolveRequestSession", () => {
  it("asks the database nothing when the body names no session", async () => {
    await expect(resolveRequestSession(makeReq({ prompt: "x" }))).resolves.toBeNull()
    expect(sessionLookups()).toHaveLength(0)
  })

  it("never resolves a session for an internal caller", async () => {
    await expect(resolveRequestSession(makeReq({ sessionId: SESSION }, { authKind: "internal" } as never))).resolves.toBeNull()
    expect(sessionLookups()).toHaveLength(0)
  })

  it("refuses a value that is not a uuid without asking the database", async () => {
    await expect(resolveRequestSession(makeReq({ sessionId: "abc" }))).rejects.toBeInstanceOf(GenerationSessionNotFoundError)
    await expect(resolveRequestSession(makeReq({ sessionId: 7 }))).rejects.toBeInstanceOf(GenerationSessionNotFoundError)
    expect(sessionLookups()).toHaveLength(0)
  })

  it("looks the session up as the caller's own, personal side", async () => {
    await expect(resolveRequestSession(makeReq({ sessionId: SESSION }))).resolves.toBe(SESSION)
    const [q] = sessionLookups()
    expect(has(q, "eq", "id", SESSION)).toBe(true)
    expect(has(q, "eq", "user_id", OWNER)).toBe(true)
    expect(has(q, "is", "workspace_id", null)).toBe(true)
  })

  it("looks it up on the workspace side inside a workspace", async () => {
    await resolveRequestSession(makeReq({ sessionId: SESSION }, { workspaceId: WORKSPACE } as never))
    expect(has(sessionLookups()[0], "eq", "workspace_id", WORKSPACE)).toBe(true)
  })

  it("refuses an OAuth app without assets:write, before asking the database", async () => {
    const req = makeReq({ sessionId: SESSION }, { appAuthorization: { scopes: ["jobs:read"] } } as never)
    await expect(resolveRequestSession(req)).rejects.toBeInstanceOf(GenerationSessionNotFoundError)
    expect(sessionLookups()).toHaveLength(0)
    const ok = makeReq({ sessionId: SESSION }, { appAuthorization: { scopes: ["assets:write"] } } as never)
    await expect(resolveRequestSession(ok)).resolves.toBe(SESSION)
  })

  it("refuses a session that is not the caller's (no row)", async () => {
    db.sessionFound = false
    await expect(resolveRequestSession(makeReq({ sessionId: SESSION }))).rejects.toBeInstanceOf(GenerationSessionNotFoundError)
  })

  it("reads the database once per request", async () => {
    const req = makeReq({ sessionId: SESSION })
    await resolveRequestSession(req)
    await resolveRequestSession(req)
    expect(sessionLookups()).toHaveLength(1)
  })
})

describe("the job funnel stamps the session on every request lane", () => {
  it("insertJob stamps the validated session over a caller-written one", async () => {
    const { error } = await insertJob(makeReq({ sessionId: SESSION }), { user_id: OWNER, session_id: "forged" })
    expect(error).toBeNull()
    expect(jobInserts()[0].session_id).toBe(SESSION)
  })

  it("insertJob without a session drops a caller-written session_id", async () => {
    await insertJob(makeReq({}), { user_id: OWNER, session_id: "forged" })
    expect("session_id" in jobInserts()[0]).toBe(false)
  })

  it("insertJobs stamps every row from one lookup", async () => {
    await insertJobs(makeReq({ sessionId: SESSION }), [{ user_id: OWNER }, { user_id: OWNER }])
    expect(jobInserts().map((r) => r.session_id)).toEqual([SESSION, SESSION])
    expect(sessionLookups()).toHaveLength(1)
  })

  it("insertJobIdempotent stamps it too", async () => {
    await insertJobIdempotent(makeReq({ sessionId: SESSION }), { user_id: OWNER }, "key-1")
    expect(idempotent.rows[0].session_id).toBe(SESSION)
  })

  it("insertInternalJob never stamps one, and drops a caller-written one", async () => {
    await insertInternalJob("test", { user_id: OWNER, session_id: SESSION })
    expect("session_id" in jobInserts()[0]).toBe(false)
  })

  it("a session the caller may not use refuses the insert: no row, and a 404", async () => {
    db.sessionFound = false
    const req = makeReq({ sessionId: SESSION })
    const { data, error } = await insertJob(req, { user_id: OWNER })
    expect(data).toBeNull()
    expect(error).toBeInstanceOf(GenerationSessionNotFoundError)
    expect(jobInserts()).toHaveLength(0)

    const reply = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this },
      send(b: unknown) { this.body = b; return this },
    }
    sendInternalError(reply as unknown as FastifyReply, req, error)
    expect(reply.statusCode).toBe(404)
    expect(reply.body).toEqual({ error: { code: "not_found", message: "Session not found" } })
  })

  it("insertJobIdempotent throws the same refusal for its callers' catch", async () => {
    db.sessionFound = false
    await expect(insertJobIdempotent(makeReq({ sessionId: SESSION }), { user_id: OWNER }, null))
      .rejects.toBeInstanceOf(GenerationSessionNotFoundError)
    expect(idempotent.rows).toHaveLength(0)
  })
})
