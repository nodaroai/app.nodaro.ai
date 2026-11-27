// @test-watches backend/src/**/*.ts
/**
 * A delete for good gives back what its jobs recorded as stored (decided
 * 2026-11-25): the delete function itself reads those records under the row
 * lock, in its own transaction, and answers the bytes per owner
 * (`storedBytesByOwner`, migration 708); lib/workflow-delete.ts gives them
 * back only when the delete really happened. The RPC below behaves as that
 * migration's functions do, and the claim as migration 695's
 * `claim_job_stored_objects` does (a gone row answers no owner, nothing
 * claimed), so each recorded byte comes back exactly once in every order.
 *
 * The same answer carries the files those records held (`recordedFilesByJob`,
 * migration 736): the delete removes each one nothing still uses
 * (lib/deleted-job-files.ts), and removing it gives nothing back a second time.
 */
import ts from "typescript"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { eachSourceFile, lineOf, walk } from "./source-scan.js"

interface JobRow {
  id: string
  user_id: string | null
  workflow_id: string | null
  parent_job_id: string | null
  server_output: { stored: Record<string, number> } | null
  output_data?: Record<string, unknown> | null
}

const db = vi.hoisted(() => ({
  jobs: new Map<string, JobRow>(),
  usage: [] as Array<[string, number]>,
  deleted: [] as string[],
  /** The delete refuses (a trigger, an error): the transaction rolls back. */
  refuse: false,
  /** The delete function answers without the field (migration 708 not applied). */
  oldFunction: false,
  /** The deployment keeps storage accounts (the give-back writes them). */
  credits: true,
  /** The storage account write fails. */
  usageFails: false,
  /** Library rows (any user's): what each names. */
  assets: [] as Array<{ id: string; r2_key: string; job_id: string | null }>,
  /** The workflows of each project. */
  projectWorkflows: new Map<string, string[]>(),
  /** Jobs moved to the Trash, with what the move wrote. */
  trashed: [] as Array<[string, Record<string, unknown>]>,
  /** How the bucket answers a delete. */
  bucket: "ok" as "ok" | "fails" | "throws",
  /** Keys handed to the storage-delete retry pass, with their source. */
  retried: [] as Array<[string, string]>,
}))

const CDN = vi.hoisted(() => "https://cdn.test")

/** What `job_output_urls` reads: every http(s) string at any depth. */
function urlsIn(value: unknown): string[] {
  if (typeof value === "string") return /^https?:\/\//.test(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(urlsIn)
  if (value && typeof value === "object") return Object.values(value).flatMap(urlsIn)
  return []
}

/** `deleted_jobs_recorded_files` (migration 736) over the jobs a delete takes. */
function recordedFilesByJob(ids: string[]): Record<string, { recorded: string[]; named: string[] }> {
  const out: Record<string, { recorded: string[]; named: string[] }> = {}
  for (const id of ids) {
    const row = db.jobs.get(id)!
    const recorded = Object.keys(row.server_output?.stored ?? {}).sort()
    if (recorded.length === 0) continue
    const { originalVideoUrl: _original, ...rest } = row.output_data ?? {}
    out[id] = { recorded, named: [...new Set(urlsIn(rest))].filter((u) => u.toLowerCase().includes(id)).sort() }
  }
  return out
}

