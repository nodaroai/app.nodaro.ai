// @test-watches supabase/migrations/*.sql
/**
 * What a webhook carries (lib/webhooks/event.ts).
 *
 * A job event's `data.job` is the job in the same public shape `GET
 * /v1/jobs/:id` answers a non-admin: `sanitizeJobForPublic` (credits, never
 * USD; no provider; internal input fields stripped) plus `credit_status`,
 * `credits_charged`, `credits_held` and `credits_released` read through the
 * run loader (the job's steps included). The job is read as its
 * owner's, and a body is built once — the first attempt's exact text is what
 * every retry sends again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { jobsColumns } from "../../__tests__/jobs-schema.js"

const db = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  usage: [] as Record<string, unknown>[],
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
}))

vi.mock("../../supabase.js", () => {
  function builder(table: string) {
    const chain: Record<string, unknown> = {}
    const record = (op: string) => (...args: unknown[]) => {
      db.calls.push({ table, op, args })
      return chain
    }
    for (const op of ["select", "eq", "in", "is"]) chain[op] = record(op)
    chain.maybeSingle = async () => {
      db.calls.push({ table, op: "maybeSingle", args: [] })
      return { data: table === "jobs" ? db.job : null, error: null }
    }
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "usage_logs" ? db.usage : [], error: null })
    return chain
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

import { JOB_EVENT_COLUMNS, MAX_EVENT_BYTES, TEXT_FIELD_MAX_BYTES, cutText, eventBodyFor, type ClaimedDelivery } from "../event.js"
import { PUBLIC_JOB_KEYS } from "../../../routes/jobs.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const JOB = "00000000-0000-4000-8000-0000000000b1"

function delivery(overrides: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    deliveryId: "00000000-0000-4000-8000-0000000000d1",
    webhookId: "00000000-0000-4000-8000-0000000000e1",
    userId: OWNER,
    jobId: JOB,
    event: "job.completed",
    payload: null,
    attempts: 1,
    createdAt: "2026-10-15T10:00:00.123456+00:00",
    url: "https://hooks.example.com/in",
    secretCiphertext: "sealed",
    previousSecretCiphertext: null,
    runtimeEnv: "production",
    ...overrides,
  }
}

const JOB_ROW = {
  id: JOB,
  status: "completed",
  progress: 100,
  input_data: { type: "generate-image", prompt: "a lighthouse", userId: OWNER, jobId: JOB, usageLogId: "u1", provider: "nano-banana", force_private: true },
  output_data: { imageUrl: "https://cdn.example.com/images/a.png" },
  error_message: null,
  error_hint: null,
  created_at: "2026-10-15T09:59:00+00:00",
  started_at: "2026-10-15T09:59:01+00:00",
  completed_at: "2026-10-15T10:00:00+00:00",
  user_id: OWNER,
  credits: 40,
  job_type: "generate-image",
  source: "sdk",
  source_detail: "sdk/2.27.0",
  session_id: null,
  reconcile_attempts: 0,
  usage_log_id: "u1",
  // Never public, even if a select ever returned them:
  provider: "kie",
  provider_cost: 0.04,
  display_cost: 0.05,
  credits_actual: 38,
  error_detail: "raw provider text",
}

beforeEach(() => {
  db.job = null
  db.usage = []
  db.calls.length = 0
})

describe("eventBodyFor — a job event", () => {
  it("carries the job in the public shape of GET /v1/jobs/:id, with its credit figures", async () => {
    db.job = JOB_ROW
    db.usage = [{ id: "u1", status: "committed", credits_used: 40, credits_charged: 38 }]
    const built = await eventBodyFor(delivery())
    expect(built.kind).toBe("body")
    if (built.kind !== "body") return
    expect(built.fresh).toBe(true)
    const event = JSON.parse(built.body)
    expect(event).toMatchObject({
      id: "00000000-0000-4000-8000-0000000000d1",
      type: "job.completed",
      createdAt: "2026-10-15T10:00:00.123Z",
    })
    expect(Object.keys(event).sort()).toEqual(["createdAt", "data", "id", "type"])
    const job = event.data.job
    // Exactly the public keys plus the credit figures — what GET /v1/jobs/:id answers.
    expect(Object.keys(job).sort()).toEqual([...PUBLIC_JOB_KEYS, "credit_status", "credits_charged", "credits_held", "credits_released"].sort())
    expect(Object.keys(job)).toEqual(expect.arrayContaining(["session_id", "source", "output_data"]))
    expect(job.input_data).toEqual({ type: "generate-image", prompt: "a lighthouse" })
    expect(job).toMatchObject({ credit_status: "committed", credits_charged: 38, credits: 40, credits_held: 40, credits_released: 2 })
    expect(built.body).not.toMatch(/provider|usage_log|error_detail|credits_actual|reconcile/)
  })

  it("reads only columns the jobs table has (every public key, and what the sanitizer needs)", () => {
    const columns = JOB_EVENT_COLUMNS.split(", ")
    expect(columns).toEqual(expect.arrayContaining([...PUBLIC_JOB_KEYS, "reconcile_attempts", "usage_log_id"]))
    const table = jobsColumns()
    expect(table.has("id") && !table.has("not_a_column")).toBe(true) // the scan is not vacuous
    expect(columns.filter((c) => !table.has(c))).toEqual([])
  })

  it("reads the job as the delivery owner's", async () => {
    db.job = JOB_ROW
    await eventBodyFor(delivery())
    const eqs = db.calls.filter((c) => c.table === "jobs" && c.op === "eq").map((c) => c.args)
    expect(eqs).toContainEqual(["id", JOB])
    expect(eqs).toContainEqual(["user_id", OWNER])
  })

  it("reports a job that is gone (deleted, or not the owner's) instead of sending", async () => {
    db.job = null
    expect(await eventBodyFor(delivery())).toEqual({ kind: "missing" })
    expect(await eventBodyFor(delivery({ jobId: null }))).toEqual({ kind: "missing" })
  })

  it("leaves out input_data, then output_data, when the event would pass 64 KB", async () => {
    db.job = { ...JOB_ROW, input_data: { type: "x", prompt: "p".repeat(MAX_EVENT_BYTES) } }
    let built = await eventBodyFor(delivery())
    if (built.kind !== "body") throw new Error("expected a body")
    let job = JSON.parse(built.body).data
    expect(job.omitted).toEqual(["input_data"])
    expect(job.job).not.toHaveProperty("input_data")
    expect(job.job.output_data).toEqual(JOB_ROW.output_data)
    expect(Buffer.byteLength(built.body)).toBeLessThanOrEqual(MAX_EVENT_BYTES)

    db.job = { ...JOB_ROW, input_data: { p: "p".repeat(MAX_EVENT_BYTES) }, output_data: { text: "t".repeat(MAX_EVENT_BYTES) } }
    built = await eventBodyFor(delivery())
    if (built.kind !== "body") throw new Error("expected a body")
    job = JSON.parse(built.body).data
    expect(job.omitted).toEqual(["input_data", "output_data"])
    expect(job.job).not.toHaveProperty("output_data")
    expect(MAX_EVENT_BYTES).toBe(65_536)
  })

  it("is never over 64 KB: once both data fields are out, an over-long text field is cut", async () => {
    // Every public key that is left, as long as it could be — an error
    // message in control characters (each one six bytes once encoded) included.
    const huge = "\u0001".repeat(MAX_EVENT_BYTES)
    const kept = PUBLIC_JOB_KEYS.filter((key) => key !== "input_data" && key !== "output_data" && key !== "id" && key !== "user_id")
    db.job = {
      ...JOB_ROW,
      input_data: { p: "p".repeat(MAX_EVENT_BYTES) },
      output_data: { t: "t".repeat(MAX_EVENT_BYTES) },
      ...Object.fromEntries(kept.map((key) => [key, huge])),
      error_message: `failed: ${"é".repeat(MAX_EVENT_BYTES)}`,
    }
    const built = await eventBodyFor(delivery())
    if (built.kind !== "body") throw new Error("expected a body")
    expect(Buffer.byteLength(built.body, "utf8")).toBeLessThanOrEqual(MAX_EVENT_BYTES)
    const data = JSON.parse(built.body).data
    expect(data.omitted).toEqual(["input_data", "output_data"])
    expect(data.job.id).toBe(JOB)
    expect(data.job.error_message.startsWith("failed: éé")).toBe(true)
    expect(data.job.error_message.endsWith("…")).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(data.job.error_message), "utf8")).toBeLessThanOrEqual(TEXT_FIELD_MAX_BYTES)
  })

  it("cuts text by its encoded size, never inside a character", () => {
    expect(cutText("short", 2048)).toBe("short")
    const cut = cutText("😀".repeat(1000), 50)
    expect(Buffer.byteLength(JSON.stringify(cut), "utf8")).toBeLessThanOrEqual(50)
    expect([...cut.slice(0, -1)].every((ch) => ch === "😀")).toBe(true)
  })

  it("names no omission when the event fits", async () => {
    db.job = JOB_ROW
    const built = await eventBodyFor(delivery())
    if (built.kind !== "body") throw new Error("expected a body")
    expect(JSON.parse(built.body).data).not.toHaveProperty("omitted")
  })
})

describe("eventBodyFor — a retry and a ping", () => {
  it("sends the first attempt's exact text again, reading only whether the job is a child", async () => {
    const first = '{"id":"d1","type":"job.failed","createdAt":"2026-10-15T10:00:00.123Z","data":{"job":{"id":"j"}}}'
    db.job = { parent_job_id: null }
    const built = await eventBodyFor(delivery({ payload: first, attempts: 3 }))
    expect(built).toEqual({ kind: "body", body: first, fresh: false })
    expect(db.calls).toEqual([
      { table: "jobs", op: "select", args: ["parent_job_id"] },
      { table: "jobs", op: "eq", args: ["id", JOB] },
      { table: "jobs", op: "maybeSingle", args: [] },
    ])
  })

  it("never sends again a kept body recorded for a child job: the job reads as gone", async () => {
    // A body kept before the capture stopped recording child jobs (migration 550).
    const first = '{"id":"d1","type":"job.completed","createdAt":"2026-10-15T10:00:00.123Z","data":{"job":{"input_data":{"prompt":"hidden wording"}}}}'
    db.job = { parent_job_id: "00000000-0000-4000-8000-0000000000f1" }
    expect(await eventBodyFor(delivery({ payload: first, attempts: 3 }))).toEqual({ kind: "missing" })
  })

  it("never builds a body for a child job either", async () => {
    // The fresh read asks for `is(parent_job_id, null)`; this fake applies it.
    db.job = { ...JOB_ROW, parent_job_id: "00000000-0000-4000-8000-0000000000f1" }
    await eventBodyFor(delivery())
    expect(db.calls).toContainEqual({ table: "jobs", op: "is", args: ["parent_job_id", null] })
  })

  it("a test ping names its endpoint and reads nothing", async () => {
    const built = await eventBodyFor(delivery({ event: "ping", jobId: null }))
    if (built.kind !== "body") throw new Error("expected a body")
    expect(JSON.parse(built.body)).toEqual({
      id: "00000000-0000-4000-8000-0000000000d1",
      type: "ping",
      createdAt: "2026-10-15T10:00:00.123Z",
      data: { webhookId: "00000000-0000-4000-8000-0000000000e1" },
    })
    expect(db.calls).toEqual([])
  })
})
