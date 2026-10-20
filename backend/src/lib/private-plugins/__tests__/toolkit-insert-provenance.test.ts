/**
 * `tk.http.insertJobWithProvenance` — the plugin routes' door into the job
 * funnel (`insertJobIdempotent`, `lib/insert-job.ts`).
 *
 * The invariant: a plugin-created job carries the same request-derived columns
 * a core route's job does — the request's validated `session_id`, its client
 * `input_data.origin`, the P14 payer pair from `req.billingContext` — and passes
 * the same job-policy gate. A refusal of the request becomes a `PluginHttpError`
 * whose `statusCode` + `body` are exactly what `sendInternalError` answers for
 * the original error, before any row exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyRequest } from "fastify"
import type { QueryResult, RecordedQuery } from "../../__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const SESSION = "00000000-0000-4000-8000-0000000005e1"
const WORKSPACE = "00000000-0000-4000-8000-0000000000f1"
const ORG = "00000000-0000-4000-8000-0000000000e1"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  sessionFound: true,
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))
const idempotent = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], keys: [] as unknown[] }))
const blocks = vi.hoisted(() => ({ blocked: false }))

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom: make } = await import("../../__tests__/fake-supabase-query.js")
  return { supabase: { from: make(db.log, (q) => db.respond!(q)) } }
})
vi.mock("@/lib/idempotent-insert.js", () => ({
  insertWithIdempotencyKey: vi.fn(async (_t: string, row: Record<string, unknown>, key: unknown) => {
    idempotent.rows.push(row)
    idempotent.keys.push(key)
    return { row: { id: "job-1" }, created: true }
  }),
}))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => blocks.blocked),
}))
vi.mock("@/lib/job-policy-audit.js", () => ({ recordJobPolicyDecision: vi.fn(), hashGateSubject: vi.fn(() => "h") }))

import { buildToolkit } from "../toolkit.js"
import { GenerationSessionNotFoundError } from "../../generation-session-scope.js"
import { InvalidClientOriginError } from "../../client-origin-scope.js"
import { JobBlockedError } from "../../job-policy.js"

function makeReq(body: unknown, extra: Record<string, unknown> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/v1/plugin-route",
    routeOptions: { url: "/v1/plugin-route" },
    headers: {},
    body,
    userId: OWNER,
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    ...extra,
  } as unknown as FastifyRequest
}

const ROW = { user_id: OWNER, status: "pending", input_data: { type: "plugin-route" } }

function insertMember() {
  const member = buildToolkit().http.insertJobWithProvenance
  expect(typeof member).toBe("function")
  return member!
}

beforeEach(() => {
  db.log.length = 0
  idempotent.rows.length = 0
  idempotent.keys.length = 0
  db.sessionFound = true
  blocks.blocked = false
  db.respond = (q) => {
    if (q.table === "generation_sessions") {
      return { data: db.sessionFound ? { id: SESSION } : null, error: null }
    }
    return { data: null, error: null }
  }
})

describe("tk.http.insertJobWithProvenance", () => {
  it("stamps session_id and origin from the request body", async () => {
    const req = makeReq({ sessionId: SESSION, origin: "tools" })

    const result = await insertMember()(req, ROW, "idem-1")

    expect(result).toEqual({ id: "job-1", created: true })
    expect(idempotent.rows).toHaveLength(1)
    const row = idempotent.rows[0]!
    expect(row.session_id).toBe(SESSION)
    expect((row.input_data as Record<string, unknown>).origin).toBe("tools")
    expect(row.user_id).toBe(OWNER)
    expect(idempotent.keys[0]).toBe("idem-1")
  })

  it("drops a plugin-written session_id the request did not validate", async () => {
    await insertMember()(makeReq({}), { ...ROW, session_id: "forged" }, null)

    expect(idempotent.rows[0]).not.toHaveProperty("session_id")
  })

  it("stamps the billing pair from req.billingContext", async () => {
    const req = makeReq({}, { billingContext: { payer: "workspace", workspaceId: WORKSPACE, orgId: ORG } })

    await insertMember()(req, ROW, null)

    expect(idempotent.rows[0]).toMatchObject({ workspace_id: WORKSPACE, org_id: ORG })
  })

  it("insertJobWithProvenance maps session refusal to 404", async () => {
    db.sessionFound = false
    const req = makeReq({ sessionId: SESSION })

    const err = await insertMember()(req, ROW, "idem-1").catch((e: unknown) => e)

    expect(err).toMatchObject({
      name: "PluginHttpError",
      statusCode: 404,
      body: { error: { code: "not_found", message: "Session not found" } },
    })
    expect((err as Error).cause).toBeInstanceOf(GenerationSessionNotFoundError)
    expect(idempotent.rows).toHaveLength(0)
  })

  it("maps an invalid origin to 400 validation_error", async () => {
    const err = await insertMember()(makeReq({ origin: "Not A Slug!" }), ROW, null).catch((e: unknown) => e)

    expect(err).toMatchObject({
      name: "PluginHttpError",
      statusCode: 400,
      body: { error: { code: "validation_error", issues: [{ path: "origin" }] } },
    })
    expect((err as Error).cause).toBeInstanceOf(InvalidClientOriginError)
    expect(idempotent.rows).toHaveLength(0)
  })

  it("maps a job-policy block to 422 job_blocked", async () => {
    blocks.blocked = true

    const err = await insertMember()(makeReq({}), ROW, null).catch((e: unknown) => e)

    expect(err).toMatchObject({ name: "PluginHttpError", statusCode: 422, body: { error: { code: "job_blocked" } } })
    expect((err as Error).cause).toBeInstanceOf(JobBlockedError)
    expect(idempotent.rows).toHaveLength(0)
  })

  it("re-throws any other failure unchanged", async () => {
    const { insertWithIdempotencyKey } = await import("@/lib/idempotent-insert.js")
    const dbFailure = new Error("idempotent insert failed (jobs): boom")
    vi.mocked(insertWithIdempotencyKey).mockRejectedValueOnce(dbFailure)

    await expect(insertMember()(makeReq({}), ROW, null)).rejects.toBe(dbFailure)
  })
})