/** The jobs a delete cascades away: the start set and every child by parent_job_id. */
function cascade(start: string[]): string[] {
  const out = new Set(start)
  let grew = true
  while (grew) {
    grew = false
    for (const j of db.jobs.values()) if (j.parent_job_id && out.has(j.parent_job_id) && !out.has(j.id)) { out.add(j.id); grew = true }
  }
  return [...out]
}

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      // Moving a job to the Trash (lib/job-trash.ts): an update that stamps the row.
      update: (patch: Record<string, unknown>) => {
        const chain = {
          eq: (col: string, value: unknown) => {
            if (col === "id") db.trashed.push([String(value), patch])
            return chain
          },
          is: () => chain,
          select: async () => ({ data: db.trashed.map(([id]) => ({ id })), error: null }),
        }
        return chain
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        // The Library rows naming a set of keys (lib/key-ownership.ts).
        in: async (_col: string, keys: string[]) => ({ data: table === "assets" ? db.assets.filter((a) => keys.includes(a.r2_key)) : [], error: null }),
      }),
    })),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "increment_storage") {
        if (db.usageFails) return { data: null, error: { message: "timeout" } }
        db.usage.push([String(args.p_user_id), Number(args.p_bytes)])
        return { data: null, error: null }
      }
      if (fn === "claim_job_stored_objects") {
        const row = db.jobs.get(String(args.p_job_id))
        const claimed: Record<string, number> = {}
        if (row?.server_output) {
          for (const k of args.p_keys as string[]) {
            if (k in row.server_output.stored) {
              claimed[k] = row.server_output.stored[k]!
              delete row.server_output.stored[k]
            }
          }
        }
        return { data: { owner: row?.user_id ?? null, claimed }, error: null }
      }
      // No other job's output and no in-flight job's input names anything here.
      if (fn === "urls_linked_by_jobs_since" || fn === "in_flight_job_inputs_naming") return { data: [], error: null }
      let ids: string[]
      if (fn === "delete_job_with_recast_cleanup" || fn === "delete_trashed_job_with_recast_cleanup") {
        const row = db.jobs.get(String(args.p_job_id))
        if (!row || (!args.p_is_admin && row.user_id !== args.p_actor_user_id)) return { data: { deleted: false, baseUrls: [] }, error: null }
        ids = cascade([row.id])
      } else if (fn === "delete_workflow_with_recast_cleanup") {
        ids = cascade([...db.jobs.values()].filter((j) => j.workflow_id === args.p_workflow_id).map((j) => j.id))
      } else if (fn === "delete_project_with_recast_cleanup") {
        const workflows = db.projectWorkflows.get(String(args.p_project_id)) ?? []
        ids = cascade([...db.jobs.values()].filter((j) => j.workflow_id !== null && workflows.includes(j.workflow_id)).map((j) => j.id))
      } else {
        return { data: null, error: { message: `unexpected ${fn}` } }
      }
      if (db.refuse) return { data: null, error: { message: "refused" } }
      const stored: Record<string, number> = {}
      for (const id of ids) {
        const row = db.jobs.get(id)!
        const bytes = Object.values(row.server_output?.stored ?? {}).reduce((a, b) => a + b, 0)
        if (row.user_id && bytes > 0) stored[row.user_id] = (stored[row.user_id] ?? 0) + bytes
      }
      const files = recordedFilesByJob(ids)
      for (const id of ids) db.jobs.delete(id)
      return { data: { deleted: true, baseUrls: [], ...(db.oldFunction ? {} : { storedBytesByOwner: stored, recordedFilesByJob: files }) }, error: null }
    }),
  },
}))
vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(async (uid: string, delta: number) => { db.usage.push([uid, delta]) }),
}))
vi.mock("../storage-delete.js", () => ({
  deleteKeysRecordingFailures: vi.fn(async (keys: string[], source: string) => {
    if (db.bucket === "throws") throw new Error("storage down")
    if (db.bucket === "fails") {
      // Not confirmed gone: the funnel records each for the retry pass.
      db.retried.push(...keys.map((key) => [key, source] as [string, string]))
      return { deleted: 0, errors: keys.length, notDeleted: keys, failed: keys }
    }
    db.deleted.push(...keys)
    return { deleted: keys.length, errors: 0, notDeleted: [], failed: [] }
  }),
  deleteKeyRecordingFailure: vi.fn(async (key: string) => { db.deleted.push(key) }),
  isRetryableDeleteKey: () => true,
  publicUrlOfKey: (key: string) => `${CDN}/${key}`,
  keyFailures: vi.fn((keys: string[], source: string) => keys.map((key) => ({ key, source }))),
  recordFailedDeletes: vi.fn(async (files: Array<{ key: string; source: string }>) => {
    db.retried.push(...files.map((f) => [f.key, f.source] as [string, string]))
    return { recorded: files.length, unavailable: false }
  }),
}))
vi.mock("../legal-hold.js", () => ({ heldAmong: vi.fn(async () => new Set<string>()) }))
vi.mock("../storage-deletes-setting.js", () => ({ storageDeletesSkipped: () => false }))
vi.mock("../relay-possible.js", () => ({ relayPossible: () => false }))
vi.mock("../config.js", async (orig) => {
  const real = await orig<{ config: Record<string, unknown> }>()
  return { ...real, config: { ...real.config, R2_PUBLIC_URL: CDN }, hasCredits: () => db.credits }
})
vi.mock("../job-cover/cover-release.js", () => ({ readCoversInScope: vi.fn(async () => []) }))
vi.mock("../job-cover/cover-store.js", () => ({ releaseCoversOfJobs: vi.fn(async () => {}) }))
vi.mock("../deferred-child-delete.js", () => ({ releaseHeldChildrenBeforeDelete: vi.fn(async () => {}) }))

