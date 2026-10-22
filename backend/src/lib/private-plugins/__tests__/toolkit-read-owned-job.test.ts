/**
 * `tk.jobs.readOwnedJob(jobId, userId)` — one job, read only for its owner,
 * with `input_data` and `output_data` RAW (server-only `__` keys included):
 * a plugin route that acts on the user's own job (Trends' Full Quality reads
 * the draft run's hidden inputs) needs them, and never hands them out.
 *
 * What must hold: the owner predicate is part of the QUERY (someone else's job
 * and a missing job are the same null); a malformed id reads as absent; any
 * other database error THROWS a retryable `JobReadError`, never a null that
 * would tell the user "not your job" during an outage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { has, type QueryResult, type RecordedQuery } from "../../__tests__/fake-supabase-query.js"

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const JOB = "00000000-0000-4000-8000-0000000000b1"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom: make } = await import("../../__tests__/fake-supabase-query.js")
  return { supabase: { from: make(db.log, (q) => db.respond!(q)) } }
})

import { buildToolkit } from "../toolkit.js"

const ROW = {
  id: JOB,
  status: "completed",
  input_data: { type: "cast-swap", __trend: { sourceUrl: "https://cdn/x.mp4" } },
  output_data: { videoUrl: "https://cdn/out.mp4", __checkpoint: { step: 3 } },
  created_at: "2026-10-20T10:00:00Z",
  completed_at: "2026-10-20T10:05:00Z",
  error_hint: null,
}

beforeEach(() => {
  db.log.length = 0
  db.respond = () => ({ data: ROW, error: null })
})

describe("tk.jobs.readOwnedJob", () => {
  it("reads the owner's job with its raw input and output, owner-filtered in the query", async () => {
    const tk = buildToolkit()
    expect(await tk.jobs.readOwnedJob!(JOB, OWNER)).toEqual(ROW)
    const q = db.log[0]!
    expect(q.table).toBe("jobs")
    expect(has(q, "eq", "id", JOB)).toBe(true)
    expect(has(q, "eq", "user_id", OWNER)).toBe(true)
    expect(has(q, "select", "id,status,input_data,output_data,created_at,completed_at,error_hint")).toBe(true)
  })

  it("returns the job's error_hint, so a plugin reads a child's failure class without parsing its message", async () => {
    const hint = { kind: "safety-block", class: "safety", retried: true, suggestedProvider: "nano-banana-pro" }
    db.respond = () => ({ data: { ...ROW, status: "failed", output_data: null, error_hint: hint }, error: null })
    expect((await buildToolkit().jobs.readOwnedJob!(JOB, OWNER))?.error_hint).toEqual(hint)
  })

  it("someone else's (or a missing) job reads as null", async () => {
    db.respond = () => ({ data: null, error: null })
    expect(await buildToolkit().jobs.readOwnedJob!(JOB, "someone-else")).toBeNull()
  })

  it("normalises absent columns to null", async () => {
    db.respond = () => ({ data: { id: JOB, status: "processing", input_data: null, output_data: null, created_at: "t", completed_at: null }, error: null })
    expect(await buildToolkit().jobs.readOwnedJob!(JOB, OWNER)).toEqual({
      id: JOB, status: "processing", input_data: {}, output_data: null, created_at: "t", completed_at: null, error_hint: null,
    })
  })

  it("a malformed id reads as absent, not as an outage", async () => {
    db.respond = () => ({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } })
    expect(await buildToolkit().jobs.readOwnedJob!("not-a-uuid", OWNER)).toBeNull()
  })

  it("any other database error throws a retryable JobReadError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    db.respond = () => ({ data: null, error: { code: "57014", message: "statement timeout" } })
    await expect(buildToolkit().jobs.readOwnedJob!(JOB, OWNER)).rejects.toMatchObject({
      name: "JobReadError",
      retryable: true,
      code: "job_read_failed",
    })
  })
})
