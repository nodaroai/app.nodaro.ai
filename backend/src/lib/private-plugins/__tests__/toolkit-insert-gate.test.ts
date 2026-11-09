/**
 * `tk.http.insertJobWithIdempotencyKey` — the plugin contract's own insert
 * lane — runs the same REQUEST gate as every other job insert
 * (`gateJobInsert`, `lib/insert-job.ts`): a blocked account, a restricted
 * input and every registered request policy, before any row exists.
 *
 * Two halves:
 *   - the row a plugin writes is unchanged: the calling surface UNDER the
 *     plugin's columns, the P14 payer pair from the passed context OVER them,
 *     and no session / origin stamping (that is `insertJobWithProvenance`);
 *   - a refusal rejects with the same `PluginHttpError` the provenance funnel
 *     throws (422 job_blocked) and inserts nothing, and `tk.http.sendInternalError`
 *     — the catch most plugin routes use — answers it as that 422, not a 500.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { QueryResult, RecordedQuery } from "../../__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const SESSION = "00000000-0000-4000-8000-0000000005e1"
const WORKSPACE = "00000000-0000-4000-8000-0000000000f1"
const ORG = "00000000-0000-4000-8000-0000000000e1"
const RESTRICTED_URL = "https://cdn.example.test/restricted/evidence.mp4"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  sessionFound: true,
}))
const idempotent = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], keys: [] as unknown[] }))
const blocks = vi.hoisted(() => ({ blocked: false }))
const audit = vi.hoisted(() => ({
  recordJobPolicyDecision: vi.fn(async (_input: Record<string, unknown>) => "decision-1"),
  hashGateSubject: vi.fn(() => "hash-1"),
}))

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom: make } = await import("../../__tests__/fake-supabase-query.js")
  return {
    supabase: {
      from: make(db.log, (q): QueryResult => {
        if (q.table === "generation_sessions") return { data: db.sessionFound ? { id: SESSION } : null, error: null }
        return { data: null, error: null }
      }),
    },
  }
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
vi.mock("@/lib/job-policy-audit.js", () => audit)
vi.mock("@/lib/content-restriction-gate.js", async () => {
  const actual = await vi.importActual<typeof import("../../content-restriction-gate.js")>("../../content-restriction-gate.js")
  return {
    ...actual,
    restrictedInputKey: vi.fn(async (input: Record<string, unknown> | null) =>
      JSON.stringify(input ?? {}).includes(RESTRICTED_URL) ? "restricted/evidence.mp4" : null,
    ),
  }
})

import { buildToolkit } from "../toolkit.js"
import type { PluginBillingContext } from "../types.js"
import { clearJobPolicies, JobBlockedError, registerJobPolicy } from "../../job-policy.js"

function makeReq(body: unknown = {}, extra: Record<string, unknown> = {}): FastifyRequest {
  return {
    method: "POST",
    url: "/v1/plugin-route",
    routeOptions: { url: "/v1/plugin-route" },
    headers: {},
    body,
    userId: OWNER,
    authKind: "jwt",
    log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    ...extra,
  } as unknown as FastifyRequest
}

function makeReply() {
  return {
    statusCode: 200 as number,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    send(payload: unknown) { this.body = payload; return this },
  }
}

const ROW = { user_id: OWNER, status: "pending", input_data: { type: "plugin-route", prompt: "a cat" } }
const WORKSPACE_CONTEXT: PluginBillingContext = {
  payer: "workspace",
  userId: OWNER,
  workspaceId: WORKSPACE,
  orgId: ORG,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 4,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
  memberCap: null,
}

function http() {
  return buildToolkit().http
}

beforeEach(() => {
  db.log.length = 0
  db.sessionFound = true
  idempotent.rows.length = 0
  idempotent.keys.length = 0
  blocks.blocked = false
  clearJobPolicies()
  vi.clearAllMocks()
})
afterEach(() => clearJobPolicies())

describe("tk.http.insertJobWithIdempotencyKey — the row is the plugin's, as before", () => {
  it("stamps the calling surface under the row and the payer pair over it, and nothing else", async () => {
    const req = makeReq({ sessionId: SESSION, origin: "tools" })

    const result = await http().insertJobWithIdempotencyKey(ROW, "idem-1", WORKSPACE_CONTEXT, req)

    expect(result).toEqual({ id: "job-1", created: true })
    expect(idempotent.keys).toEqual(["idem-1"])
    const row = idempotent.rows[0]!
    expect(row).toMatchObject({ ...ROW, workspace_id: WORKSPACE, org_id: ORG })
    expect(typeof row.source).toBe("string")
    // The provenance funnel's stamps are NOT this lane's: no session, no origin.
    expect(row).not.toHaveProperty("session_id")
    expect(row.input_data).toEqual(ROW.input_data)
    expect(audit.recordJobPolicyDecision).not.toHaveBeenCalled()
  })

  it("lets the plugin's own columns win over the stamped surface, but never over the payer pair", async () => {
    const data = { ...ROW, source: "plugin-said", source_detail: "detail", workspace_id: "forged" }

    await http().insertJobWithIdempotencyKey(data, null, WORKSPACE_CONTEXT, makeReq())

    expect(idempotent.rows[0]).toMatchObject({ source: "plugin-said", source_detail: "detail", workspace_id: WORKSPACE, org_id: ORG })
  })

  it("writes the row verbatim when no request is given (an older plugin's call)", async () => {
    await http().insertJobWithIdempotencyKey(ROW, null)

    expect(idempotent.rows).toEqual([ROW])
  })
})

describe("tk.http.insertJobWithIdempotencyKey — the request gate", () => {
  async function refusalOf(call: Promise<unknown>) {
    const err = await call.catch((e: unknown) => e)
    expect(err).toMatchObject({ name: "PluginHttpError", statusCode: 422, body: { error: { code: "job_blocked" } } })
    expect((err as Error).cause).toBeInstanceOf(JobBlockedError)
    expect(idempotent.rows).toHaveLength(0)
    return err as Error & { statusCode: number; body: { error: { code: string; message: string } } }
  }

  it("refuses a blocked account and inserts nothing", async () => {
    blocks.blocked = true

    await refusalOf(http().insertJobWithIdempotencyKey(ROW, "idem-1", undefined, makeReq()))
  })

  it("refuses a job whose input names a restricted file", async () => {
    const row = { ...ROW, input_data: { ...ROW.input_data, videoUrl: RESTRICTED_URL } }

    await refusalOf(http().insertJobWithIdempotencyKey(row, null, undefined, makeReq()))
  })

  it("refuses what a registered request policy blocks, with the policy's sentence, and records the block", async () => {
    registerJobPolicy({
      id: "test-policy",
      checkRequest: () => ({ verdict: "block", reason: "machine-reason", userMessage: "This request is not allowed here." }),
    })

    const err = await refusalOf(http().insertJobWithIdempotencyKey(ROW, null, undefined, makeReq()))

    expect(err.body.error.message).toBe("This request is not allowed here.")
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledWith(expect.objectContaining({
      jobId: null, hookPoint: "request", policyId: "test-policy", verdict: "block", userId: OWNER,
    }))
  })

  it("fails closed when a request policy throws", async () => {
    registerJobPolicy({ id: "boom", checkRequest: () => { throw new Error("moderation down") } })

    await refusalOf(http().insertJobWithIdempotencyKey(ROW, null, undefined, makeReq()))
  })

  it("judges a call that carries no request too", async () => {
    blocks.blocked = true

    await refusalOf(http().insertJobWithIdempotencyKey(ROW, null))
  })

  it("lets the policy see the plugin's row as it will land", async () => {
    const seen: unknown[] = []
    registerJobPolicy({ id: "spy", checkRequest: (ctx) => { seen.push(ctx); return { verdict: "allow" } } })

    await http().insertJobWithIdempotencyKey({ ...ROW, job_type: "plugin-route" }, null, undefined, makeReq())

    expect(seen).toEqual([expect.objectContaining({ jobType: "plugin-route", userId: OWNER, inputData: ROW.input_data, rowCount: 1 })])
  })

  it("inserts and records one allow decision when every registered policy allows", async () => {
    registerJobPolicy({ id: "test-policy", checkRequest: () => ({ verdict: "allow" }) })

    await http().insertJobWithIdempotencyKey(ROW, null, undefined, makeReq())

    expect(idempotent.rows).toHaveLength(1)
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledTimes(1)
    expect(audit.recordJobPolicyDecision).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", verdict: "allow" }))
  })

  it("re-throws a database failure unchanged", async () => {
    const { insertWithIdempotencyKey } = await import("@/lib/idempotent-insert.js")
    const dbFailure = new Error("idempotent insert failed (jobs): boom")
    vi.mocked(insertWithIdempotencyKey).mockRejectedValueOnce(dbFailure)

    await expect(http().insertJobWithIdempotencyKey(ROW, null, undefined, makeReq())).rejects.toBe(dbFailure)
  })
})

describe("tk.http.sendInternalError answers a toolkit refusal as the refusal, never a 500", () => {
  it("a job-policy refusal is a 422 job_blocked with the policy's sentence", async () => {
    blocks.blocked = true
    const req = makeReq()
    const err = await http().insertJobWithIdempotencyKey(ROW, null, undefined, req).catch((e: unknown) => e)
    const reply = makeReply()

    http().sendInternalError(reply as unknown as FastifyReply, req, err, "Failed to create job")

    expect(reply.statusCode).toBe(422)
    expect(reply.body).toEqual((err as { body: unknown }).body)
    expect(req.log.error).not.toHaveBeenCalled()
  })

  it("the provenance funnel's session refusal is its 404, not a 500", async () => {
    db.sessionFound = false
    const req = makeReq({ sessionId: SESSION })
    const err = await http().insertJobWithProvenance!(req, ROW, null).catch((e: unknown) => e)
    const reply = makeReply()

    http().sendInternalError(reply as unknown as FastifyReply, req, err, "Failed to create job")

    expect(reply.statusCode).toBe(404)
    expect(reply.body).toEqual({ error: { code: "not_found", message: "Session not found" } })
  })

  it("an ordinary error is still a sanitized 500", () => {
    const req = makeReq()
    const reply = makeReply()

    http().sendInternalError(reply as unknown as FastifyReply, req, new Error("raw database text"), "Failed to create job")

    expect(reply.statusCode).toBe(500)
    expect(reply.body).toEqual({ error: { code: "internal_error", message: "Failed to create job" } })
  })
})