import { reapRecordedObjects } from "../job-server-output.js"
import { _resetRecordedFilesReportForTests } from "../deleted-job-files.js"
import {
  _resetStoredBytesReportForTests,
  deleteJobWithPrivateMedia,
  deleteProjectWithPrivateMedia,
  deleteWorkflowWithPrivateMedia,
} from "../workflow-delete.js"

const USER = "u1"
const MEMBER = "u2"
const JOB = "11111111-2222-4333-8444-555555555555"
const CHILD = "22222222-3333-4444-8555-666666666666"
const KEY = `videos/${JOB}-master.mov`
const PREVIEW = `videos/${JOB}.mp4`
const OUTPUT = { videoUrl: `${CDN}/${PREVIEW}`, originalVideoUrl: `${CDN}/${KEY}` }

const purge = () => deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: USER, isAdmin: false })
/** A Library delete or the retention pass: claims the key, deletes it whatever the claim said, gives back only the claim. */
const libraryDelete = () => reapRecordedObjects([{ jobId: JOB, key: KEY }], "retention", { deleteUnclaimed: true })
const refunded = (who?: string) => db.usage.filter(([u]) => who === undefined || u === who).reduce((sum, [, d]) => sum - d, 0)

beforeEach(() => {
  db.jobs.clear()
  db.usage = []
  db.deleted = []
  db.refuse = false
  db.oldFunction = false
  db.credits = true
  db.usageFails = false
  db.assets = []
  db.trashed = []
  db.bucket = "ok"
  db.retried = []
  db.projectWorkflows = new Map([["proj-1", ["wf-1"]]])
  _resetStoredBytesReportForTests()
  _resetRecordedFilesReportForTests()
  db.jobs.set(JOB, { id: JOB, user_id: USER, workflow_id: "wf-1", parent_job_id: null, server_output: { stored: { [KEY]: 9000 } }, output_data: OUTPUT })
})

