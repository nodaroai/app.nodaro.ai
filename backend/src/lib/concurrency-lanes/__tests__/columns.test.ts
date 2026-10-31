// The lane columns (migration 568) until they reach the shared database:
// staging runs dev against it, and migrations apply only at dev→main. A
// missing column is remembered for the life of the process; nothing it names
// is ever part of a write that matters.
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload: unknown; filters: Array<[string, string, unknown]>; opts?: unknown }>,
  /** Answers an error for any statement whose table or payload names a matching key. */
  errorFor: null as null | ((call: { table: string; op: string; payload: unknown }) => { code: string; message: string } | null),
  /** What a select().eq().maybeSingle() read answers. */
  row: null as Record<string, unknown> | null,
  /** The rows an update(…).select(…) answers (the row as the stamp found it); [] = the row no longer waits. */
  returned: [{ status: "pending", lane_queued_at: null }] as Array<Record<string, unknown>>,
}))
vi.mock("../../supabase.js", () => {
  const from = (table: string) => {
    const call = { table, op: "", payload: undefined as unknown, filters: [] as Array<[string, string, unknown]>, opts: undefined as unknown, returning: undefined as unknown }
    const chain: Record<string, unknown> = {}
    const write = (op: string) => (payload: unknown, opts?: unknown) => {
      call.op = op
      call.payload = payload
      call.opts = opts
      db.calls.push(call)
      return chain
    }
    chain.update = write("update")
    chain.upsert = write("upsert")
    const select = write("select")
    chain.select = (cols: unknown) => {
      if (call.op !== "update") return select(cols)
      call.returning = cols
      return chain
    }
    chain.maybeSingle = () => {
      const error = db.errorFor?.(call) ?? null
      return Promise.resolve({ data: error ? null : db.row, error })
    }
    chain.eq = (c: string, v: unknown) => { call.filters.push(["eq", c, v]); return chain }
    chain.is = (c: string, v: unknown) => { call.filters.push(["is", c, v]); return chain }
    chain.in = (c: string, v: unknown) => { call.filters.push(["in", c, v]); return chain }
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      const error = db.errorFor?.(call) ?? null
      return Promise.resolve({ data: error || call.returning === undefined ? null : db.returned, error }).then(res, rej)
    }
    return chain
  }
  return { supabase: { from } }
})

const { bullEntryFields, claimWithBullEntry, laneColumnsAbsent, noteLaneColumnError, readBullEntry, resetLaneColumnsForTests, stampQueued } = await import("../columns.js")

const namesLaneColumn = (payload: unknown) => Object.keys((payload ?? {}) as object).some((k) => k.startsWith("lane_"))

beforeEach(() => {
  resetLaneColumnsForTests()
  db.calls = []
  db.errorFor = null
  db.row = null
  db.returned = [{ status: "pending", lane_queued_at: null }]
  vi.restoreAllMocks()
})

describe("claimWithBullEntry", () => {
  type R = { data: unknown; error: { code: string; message: string } | null }
  const ok: R = { data: [{ id: "job-1" }], error: null }
  const missing = (column: string): R => ({ data: null, error: { code: "PGRST204", message: `Could not find the '${column}' column of 'jobs' in the schema cache` } })

  it("one claim, carrying the job's BullMQ entry", async () => {
    const claim = vi.fn(async (_fields: Record<string, string>) => ok)
    expect(await claimWithBullEntry("video-generation", "bull-1", claim)).toBe(ok)
    expect(claim.mock.calls).toEqual([[{ lane_bull_queue: "video-generation", lane_bull_job_id: "bull-1" }]])
  })

  it("lane columns missing: the claim runs again without them, succeeds, and they are never named again", async () => {
    const claim = vi.fn(async (fields: Record<string, string>) => (Object.keys(fields).length > 0 ? missing("lane_bull_job_id") : ok))
    expect(await claimWithBullEntry("video-generation", "bull-1", claim)).toBe(ok)
    expect(laneColumnsAbsent("jobs")).toBe(true)
    expect(await claimWithBullEntry("video-render", "bull-2", claim)).toBe(ok)
    expect(claim.mock.calls.map(([f]) => Object.keys(f).length > 0)).toEqual([true, false, false])
    expect(bullEntryFields("video-generation", "bull-3")).toEqual({})
  })

  it("another missing column (the caller's): returned for the caller's retry, and the lane columns are not blamed", async () => {
    const claim = vi.fn(async (_fields: Record<string, string>) => missing("slot_wait_ms"))
    expect((await claimWithBullEntry("video-generation", "bull-1", claim)).error?.message).toContain("slot_wait_ms")
    expect(laneColumnsAbsent("jobs")).toBe(false)
    expect(claim).toHaveBeenCalledTimes(2)
  })

  it("any other error is returned as is, after one statement", async () => {
    const claim = vi.fn(async (_fields: Record<string, string>): Promise<R> => ({ data: null, error: { code: "57014", message: "statement timeout" } }))
    expect((await claimWithBullEntry("video-generation", "bull-1", claim)).error?.code).toBe("57014")
    expect(claim).toHaveBeenCalledTimes(1)
    expect(laneColumnsAbsent("jobs")).toBe(false)
  })

  it("no entry id: the claim names no lane column", async () => {
    const claim = vi.fn(async (_fields: Record<string, string>) => ok)
    await claimWithBullEntry("video-generation", undefined, claim)
    expect(claim.mock.calls).toEqual([[{}]])
  })
})

