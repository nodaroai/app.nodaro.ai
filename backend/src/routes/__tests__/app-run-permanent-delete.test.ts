/**
 * DELETE /v1/app/:slug/runs/:runId/permanent refuses a run that is still
 * running (decided 2026-10-06).
 *
 * A monetized app's creator fee is settled once, when the run completes: the
 * orchestrator prices it from the run's final credits and finds the run row by
 * its execution. Hard-deleting the row (and its execution) mid-run left the
 * settlement nothing to settle against, so the creator was never paid while
 * the run went on spending. Archiving stays allowed — it keeps the row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  run: null as Row | null,
  execution: null as Row | null,
  execReadError: null as { message: string } | null,
  deletes: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  execReads: [] as Array<Record<string, unknown>>,
  /** jobs rows the in-flight probe can see. */
  jobs: [] as Row[],
  jobReads: [] as Array<Record<string, unknown>>,
  jobReadError: null as { message: string } | null,
}))

vi.mock("@/lib/supabase.js", () => {
  function builder(table: string) {
    const filters: Record<string, unknown> = {}
    let op: "select" | "delete" = "select"
    let inFilter: { col: string; vals: unknown[] } | null = null
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.in = (col: string, vals: unknown[]) => { inFilter = { col, vals }; return b }
    b.limit = () => b
    b.delete = () => { op = "delete"; return b }
    b.eq = (col: string, v: unknown) => { filters[col] = v; return b }
    b.is = () => b
    b.single = async () => {
      if (table !== "app_runs") return { data: null, error: { message: "unexpected" } }
      const r = db.run
      const ok = r && r.id === filters.id && r.runner_id === filters.runner_id
      return ok ? { data: r, error: null } : { data: null, error: { message: "not found" } }
    }
    b.maybeSingle = async () => {
      if (table !== "workflow_executions") return { data: null, error: null }
      db.execReads.push({ ...filters })
      if (db.execReadError) return { data: null, error: db.execReadError }
      const e = db.execution
      const ok = e && e.id === filters.id && (filters.user_id === undefined || e.user_id === filters.user_id)
      return { data: ok ? e : null, error: null }
    }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (op === "delete") db.deletes.push({ table, filters: { ...filters } })
      if (op === "select" && table === "jobs") {
        db.jobReads.push({ ...filters, ...(inFilter ? { [inFilter.col]: inFilter.vals } : {}) })
        if (db.jobReadError) return Promise.resolve({ data: null, error: db.jobReadError }).then(res, rej)
        const rows = db.jobs.filter((j) =>
          Object.entries(filters).every(([k, v]) => j[k] === v) &&
          (!inFilter || inFilter.vals.includes(j[inFilter.col])))
        return Promise.resolve({ data: rows.map((j) => ({ id: j.id })), error: null }).then(res, rej)
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    return b
  }
  return { supabase: { from: vi.fn((t: string) => builder(t)) } }
})
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))

import { appRunnerRoutes } from "../app-runner.js"

const RUNNER = "00000000-0000-4000-8000-000000000001"
const RUN_ID = "00000000-0000-4000-8000-000000000040"
const EXEC_ID = "00000000-0000-4000-8000-000000000030"

let app: FastifyInstance

beforeEach(async () => {
  db.run = { id: RUN_ID, runner_id: RUNNER, execution_id: EXEC_ID, deleted_at: "2026-10-06T10:00:00Z" }
  db.execution = { id: EXEC_ID, user_id: RUNNER, status: "completed" }
  db.execReadError = null
  db.deletes = []
  db.execReads = []
  db.jobs = []
  db.jobReads = []
  db.jobReadError = null
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { req.userId = RUNNER })
  await app.register(async (i) => { await appRunnerRoutes(i) })
  await app.ready()
})

const del = () => app.inject({ method: "DELETE", url: `/v1/app/my-app/runs/${RUN_ID}/permanent` })

describe("DELETE /v1/app/:slug/runs/:runId/permanent", () => {
  for (const status of ["pending", "running", "stopping"]) {
    it(`refuses a run whose execution is ${status} (409 run_in_progress) and deletes nothing`, async () => {
      db.execution = { id: EXEC_ID, user_id: RUNNER, status }
      const res = await del()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("run_in_progress")
      expect(db.deletes).toEqual([])
    })
  }

  for (const status of ["completed", "failed", "cancelled", "timed_out", "discarded"]) {
    it(`deletes a settled run (execution ${status}): the execution, then the run`, async () => {
      db.execution = { id: EXEC_ID, user_id: RUNNER, status }
      const res = await del()
      expect(res.statusCode).toBe(200)
      expect(db.deletes.map((d) => d.table)).toEqual(["workflow_executions", "app_runs"])
    })
  }

  // The execution's status is one fact; the run's own jobs still in flight are
  // another, and both are server-written (474). A run whose execution already
  // reads settled but still has a job working is not deletable yet.
  for (const status of ["pending", "queued", "processing", "pending_review"]) {
    it(`refuses a run whose execution reads settled but has a job still ${status} (409)`, async () => {
      db.execution = { id: EXEC_ID, user_id: RUNNER, status: "failed" }
      db.jobs = [{ id: "job-1", workflow_execution_id: EXEC_ID, user_id: RUNNER, status }]
      const res = await del()
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("run_in_progress")
      expect(db.deletes).toEqual([])
    })
  }

  it("asks only for the runner's own jobs of that execution", async () => {
    db.jobs = [{ id: "job-x", workflow_execution_id: EXEC_ID, user_id: "someone-else", status: "processing" }]
    const res = await del()
    expect(res.statusCode).toBe(200)
    expect(db.jobReads).toEqual([{
      workflow_execution_id: EXEC_ID,
      user_id: RUNNER,
      status: ["pending", "queued", "processing", "pending_review"],
    }])
  })

  it("settled jobs do not block the delete", async () => {
    db.jobs = [{ id: "job-1", workflow_execution_id: EXEC_ID, user_id: RUNNER, status: "completed" }]
    const res = await del()
    expect(res.statusCode).toBe(200)
  })

  it("a failed in-flight-jobs read refuses rather than guess (500), and deletes nothing", async () => {
    db.jobReadError = { message: "db down" }
    const res = await del()
    expect(res.statusCode).toBe(500)
    expect(db.deletes).toEqual([])
  })

  it("reads the execution as the runner's own", async () => {
    await del()
    expect(db.execReads).toEqual([{ id: EXEC_ID, user_id: RUNNER }])
  })

  it("a draft with no execution has nothing running: deleted", async () => {
    db.run = { ...db.run!, execution_id: null }
    const res = await del()
    expect(res.statusCode).toBe(200)
    expect(db.deletes.map((d) => d.table)).toEqual(["app_runs"])
  })

  it("an execution that is already gone does not block the delete", async () => {
    db.execution = null
    const res = await del()
    expect(res.statusCode).toBe(200)
  })

  it("a failed status read refuses rather than guess (500), and deletes nothing", async () => {
    db.execReadError = { message: "db down" }
    const res = await del()
    expect(res.statusCode).toBe(500)
    expect(db.deletes).toEqual([])
  })

  it("still requires the run to be archived first", async () => {
    db.run = { ...db.run!, deleted_at: null }
    const res = await del()
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_archived")
  })
})