describe("each recorded byte comes back once, in every order", () => {
  it("job row present: the Library delete gives it back; the job delete after it gives nothing", async () => {
    await libraryDelete()
    await purge()
    expect(refunded()).toBe(9000)
    expect(db.deleted).toEqual([KEY])
  })

  it("job deleted for good while a Library item holds its preview, then the Library delete: the job delete gives it back and keeps the file; the Library delete deletes it and gives nothing", async () => {
    db.assets = [{ id: "asset-1", r2_key: PREVIEW, job_id: null }]
    expect(await purge()).toBe(true)
    expect(refunded()).toBe(9000)
    expect(db.deleted).toEqual([])
    await libraryDelete()
    expect(refunded()).toBe(9000)
    expect(db.deleted).toEqual([KEY])
  })

  it("job deleted for good with no Library item: its original is removed, and given back once", async () => {
    expect(await purge()).toBe(true)
    expect(db.deleted).toEqual([KEY])
    expect(refunded()).toBe(9000)
    // A Library delete or a sweep after it finds nothing to give back.
    await libraryDelete()
    expect(refunded()).toBe(9000)
  })

  it("an original the job delivered as its result stays: its output names it", async () => {
    db.jobs.set(JOB, { id: JOB, user_id: USER, workflow_id: "wf-1", parent_job_id: null, server_output: { stored: { [KEY]: 9000 } }, output_data: { videoUrl: `${CDN}/${KEY}`, originalVideoUrl: `${CDN}/${KEY}` } })
    expect(await purge()).toBe(true)
    expect(db.deleted).toEqual([])
    expect(refunded()).toBe(9000)
  })

  it("the retention pass after the job delete: nothing given back twice", async () => {
    db.assets = [{ id: "asset-1", r2_key: PREVIEW, job_id: null }]
    await purge()
    await reapRecordedObjects([{ jobId: JOB, key: KEY }], "retention", { deleteUnclaimed: true })
    expect(refunded()).toBe(9000)
  })

  it("an app's expunge, then the job delete: the expunge gives it back; the job delete gives nothing", async () => {
    await reapRecordedObjects([{ jobId: JOB, key: KEY }], "admin-expunge")
    await purge()
    expect(refunded()).toBe(9000)
  })

  it("a job's child jobs, which its delete takes with it, give back theirs too, and their files go", async () => {
    db.jobs.set(CHILD, { id: CHILD, user_id: USER, workflow_id: null, parent_job_id: JOB, server_output: { stored: { [`videos/${CHILD}-master.mov`]: 500 } } })
    await purge()
    expect(refunded()).toBe(9500)
    expect([...db.deleted].sort()).toEqual([KEY, `videos/${CHILD}-master.mov`].sort())
  })

  it("a workflow with another member's job gives back each job's own owner", async () => {
    db.jobs.set(CHILD, { id: CHILD, user_id: MEMBER, workflow_id: "wf-1", parent_job_id: null, server_output: { stored: { [`videos/${CHILD}-master.mov`]: 200 } } })
    expect(await deleteWorkflowWithPrivateMedia({ workflowId: "wf-1", userId: USER })).toBe(true)
    expect(refunded(USER)).toBe(9000)
    expect(refunded(MEMBER)).toBe(200)
    expect([...db.deleted].sort()).toEqual([KEY, `videos/${CHILD}-master.mov`].sort())
  })
})

describe("every permanent delete removes the deleted jobs' unused recorded files, giving nothing back twice", () => {
  it.each([
    ["History delete for good", () => deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: USER, isAdmin: false })],
    ["the Trash's delete forever", () => deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: USER, isAdmin: false, onlyTrashedBefore: "infinity" })],
    ["the 30-day purge", () => deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: null, isAdmin: true, onlyTrashedBefore: new Date().toISOString() })],
    ["a workflow delete", () => deleteWorkflowWithPrivateMedia({ workflowId: "wf-1", userId: USER })],
    ["a project delete", () => deleteProjectWithPrivateMedia({ projectId: "proj-1", userId: USER })],
  ] as const)("%s", async (_label, run) => {
    expect(await run()).toBe(true)
    expect(db.deleted).toEqual([KEY])
    expect(refunded()).toBe(9000)
  })

  it.each(["fails", "throws"] as const)("a bucket delete that %s is left to the retry pass, and the user's delete still succeeds", async (how) => {
    db.bucket = how
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(await purge()).toBe(true)
      expect(db.jobs.has(JOB)).toBe(false)
      expect(db.retried).toEqual([[KEY, "job-delete"]])
      expect(refunded()).toBe(9000)
    } finally {
      warn.mockRestore()
    }
  })

  it("moving a job to the Trash is not a delete: nothing is removed or given back", async () => {
    const { trashJob } = await import("../job-trash.js")
    expect(await trashJob({ jobId: JOB, userId: USER, isAdmin: false })).toEqual({ kind: "done" })
    expect(db.trashed.map(([id]) => id)).toEqual([JOB])
    expect(db.deleted).toEqual([])
    expect(refunded()).toBe(0)
    expect(db.jobs.get(JOB)!.server_output!.stored).toEqual({ [KEY]: 9000 })
  })
})

