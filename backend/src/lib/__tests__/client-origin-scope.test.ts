/**
 * The request's client `origin` (`lib/client-origin-scope.ts`) and the job
 * funnel that stamps it (`lib/insert-job.ts`).
 *
 * The invariant, the same shape as the session's: a job's `input_data.origin`
 * is ONLY ever the request's validated `origin` (the client app's slug), on
 * every request lane — `insertJob`, `insertSyncJob`, `insertJobs`,
 * `insertJobIdempotent` — so a generation route stamps it without declaring
 * it. A route-written `input_data.origin` the request did not send is dropped;
 * an internal creator and the orchestrator's own hops stamp none; a value that
 * is not a slug refuses the insert before any row exists and answers 400
 * `validation_error` on every lane.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import { argOf, type QueryResult, type RecordedQuery } from "./fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
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

import { InvalidClientOriginError, rawOriginOf, resolveRequestOrigin, withRequestOrigin } from "../client-origin-scope.js"
import { insertInternalJob, insertJob, insertJobIdempotent, insertJobs, insertSyncJob } from "../insert-job.js"
import { sendInternalError } from "../http-errors.js"

function makeReq(body: unknown, extra: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/v1/image-to-image",
    routeOptions: { url: "/v1/image-to-image" },
    headers: {},
    body,
    userId: OWNER,
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    ...extra,
  } as unknown as FastifyRequest
}

function jobInserts(): Record<string, unknown>[] {
  return db.log
    .filter((q) => q.table === "jobs" && argOf(q, "insert"))
    .flatMap((q) => {
      const rows = argOf(q, "insert")![0]
      return (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]
    })
}

const inputOf = (row: Record<string, unknown> | undefined) => (row?.input_data ?? {}) as Record<string, unknown>

function fakeReply() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    send(b: unknown) { this.body = b; return this },
  }
}

beforeEach(() => {
  db.log.length = 0
  idempotent.rows.length = 0
  db.respond = (q) => {
    if (q.table === "jobs" && argOf(q, "insert")) {
      const rows = argOf(q, "insert")![0]
      return { data: Array.isArray(rows) ? rows.map((_, i) => ({ id: `job-${i}` })) : { id: "job-1" }, error: null }
    }
    return { data: null, error: null }
  }
})

describe("rawOriginOf", () => {
  it("reads origin off a plain body; null, empty and absent mean none", () => {
    expect(rawOriginOf({ origin: "create-image" })).toBe("create-image")
    expect(rawOriginOf({ origin: null })).toBeUndefined()
    expect(rawOriginOf({ origin: "" })).toBeUndefined()
    expect(rawOriginOf({})).toBeUndefined()
    expect(rawOriginOf(undefined)).toBeUndefined()
    expect(rawOriginOf("create-image")).toBeUndefined()
    expect(rawOriginOf(["create-image"])).toBeUndefined()
  })
})

describe("resolveRequestOrigin", () => {
  it("answers the slug a request sent", () => {
    expect(resolveRequestOrigin(makeReq({ origin: "create-image" }))).toBe("create-image")
    expect(resolveRequestOrigin(makeReq({ origin: "studio2" }))).toBe("studio2")
  })

  it("answers null when the request names none", () => {
    expect(resolveRequestOrigin(makeReq({ prompt: "x" }))).toBeNull()
    expect(resolveRequestOrigin(makeReq(null))).toBeNull()
  })

  it("never reads one for the orchestrator's own hop: a workflow run is not a client app", () => {
    expect(resolveRequestOrigin(makeReq({ origin: "create-image" }, { authKind: "internal" } as never))).toBeNull()
    expect(resolveRequestOrigin(makeReq({ origin: "Not A Slug" }, { authKind: "internal" } as never))).toBeNull()
  })

  it.each([
    ["capitals", "Create-Image"],
    ["a space", "create image"],
    ["a leading dash", "-create"],
    ["41 characters", "a".repeat(41)],
    ["a number", 7],
    ["an object", { app: "x" }],
  ])("refuses an origin with %s", (_label, origin) => {
    expect(() => resolveRequestOrigin(makeReq({ origin }))).toThrow(InvalidClientOriginError)
  })
})

describe("withRequestOrigin", () => {
  it("stamps the origin into input_data without touching the caller's object", () => {
    const row = { user_id: OWNER, input_data: { type: "image-to-image", prompt: "p" } }
    const stamped = withRequestOrigin(row, "create-image")
    expect(stamped.input_data).toEqual({ type: "image-to-image", prompt: "p", origin: "create-image" })
    expect(row.input_data).toEqual({ type: "image-to-image", prompt: "p" })
  })

  it("replaces an input_data.origin the route wrote with the request's", () => {
    const stamped = withRequestOrigin({ input_data: { origin: "stale" } }, "create-image")
    expect(inputOf(stamped).origin).toBe("create-image")
  })

  it("drops an input_data.origin the request did not send", () => {
    const stamped = withRequestOrigin({ user_id: OWNER, input_data: { type: "t", origin: "forged" } }, null)
    expect(stamped.input_data).toEqual({ type: "t" })
  })

  it("leaves a row with no input_data origin exactly as it was", () => {
    const row = { user_id: OWNER, input_data: { type: "t" } }
    expect(withRequestOrigin(row, null)).toBe(row)
  })
})

describe("the job funnel stamps the origin on every request lane", () => {
  it("insertJob", async () => {
    const { error } = await insertJob(makeReq({ origin: "create-image" }), { user_id: OWNER, input_data: { type: "image-to-image" } })
    expect(error).toBeNull()
    expect(inputOf(jobInserts()[0]).origin).toBe("create-image")
  })

  it("insertSyncJob", async () => {
    const { error } = await insertSyncJob(makeReq({ origin: "create-image" }), { user_id: OWNER, input_data: { type: "image-to-text" } })
    expect(error).toBeNull()
    expect(inputOf(jobInserts()[0]).origin).toBe("create-image")
  })

  it("insertJobs stamps every row", async () => {
    await insertJobs(makeReq({ origin: "create-image" }), [
      { user_id: OWNER, input_data: { type: "a" } },
      { user_id: OWNER, input_data: { type: "b" } },
    ])
    expect(jobInserts().map((r) => inputOf(r).origin)).toEqual(["create-image", "create-image"])
  })

  it("insertJobIdempotent", async () => {
    await insertJobIdempotent(makeReq({ origin: "create-image" }), { user_id: OWNER, input_data: { type: "generate-image" } }, "key-12345")
    expect(inputOf(idempotent.rows[0]).origin).toBe("create-image")
  })

  it("stamps the request's origin exactly once, whatever the route copied from the same body", async () => {
    await insertJob(makeReq({ origin: "create-image" }), {
      user_id: OWNER,
      input_data: { type: "generate-music", origin: "create-image", prompt: "p" },
    })
    const row = jobInserts()[0]
    expect(inputOf(row)).toEqual({ type: "generate-music", origin: "create-image", prompt: "p" })
    expect("origin" in row).toBe(false)
  })

  it("a request without an origin drops one the route wrote", async () => {
    await insertJob(makeReq({}), { user_id: OWNER, input_data: { type: "t", origin: "forged" } })
    expect("origin" in inputOf(jobInserts()[0])).toBe(false)
  })

  it("the orchestrator's own hop stamps none", async () => {
    await insertJob(makeReq({ origin: "create-image" }, { authKind: "internal" } as never), { user_id: OWNER, input_data: { type: "t" } })
    expect("origin" in inputOf(jobInserts()[0])).toBe(false)
  })

  it("insertInternalJob never stamps one, and keeps what its creator wrote", async () => {
    await insertInternalJob("test", { user_id: OWNER, input_data: { type: "t", origin: "studio" } })
    expect(inputOf(jobInserts()[0]).origin).toBe("studio")
    await insertInternalJob("test", { user_id: OWNER, input_data: { type: "t" } })
    expect("origin" in inputOf(jobInserts()[1])).toBe(false)
  })
})

describe("an origin that is not a slug refuses the insert, the same way on every lane", () => {
  const BAD = { origin: "Create Image" }

  it("insertJob: no row, and a 400 validation_error naming the field", async () => {
    const req = makeReq(BAD)
    const { data, error } = await insertJob(req, { user_id: OWNER, input_data: { type: "t" } })
    expect(data).toBeNull()
    expect(error).toBeInstanceOf(InvalidClientOriginError)
    expect(jobInserts()).toHaveLength(0)

    const reply = fakeReply()
    sendInternalError(reply as unknown as FastifyReply, req, error)
    expect(reply.statusCode).toBe(400)
    expect(reply.body).toEqual({
      error: {
        code: "validation_error",
        message: expect.stringMatching(/^origin: /),
        issues: [{ path: "origin", message: expect.any(String) }],
      },
    })
  })

  it("insertSyncJob", async () => {
    const { error } = await insertSyncJob(makeReq(BAD), { user_id: OWNER, input_data: { type: "image-to-text" } })
    expect(error).toBeInstanceOf(InvalidClientOriginError)
    expect(jobInserts()).toHaveLength(0)
  })

  it("insertJobs", async () => {
    const { error } = await insertJobs(makeReq(BAD), [{ user_id: OWNER, input_data: { type: "t" } }])
    expect(error).toBeInstanceOf(InvalidClientOriginError)
    expect(jobInserts()).toHaveLength(0)
  })

  it("insertJobIdempotent throws it for its callers' catch", async () => {
    await expect(insertJobIdempotent(makeReq(BAD), { user_id: OWNER, input_data: { type: "t" } }, null))
      .rejects.toBeInstanceOf(InvalidClientOriginError)
    expect(idempotent.rows).toHaveLength(0)
  })

  it("is refused before the session is looked up", async () => {
    const { error } = await insertJob(makeReq({ ...BAD, sessionId: "00000000-0000-4000-8000-0000000005e1" }), { user_id: OWNER, input_data: { type: "t" } })
    expect(error).toBeInstanceOf(InvalidClientOriginError)
    expect(db.log.filter((q) => q.table === "generation_sessions")).toHaveLength(0)
  })
})