describe("noteLaneColumnError", () => {
  it("PostgREST's unknown-column code counts, per table; any other error does not", () => {
    expect(noteLaneColumnError("pipelines", { code: "PGRST204" })).toBe(true)
    expect(laneColumnsAbsent("pipelines")).toBe(true)
    expect(laneColumnsAbsent("jobs")).toBe(false)
    for (const other of [{ code: "23505" }, { code: null }, {}, null, undefined]) expect(noteLaneColumnError("jobs", other)).toBe(false)
    expect(laneColumnsAbsent("jobs")).toBe(false)
  })
})

describe("stampQueued", () => {
  it("stamps a row that still waits: environment and BullMQ entry, lane_queued_at only when unset, and the requeue payload", async () => {
    expect(await stampQueued("jobs", "job-1", {
      bullQueue: "video-generation", bullJobId: "bull-1", requeue: { name: "image-to-video", data: { jobId: "job-1" }, opts: { priority: 5, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { count: 1000 }, removeOnFail: undefined } },
    })).toEqual({ row: "stamped", status: "pending", payloadStored: true })
    expect(db.calls[0]).toMatchObject({
      table: "jobs", payload: { lane_env: expect.any(String), lane_bull_queue: "video-generation", lane_bull_job_id: "bull-1" },
      filters: [["eq", "id", "job-1"], ["in", "status", ["pending", "queued"]]], returning: "status, lane_queued_at",
    })
    expect(db.calls[1]).toMatchObject({ table: "jobs", payload: { lane_queued_at: expect.any(String) }, filters: [["eq", "id", "job-1"], ["is", "lane_queued_at", null]] })
    expect(db.calls[2]).toMatchObject({
      table: "lane_requeue_payloads", op: "upsert",
      payload: { kind: "job", row_id: "job-1", bull_queue: "video-generation", bull_job_id: "bull-1", name: "image-to-video", data: { jobId: "job-1" }, opts: { priority: 5, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { count: 1000 } } },
      opts: { onConflict: "kind,row_id" },
    })
  })

  it("a re-park whose row already has lane_queued_at is stamped without touching it", async () => {
    db.returned = [{ status: "queued", lane_queued_at: "2026-10-31T10:00:00.000Z" }]
    expect(await stampQueued("jobs", "job-1", { bullQueue: "video-generation", bullJobId: "b", requeue: null }))
      .toEqual({ row: "stamped", status: "queued", payloadStored: true })
    expect(db.calls.filter((c) => Object.keys((c.payload ?? {}) as object).includes("lane_queued_at"))).toEqual([])
  })

  it("a row that no longer waits is not stamped any further", async () => {
    db.returned = []
    expect(await stampQueued("jobs", "job-1", { bullQueue: "video-generation", bullJobId: "b", requeue: { name: "x", data: {}, opts: {} } }))
      .toEqual({ row: "not-waiting", status: null, payloadStored: false })
    expect(db.calls).toHaveLength(1)
  })

  it("names no BullMQ column on an execution or a pipeline (568 adds them to jobs only)", async () => {
    await stampQueued("workflow_executions", "exec-1", { bullQueue: "workflow-orchestration", bullJobId: "b", requeue: null })
    await stampQueued("pipelines", "pipe-1", { bullQueue: "pipeline-orchestration", bullJobId: "b", requeue: null })
    for (const c of db.calls) {
      expect(Object.keys(c.payload as object)).not.toContain("lane_bull_queue")
      expect(Object.keys(c.payload as object)).not.toContain("lane_bull_job_id")
    }
    expect(db.calls[0]!.filters).toContainEqual(["in", "status", ["pending"]])
    expect(db.calls.filter((c) => c.table === "lane_requeue_payloads")).toEqual([])
  })

  it("a table without the columns is remembered and reports the row unstamped without another write", async () => {
    db.errorFor = ({ payload }) => (namesLaneColumn(payload) ? { code: "PGRST204", message: "Could not find the 'lane_env' column" } : null)
    expect((await stampQueued("jobs", "job-1", { bullQueue: "video-generation", bullJobId: "b", requeue: null })).row).toBe("failed")
    expect((await stampQueued("jobs", "job-2", { bullQueue: "video-generation", bullJobId: "b", requeue: null })).row).toBe("failed")
    expect(db.calls).toHaveLength(1)
  })

  it("a failed lane_queued_at write reports the row unstamped", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    db.errorFor = ({ payload }) => (Object.keys((payload ?? {}) as object).includes("lane_queued_at") ? { code: "57014", message: "statement timeout" } : null)
    expect(await stampQueued("jobs", "job-1", { bullQueue: "video-generation", bullJobId: "b", requeue: null })).toEqual({ row: "failed", status: null, payloadStored: false })
    expect(laneColumnsAbsent("jobs")).toBe(false)
  })

  it("a missing requeue table leaves the row stamped, says the payload is not stored, and is not asked again", async () => {
    db.errorFor = ({ table }) => (table === "lane_requeue_payloads" ? { code: "PGRST205", message: "Could not find the table" } : null)
    const stamp = { bullQueue: "video-generation" as const, bullJobId: "b", requeue: { name: "x", data: {}, opts: {} } }
    expect(await stampQueued("jobs", "job-1", stamp)).toEqual({ row: "stamped", status: "pending", payloadStored: false })
    expect(await stampQueued("jobs", "job-2", stamp)).toEqual({ row: "stamped", status: "pending", payloadStored: false })
    expect(db.calls.filter((c) => c.table === "lane_requeue_payloads")).toHaveLength(1)
  })
})

