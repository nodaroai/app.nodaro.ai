/**
 * deleteTrendTestRun (lib/trends/run-delete.ts) — an admin's test run and its
 * media, in the order that keeps every proof intact.
 *
 * What must hold:
 *  - a run with anything in flight (itself or a child job) deletes nothing;
 *  - the run's library rows go through the library's permanent delete BEFORE
 *    the job row goes (that delete proves ownership through the job);
 *  - the run's other own files are deleted only after the job row, never one a
 *    library row still names, never one the relay rule keeps, and never a key
 *    outside the job's own family;
 *  - only the run owner's jobs are read as the run's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { QueryResult, RecordedQuery } from "../../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  jobs: [] as Array<{ id: string; user_id: string; parent_job_id: string | null; status: string; output_data: unknown }>,
  assets: [] as Array<{ id: string; user_id: string; r2_key: string | null; size_bytes: number | null; job_id: string | null; relay_job_id: string | null }>,
}))
const steps = vi.hoisted(() => ({ order: [] as string[], keptByRelay: new Set<string>(), r2Deleted: true }))

vi.mock("../../../../lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../../lib/__tests__/fake-supabase-query.js")
  const respond = (q: RecordedQuery): QueryResult => {
    const eq = (col: string) => q.ops.find((op) => op.m === "eq" && op.a[0] === col)?.a[1]
    const inn = (col: string) => q.ops.find((op) => op.m === "in" && op.a[0] === col)?.a[1] as unknown[] | undefined
    if (q.table === "jobs") {
      const owner = eq("user_id")
      const byId = eq("id")
      const parents = inn("parent_job_id")
      const rows = db.jobs.filter((j) => (owner === undefined || j.user_id === owner) && (byId === undefined || j.id === byId) && (!parents || parents.includes(j.parent_job_id)))
      return { data: rows, error: null }
    }
    if (q.table === "assets") {
      const owner = eq("user_id")
      const jobIds = inn("job_id")
      const keys = inn("r2_key")
      const rows = db.assets.filter((a) => (owner === undefined || a.user_id === owner) && (!jobIds || jobIds.includes(a.job_id)) && (!keys || keys.includes(a.r2_key)))
      return { data: rows, error: null }
    }
    return { data: null, error: null }
  }
  return { supabase: { from: makeFakeFrom(db.log, respond) } }
})

vi.mock("../../../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, R2_PUBLIC_URL: "https://cdn.test" } }
})

vi.mock("../../../../lib/asset-delete.js", () => ({
  permanentlyDeleteAsset: async (opts: { userId: string; asset: { id: string; r2_key: string | null } }) => {
    steps.order.push(`asset:${opts.asset.id}`)
    // The library delete reads the job that made the key: it must still exist.
    expect(steps.order).not.toContain("job-delete")
    db.assets = db.assets.filter((a) => a.id !== opts.asset.id)
    return { ok: true, r2Deleted: steps.r2Deleted }
  },
  deletableKeys: async (keys: readonly string[]) => keys.filter((k) => !steps.keptByRelay.has(k)),
}))

vi.mock("../../../../lib/workflow-delete.js", () => ({
  deleteJobWithPrivateMedia: async (args: { jobId: string; isAdmin: boolean }) => {
    steps.order.push("job-delete")
    expect(args.isAdmin).toBe(true)
    const before = db.jobs.length
    db.jobs = db.jobs.filter((j) => j.id !== args.jobId && j.parent_job_id !== args.jobId)
    return db.jobs.length < before
  },
}))

const deletedKeys: string[][] = []
vi.mock("../../../../lib/storage-delete.js", () => ({
  deleteKeysRecordingFailures: async (keys: readonly string[], source: string) => {
    steps.order.push("files-delete")
    expect(source).toBe("job-output")
    deletedKeys.push([...keys])
    return { deleted: keys.length, errors: 0, failed: [] }
  },
}))

import { TrendRunInFlightError, deleteTrendTestRun } from "../run-delete.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const OTHER = "00000000-0000-4000-8000-0000000000ee"
const RUN = "00000000-0000-4000-8000-0000000000b1"
const CHILD = "00000000-0000-4000-8000-0000000000c1"
const STRANGER_JOB = "00000000-0000-4000-8000-0000000000d1"

function job(id: string, over: Partial<(typeof db.jobs)[number]> = {}) {
  return { id, user_id: ADMIN, parent_job_id: null, status: "completed", output_data: {}, ...over }
}

beforeEach(() => {
  db.log.length = 0
  db.jobs = []
  db.assets = []
  steps.order = []
  steps.keptByRelay = new Set()
  steps.r2Deleted = true
  deletedKeys.length = 0
})

describe("deleteTrendTestRun", () => {
  it("removes library rows first, then the job, then the run's other own files", async () => {
    db.jobs = [
      job(RUN, {
        output_data: {
          videoUrl: `https://cdn.test/videos/${RUN}.mp4`,
          thumbnailUrl: `https://cdn.test/images/${RUN}-poster.png`,
          // An input echoed back: another job's file, not this run's to delete.
          sourceUrl: `https://cdn.test/videos/${STRANGER_JOB}.mp4`,
        },
      }),
      job(CHILD, { parent_job_id: RUN, output_data: { imageUrl: `https://cdn.test/images/${CHILD}.png` } }),
    ]
    db.assets = [
      { id: "a1", user_id: ADMIN, r2_key: `videos/${RUN}.mp4`, size_bytes: 10, job_id: RUN, relay_job_id: null },
      { id: "a2", user_id: ADMIN, r2_key: `images/${CHILD}.png`, size_bytes: 5, job_id: CHILD, relay_job_id: null },
    ]
    const result = await deleteTrendTestRun({ runId: RUN, ownerId: ADMIN, actorUserId: ADMIN })
    expect(steps.order).toEqual(["asset:a1", "asset:a2", "job-delete", "files-delete"])
    expect(deletedKeys).toEqual([[`images/${RUN}-poster.png`]])
    expect(result).toEqual({ deleted: true, libraryRows: 2, filesDeleted: 3, filesKept: 0 })
    expect(db.jobs).toEqual([])
  })

  it("deletes nothing while the run or one of its child jobs is still running", async () => {
    db.jobs = [job(RUN), job(CHILD, { parent_job_id: RUN, status: "processing" })]
    db.assets = [{ id: "a1", user_id: ADMIN, r2_key: `videos/${RUN}.mp4`, size_bytes: 10, job_id: RUN, relay_job_id: null }]
    await expect(deleteTrendTestRun({ runId: RUN, ownerId: ADMIN, actorUserId: ADMIN })).rejects.toBeInstanceOf(TrendRunInFlightError)
    expect(steps.order).toEqual([])
    expect(db.jobs).toHaveLength(2)
  })

  it("keeps a file another library row still names, and one the relay rule keeps", async () => {
    db.jobs = [
      job(RUN, {
        output_data: { a: `https://cdn.test/images/${RUN}-a.png`, b: `https://cdn.test/images/${RUN}-b.png`, c: `https://cdn.test/images/${RUN}-c.png` },
      }),
    ]
    // Someone saved `-a` into their library: that row keeps it alive.
    db.assets = [{ id: "theirs", user_id: OTHER, r2_key: `images/${RUN}-a.png`, size_bytes: 1, job_id: null, relay_job_id: null }]
    steps.keptByRelay = new Set([`images/${RUN}-b.png`])
    const result = await deleteTrendTestRun({ runId: RUN, ownerId: ADMIN, actorUserId: ADMIN })
    expect(deletedKeys).toEqual([[`images/${RUN}-c.png`]])
    expect(result).toMatchObject({ libraryRows: 0, filesDeleted: 1, filesKept: 2 })
    expect(db.assets).toHaveLength(1)
  })

  it("counts a library object the library delete kept", async () => {
    db.jobs = [job(RUN)]
    db.assets = [{ id: "a1", user_id: ADMIN, r2_key: `videos/${RUN}.mp4`, size_bytes: 10, job_id: RUN, relay_job_id: null }]
    steps.r2Deleted = false
    expect(await deleteTrendTestRun({ runId: RUN, ownerId: ADMIN, actorUserId: ADMIN })).toMatchObject({ libraryRows: 1, filesDeleted: 0, filesKept: 1 })
  })

  it("reads only the owner's jobs as the run's, and reports a run already gone", async () => {
    db.jobs = [job(RUN, { user_id: OTHER })]
    expect(await deleteTrendTestRun({ runId: RUN, ownerId: ADMIN, actorUserId: ADMIN })).toEqual({ deleted: false, libraryRows: 0, filesDeleted: 0, filesKept: 0 })
    expect(steps.order).toEqual([])
  })
})
