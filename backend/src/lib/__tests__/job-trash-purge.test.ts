/**
 * The jobs Trash purge (lib/job-trash-purge.ts).
 *
 * What must hold: it lists only jobs deleted before the 30-day cutoff, oldest
 * first, in batches; it deletes each through the one job delete
 * (`deleteJobWithPrivateMedia`, media included) with the SAME cutoff, so the
 * age is re-checked under the row lock and a job restored meanwhile is kept; a
 * job another runner purged first is not counted; a database without the
 * column is nothing to do; a failure is counted, never thrown.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { argOf, has, type QueryResult, type RecordedQuery } from "./fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  pages: [] as QueryResult[],
}))
const deleteJob = vi.hoisted(() => vi.fn(async (_args: unknown) => true))

vi.mock("../supabase.js", async () => {
  const { makeFakeFrom } = await import("./fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, () => db.pages.shift() ?? { data: [], error: null }) } }
})
vi.mock("../workflow-delete.js", () => ({ deleteJobWithPrivateMedia: deleteJob }))
const gate = vi.hoisted(() => ({ on: true }))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  scheduleTriggersEnabled: () => gate.on,
}))

import { PURGE_BATCH, PURGE_MAX_ROUNDS, purgeExpiredTrashedJobs, startJobTrashPurge } from "../job-trash-purge.js"
import { TRASH_RETENTION_DAYS, purgeAtOf } from "../job-trash.js"

const NOW = Date.parse("2026-11-30T12:00:00.000Z")
const CUTOFF = "2026-10-31T12:00:00.000Z"
const ids = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `job-${String(from + i).padStart(4, "0")}`, deleted_at: "2026-10-01T00:00:00+00:00" }))

beforeEach(() => {
  db.log.length = 0
  db.pages.length = 0
  deleteJob.mockReset()
  deleteJob.mockResolvedValue(true)
})

describe("purgeExpiredTrashedJobs", () => {
  it("is 30 days, the same rule the Trash shows as purgeAt", () => {
    expect(TRASH_RETENTION_DAYS).toBe(30)
    expect(purgeAtOf(CUTOFF)).toBe(new Date(NOW).toISOString())
  })

  it("lists only jobs deleted before the cutoff, oldest first, and deletes each under the same cutoff", async () => {
    db.pages.push({ data: ids(2), error: null })
    const result = await purgeExpiredTrashedJobs(NOW)
    expect(result).toEqual({ purged: 2, failed: 0 })
    const [list] = db.log
    expect(list!.table).toBe("jobs")
    expect(has(list!, "not", "deleted_at", "is", null)).toBe(true)
    expect(has(list!, "lt", "deleted_at", CUTOFF)).toBe(true)
    expect(has(list!, "order", "deleted_at", { ascending: true })).toBe(true)
    expect(has(list!, "order", "id", { ascending: true })).toBe(true)
    expect(argOf(list!, "or")).toBeUndefined()
    expect(has(list!, "limit", PURGE_BATCH)).toBe(true)
    expect(argOf(list!, "update")).toBeUndefined()
    expect(deleteJob).toHaveBeenCalledTimes(2)
    expect(deleteJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-0000", isAdmin: true, actorUserId: null, onlyTrashedBefore: CUTOFF }))
  })

  it("pages through a full batch strictly after its last row, and stops at a short one", async () => {
    db.pages.push({ data: ids(PURGE_BATCH), error: null }, { data: ids(3, PURGE_BATCH), error: null })
    const result = await purgeExpiredTrashedJobs(NOW)
    expect(result.purged).toBe(PURGE_BATCH + 3)
    expect(db.log).toHaveLength(2)
    const last = ids(PURGE_BATCH)[PURGE_BATCH - 1]!
    expect(argOf(db.log[1]!, "or")).toEqual([
      `deleted_at.gt."${last.deleted_at}",and(deleted_at.eq."${last.deleted_at}",id.gt."${last.id}")`,
    ])
  })

  it("a page whose every job fails, or was taken by another runner, does not hold the next page back", async () => {
    db.pages.push({ data: ids(PURGE_BATCH), error: null }, { data: ids(2, PURGE_BATCH), error: null })
    deleteJob.mockResolvedValueOnce(false)
    for (let i = 1; i < PURGE_BATCH; i++) deleteJob.mockRejectedValueOnce(new Error("locked"))
    const result = await purgeExpiredTrashedJobs(NOW)
    expect(result).toEqual({ purged: 2, failed: PURGE_BATCH - 1 })
    expect(db.log).toHaveLength(2)
  })

  it("stops after its rounds, the rest for the next tick", async () => {
    for (let r = 0; r < PURGE_MAX_ROUNDS + 2; r++) db.pages.push({ data: ids(PURGE_BATCH, r * PURGE_BATCH), error: null })
    await purgeExpiredTrashedJobs(NOW)
    expect(db.log).toHaveLength(PURGE_MAX_ROUNDS)
  })

  it("counts a failed delete and goes on with the rest", async () => {
    db.pages.push({ data: ids(2), error: null })
    deleteJob.mockRejectedValueOnce(new Error("storage down"))
    const result = await purgeExpiredTrashedJobs(NOW)
    expect(result).toEqual({ purged: 1, failed: 1 })
  })

  it("a database without deleted_at (before migration 561) is nothing to do", async () => {
    db.pages.push({ data: null, error: { code: "42703", message: "column jobs.deleted_at does not exist" } })
    expect(await purgeExpiredTrashedJobs(NOW)).toEqual({ purged: 0, failed: 0 })
    expect(deleteJob).not.toHaveBeenCalled()
  })

  it("any other read error is one failure, never a throw", async () => {
    db.pages.push({ data: null, error: { code: "57014", message: "timeout" } })
    expect(await purgeExpiredTrashedJobs(NOW)).toEqual({ purged: 0, failed: 1 })
  })
})

describe("startJobTrashPurge", () => {
  it("runs nothing where scheduled workflows do not fire (staging, a local backend on the shared database)", async () => {
    gate.on = false
    const stop = startJobTrashPurge(() => {})
    await stop()
    expect(db.log).toHaveLength(0)
    gate.on = true
  })

  it("purges on start where they do", async () => {
    db.pages.push({ data: ids(1), error: null })
    const stop = startJobTrashPurge(() => {})
    await stop()
    expect(deleteJob).toHaveBeenCalledTimes(1)
  })
})