describe("readBullEntry", () => {
  it("reads the BullMQ entry a job was stamped with", async () => {
    db.row = { status: "queued", lane_bull_queue: "video-generation", lane_bull_job_id: "bull-7" }
    expect(await readBullEntry("job-7")).toEqual({ queue: "video-generation", bullJobId: "bull-7", status: "queued" })
    expect(db.calls).toEqual([expect.objectContaining({ table: "jobs", op: "select", payload: "status, lane_bull_queue, lane_bull_job_id", filters: [["eq", "id", "job-7"]] })])
  })

  it("answers null for a job with no stamp, or a half one", async () => {
    db.row = { lane_bull_queue: null, lane_bull_job_id: null }
    expect(await readBullEntry("job-1")).toBeNull()
    db.row = { lane_bull_queue: "video-generation", lane_bull_job_id: null }
    expect(await readBullEntry("job-1")).toBeNull()
    db.row = null
    expect(await readBullEntry("job-1")).toBeNull()
  })

  it("a database without the columns answers null, is remembered, and is not asked again", async () => {
    db.errorFor = ({ op }) => (op === "select" ? { code: "42703", message: 'column "lane_bull_queue" does not exist' } : null)
    expect(await readBullEntry("job-1")).toBeNull()
    expect(await readBullEntry("job-2")).toBeNull()
    expect(db.calls).toHaveLength(1)
    expect(laneColumnsAbsent("jobs")).toBe(true)
  })

  it("any other error answers null, is logged and never thrown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    db.errorFor = () => ({ code: "57014", message: "statement timeout" })
    await expect(readBullEntry("job-1")).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    expect(laneColumnsAbsent("jobs")).toBe(false)
  })
})