describe("nothing is given back unless the delete really happened", () => {
  it("a delete the database refuses gives nothing back, removes nothing and leaves the record intact", async () => {
    db.refuse = true
    await expect(purge()).rejects.toThrow(/refused/)
    expect(refunded()).toBe(0)
    expect(db.deleted).toEqual([])
    expect(db.jobs.get(JOB)!.server_output!.stored).toEqual({ [KEY]: 9000 })
  })

  it("a give-back that does not land is logged with its owner and bytes (the record is gone by then)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      db.usageFails = true
      expect(await purge()).toBe(true)
      expect(error.mock.calls.some((c) => String(c[0]).includes(`owner ${USER}, bytes 9000`))).toBe(true)
    } finally {
      error.mockRestore()
    }
  })

  it("another user's job is not deleted, gives nothing back and removes nothing", async () => {
    expect(await deleteJobWithPrivateMedia({ jobId: JOB, actorUserId: "someone-else", isAdmin: false })).toBe(false)
    expect(refunded()).toBe(0)
    expect(db.deleted).toEqual([])
  })

  it("a delete function that does not answer the bytes yet gives back nothing, says so once, and never reads the records itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      db.oldFunction = true
      await purge()
      db.jobs.set(JOB, { id: JOB, user_id: USER, workflow_id: "wf-1", parent_job_id: null, server_output: { stored: { [KEY]: 9000 } } })
      await purge()
      expect(refunded()).toBe(0)
      expect(db.deleted).toEqual([])
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("no stored bytes"))).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
})

/**
 * A row delete of a job, workflow or project goes through the delete
 * functions (lib/workflow-delete.ts), which answer what their jobs recorded as
 * stored. The only other deletes are the roll-backs of a row this request has
 * just placed, before any job of it ran (so nothing was ever stored). The
 * account delete removes the account and its storage counter with it.
 */
const ROW_DELETES_ALLOWED: Readonly<Record<string, string>> = {
  "middleware/credit-guard.ts": "rolls back the jobs row a refused credit check just placed, before it runs",
  "ee/lib/credit-guard-impl.ts": "rolls back the jobs row a failed reservation just placed, before it runs",
  "ee/billing/llm-billing-impl.ts": "rolls back an LLM call's jobs row placed before the call ran",
  "ee/billing/llm-fixed-plus-calls-impl.ts": "rolls back an LLM call's jobs row placed before the call ran",
  "lib/llm-structured-job-row.ts": "discards a structured LLM call's jobs row that never started",
  "lib/job-batch-holds.ts": "removes the jobs of a batch undone before they were queued",
  "services/workflow-engine/node-executor.ts": "deletes the placeholder jobs row of a node refused before it ran",
  "ee/copilot/tools/workflow-crud.ts": "rolls back an empty workflow the build just created and could not fill",
  "lib/mcp/flows/conversation-store.ts": "rolls back an MCP conversation workflow just created, or one with no steps",
  "lib/mcp/flows/record.ts": "rolls back an MCP conversation workflow whose first step did not land",
}

describe("every row delete of a job, workflow or project goes through the delete funnel", () => {
  it("the four delete RPCs are called only from lib/workflow-delete.ts", () => {
    const RPCS = ["delete_job_with_recast_cleanup", "delete_trashed_job_with_recast_cleanup", "delete_workflow_with_recast_cleanup", "delete_project_with_recast_cleanup"]
    const found: string[] = []
    eachSourceFile(RPCS, (sf, rel) => {
      if (rel === "lib/workflow-delete.ts") return
      walk(sf, (n) => {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && RPCS.includes(n.text)) found.push(`${rel}:${lineOf(sf, n)}`)
      })
    })
    expect(found).toEqual([])
  })

  it("a direct .from(\"jobs\" | \"workflows\" | \"projects\").delete() sits only in a file listed with why", () => {
    const TABLES = new Set(["jobs", "workflows", "projects"])
    const found = new Set<string>()
    eachSourceFile([".delete("], (sf, rel) => {
      walk(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "delete") return
        // Walk down the receiver chain to its `.from("<table>")`.
        let e: ts.Expression = n.expression.expression
        while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
          if (e.expression.name.text === "from" && e.arguments[0] && ts.isStringLiteral(e.arguments[0]) && TABLES.has(e.arguments[0].text)) {
            if (!(rel in ROW_DELETES_ALLOWED)) found.add(`${rel}:${lineOf(sf, n)}`)
            return
          }
          e = e.expression.expression
        }
      })
    })
    expect([...found]).toEqual([])
    for (const why of Object.values(ROW_DELETES_ALLOWED)) expect(why.length).toBeGreaterThan(20)
  })
})
