/**
 * A permanent delete releases the cover copies of the jobs it takes with it
 * (decided 2026-11-23, review round): the covers are read BEFORE the delete
 * (the rows are gone after it), released only once it really deleted, each
 * as its owner's — through the one job delete every path uses (the Trash's
 * "delete forever", its 30-day purge, a trend run's delete), and through the
 * workflow and project deletes that cascade their jobs away. A failed read
 * never blocks the delete.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  tables: { jobs: [] as Row[], workflows: [] as Row[] } as Record<string, Row[]>,
  failJobs: false,
  noCoverColumn: false,
  rpc: vi.fn(),
  release: vi.fn(),
  order: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let cols = ""
    const q = {
      select: (c: string) => ((cols = c), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      not: (c: string, _op: string, v: unknown) => (filters.push((r) => (r[c] ?? null) !== v), q),
      limit: () => q,
      then: (resolve: (v: unknown) => unknown) => {
        h.order.push(`read:${table}`)
        if (h.noCoverColumn && table === "jobs" && cols.includes("cover_url")) {
          return Promise.resolve({ data: null, error: { code: "42703", message: "column jobs.cover_url does not exist" } }).then(resolve)
        }
        if (h.failJobs && table === "jobs") return Promise.resolve({ data: null, error: { message: "down" } }).then(resolve)
        return Promise.resolve({ data: (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }).then(resolve)
      },
    }
    return q
  }
  return { supabase: { from, rpc: (...a: unknown[]) => (h.order.push("rpc"), h.rpc(...a)) } }
})
vi.mock("@/lib/job-cover/cover-store.js", () => ({ releaseCoversOfJobs: (...a: unknown[]) => (h.order.push("release"), h.release(...a)) }))
vi.mock("@/lib/relay-possible.js", () => ({ relayPossible: () => false }))

import { deleteJobWithPrivateMedia, deleteProjectWithPrivateMedia, deleteWorkflowWithPrivateMedia } from "../../workflow-delete.js"
import { setCoverColumnPresentForTests } from "../../jobs-cover-column.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const JOB = "00000000-0000-4000-8000-0000000000c1"
const WF = "00000000-0000-4000-8000-0000000000f1"
const PROJECT = "00000000-0000-4000-8000-0000000000d1"
const COVER = `https://cdn.test/job-covers/${OWNER}/cover-1.png`

beforeEach(() => {
  h.tables = {
    jobs: [
      { id: JOB, user_id: OWNER, workflow_id: WF, cover_url: COVER },
      { id: "j-none", user_id: OWNER, workflow_id: WF, cover_url: null },
      { id: "j-other", user_id: OTHER, workflow_id: "wf-other", cover_url: `https://cdn.test/job-covers/${OTHER}/cover-2.png` },
    ],
    workflows: [{ id: WF, project_id: PROJECT, user_id: OWNER }],
  }
  h.failJobs = false
  h.noCoverColumn = false
  h.order = []
  h.rpc.mockReset().mockResolvedValue({ data: { deleted: true, baseUrls: [] }, error: null })
  h.release.mockReset().mockResolvedValue(undefined)
  setCoverColumnPresentForTests(true)
})
afterEach(() => setCoverColumnPresentForTests(false))

describe("a permanent delete releases its jobs' covers", () => {
  it("a job delete (the Trash's delete forever, its purge, a trend run's delete): read before, released after, as the owner's", async () => {
    // The purge acts with no actor: the owner comes from the row, never the actor.
    expect(await deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: null, isAdmin: true, onlyTrashedBefore: "infinity" })).toBe(true)
    expect(h.release).toHaveBeenCalledWith([{ userId: OWNER, coverUrl: COVER }])
    expect(h.order).toEqual(["read:jobs", "rpc", "release"])
  })

  it("a delete that did not happen (a job restored meanwhile) releases nothing", async () => {
    h.rpc.mockResolvedValue({ data: { deleted: false, baseUrls: [] }, error: null })
    expect(await deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: OWNER, isAdmin: false, onlyTrashedBefore: "infinity" })).toBe(false)
    expect(h.release).not.toHaveBeenCalled()
  })

  it("a workflow delete and a project delete release the covers of the jobs they cascade away, the owner's only", async () => {
    await deleteWorkflowWithPrivateMedia({ workflowId: WF, userId: OWNER })
    expect(h.release).toHaveBeenLastCalledWith([{ userId: OWNER, coverUrl: COVER }])
    await deleteProjectWithPrivateMedia({ projectId: PROJECT, userId: OWNER })
    expect(h.release).toHaveBeenLastCalledWith([{ userId: OWNER, coverUrl: COVER }])
  })

  it("a failed cover read never blocks the delete (the copies stay in storage)", async () => {
    h.failJobs = true
    expect(await deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: OWNER, isAdmin: false })).toBe(true)
    expect(h.rpc).toHaveBeenCalled()
    expect(h.release).toHaveBeenCalledWith([])
  })

  it("a process that has not seen the column yet asks the database first: it still finds the cover", async () => {
    setCoverColumnPresentForTests(false)
    await deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: OWNER, isAdmin: false })
    expect(h.release).toHaveBeenCalledWith([{ userId: OWNER, coverUrl: COVER }])
  })

  it("a database without the column: the probe says so, nothing more is read, the delete goes on", async () => {
    setCoverColumnPresentForTests(false)
    h.noCoverColumn = true
    await deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: OWNER, isAdmin: false })
    expect(h.order).toEqual(["read:jobs", "rpc", "release"])
    expect(h.release).toHaveBeenCalledWith([])
  })
})
