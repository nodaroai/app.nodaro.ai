/**
 * `insertSyncJob` — the insert for a route that works its job inside the
 * request. No worker pickup will ever stamp `job_type` / `started_at` on such
 * a row, so the insert does: `job_type` DERIVED from `input_data.type`, and
 * `started_at` now.
 *
 * The derivation is what keeps the change invisible to the request gate: with
 * the column empty, `requestContextOf` already read the job's type from
 * `input_data.type`, so a registered policy sees the same `jobType` before and
 * after.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { FastifyRequest } from "fastify"

const { fromMock, insertMock } = vi.hoisted(() => {
  const singleMock = vi.fn<(...a: unknown[]) => unknown>().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const selectMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ single: singleMock }))
  const insertMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ select: selectMock }))
  const fromMock = vi.fn<(...a: unknown[]) => unknown>(() => ({ insert: insertMock }))
  return { fromMock, insertMock }
})

vi.mock("../supabase.js", () => ({ supabase: { from: fromMock } }))
const { idempotentMock } = vi.hoisted(() => ({
  idempotentMock: vi.fn<(...a: unknown[]) => unknown>(async () => ({ row: { id: "job-2" }, created: true })),
}))
vi.mock("../idempotent-insert.js", () => ({ insertWithIdempotencyKey: idempotentMock }))
vi.mock("../job-policy-audit.js", () => ({
  recordJobPolicyDecision: vi.fn(async () => "decision-1"),
  hashGateSubject: vi.fn(() => "hash-1"),
}))
vi.mock("../app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))
vi.mock("../access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => false),
}))

import { insertSyncJob, insertSyncJobIdempotent } from "../insert-job.js"
import { clearJobPolicies, registerJobPolicy, type JobRequestContext } from "../job-policy.js"

const req = {
  method: "POST",
  url: "/v1/image-to-text/describe",
  routeOptions: { url: "/v1/image-to-text/describe" },
  headers: {},
  body: {},
  log: { error: vi.fn(), info: vi.fn() },
} as unknown as FastifyRequest

const row = {
  user_id: "00000000-0000-4000-8000-0000000000a1",
  status: "pending",
  input_data: { type: "image-to-text", imageUrl: "https://cdn.example/a.png" },
}

const inserted = () => insertMock.mock.calls[0]![0] as Record<string, unknown>

beforeEach(() => {
  insertMock.mockClear()
  clearJobPolicies()
})
afterEach(() => clearJobPolicies())

describe("insertSyncJob", () => {
  it("stamps job_type from input_data.type and started_at on the row it inserts", async () => {
    const before = Date.now()
    const { data, error } = await insertSyncJob(req, row)

    expect(error).toBeNull()
    expect(data).toEqual({ id: "job-1" })
    expect(fromMock).toHaveBeenCalledWith("jobs")
    expect(inserted()).toMatchObject({ job_type: "image-to-text", status: "pending", input_data: row.input_data })
    expect(Date.parse(inserted().started_at as string)).toBeGreaterThanOrEqual(before - 1)
  })

  it("keeps a caller-supplied started_at (a mirror row knows its own clock)", async () => {
    await insertSyncJob(req, { ...row, started_at: "2026-01-01T00:00:00.000Z" })
    expect(inserted().started_at).toBe("2026-01-01T00:00:00.000Z")
  })

  it("hands a registered request policy the same jobType it read before the column was stamped", async () => {
    const seen: Array<string | null> = []
    registerJobPolicy({
      id: "spy",
      checkRequest: (ctx: JobRequestContext) => {
        seen.push(ctx.jobType)
        return { verdict: "allow" }
      },
    })
    await insertSyncJob(req, row)
    expect(seen).toEqual(["image-to-text"])
  })
})

describe("insertSyncJobIdempotent", () => {
  it("stamps job_type and started_at on the race-proof lane, under the caller's key", async () => {
    const before = Date.now()
    const result = await insertSyncJobIdempotent(req, row, "image-to-text:abc")

    expect(result).toEqual({ row: { id: "job-2" }, created: true })
    const [table, stamped, key] = idempotentMock.mock.calls[0]! as [string, Record<string, unknown>, string]
    expect(table).toBe("jobs")
    expect(key).toBe("image-to-text:abc")
    expect(stamped).toMatchObject({ job_type: "image-to-text", status: "pending", input_data: row.input_data })
    expect(Date.parse(stamped.started_at as string)).toBeGreaterThanOrEqual(before - 1)
  })
})
