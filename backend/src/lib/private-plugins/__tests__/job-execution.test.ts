/**
 * `tk.jobs.readJobExecution`: who a job acts for, read from rows the HOST
 * wrote and clients cannot change — the job row and the workflow — and only
 * for the runner the caller already holds. Never the run's trigger data (an
 * owner can update their run; a webhook caller words its body). A job outside
 * any run (or someone else's) reads as null; a failed read throws instead of
 * passing for "no run".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const db = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown> | null>,
  errors: {} as Record<string, { message: string } | undefined>,
  reads: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: Array<[string, unknown]> = []
        const chain = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return chain
          },
          maybeSingle: async () => {
            db.reads.push({ table, columns, filters })
            const error = db.errors[table]
            if (error) return { data: null, error }
            const row = db.rows[table] ?? null
            const matches = row !== null && filters.every(([column, value]) => column === "id" || row[column] === value)
            return { data: matches ? row : null, error: null }
          },
        }
        return chain
      },
    }),
  },
}))

import { readJobExecution } from "../job-execution.js"
import { buildToolkit } from "../toolkit.js"

const JOB = { id: "job-1", user_id: "runner-1", workflow_execution_id: "exec-1", input_data: { type: "x", node_id: "node-9" } }
const RUN = { id: "exec-1", workflow_id: "wf-1", trigger_type: "telegram_account", trigger_data: { chatId: "-1001" } }
const AS_RUNNER = { runnerId: "runner-1" }

beforeEach(() => {
  db.rows = { jobs: { ...JOB }, workflow_executions: { ...RUN }, workflows: { user_id: "owner-1" } }
  db.errors = {}
  db.reads = []
})

describe("readJobExecution", () => {
  it("reads the runner, run and node from the job, and the owner from the workflow", async () => {
    expect(await readJobExecution("job-1", AS_RUNNER)).toEqual({
      jobId: "job-1",
      runnerId: "runner-1",
      nodeId: "node-9",
      executionId: "exec-1",
      workflowId: "wf-1",
      workflowOwnerId: "owner-1",
    })
    expect(db.reads.map((r) => [r.table, r.filters])).toEqual([
      ["jobs", [["id", "job-1"], ["user_id", "runner-1"]]],
      ["workflow_executions", [["id", "exec-1"]]],
      ["workflows", [["id", "wf-1"]]],
    ])
  })

  it("never reads the run's trigger data — owner- and caller-worded, it decides nothing", async () => {
    await readJobExecution("job-1", AS_RUNNER)
    const run = db.reads.find((r) => r.table === "workflow_executions")!
    expect(run.columns).not.toMatch(/trigger/)
    const result = (await readJobExecution("job-1", AS_RUNNER)) as unknown as Record<string, unknown>
    expect(result).not.toHaveProperty("triggerData")
    expect(result).not.toHaveProperty("triggerType")
  })

  it("someone else's job is no run at all — the owner filter is in the query", async () => {
    expect(await readJobExecution("job-1", { runnerId: "someone-else" })).toBeNull()
    expect(db.reads).toHaveLength(1)
  })

  it("refuses to read without a runner to scope by", async () => {
    await expect(readJobExecution("job-1", { runnerId: "" })).rejects.toThrow(/runnerId/)
    await expect(readJobExecution("", AS_RUNNER)).rejects.toThrow(/jobId/)
    expect(db.reads).toEqual([])
  })

  it("a job outside any run is null", async () => {
    db.rows.jobs = { ...JOB, workflow_execution_id: null }
    expect(await readJobExecution("job-1", AS_RUNNER)).toBeNull()
    db.rows.jobs = null
    expect(await readJobExecution("job-1", AS_RUNNER)).toBeNull()
  })

  it("a failed read throws — it is never mistaken for a job with no run", async () => {
    for (const table of ["jobs", "workflow_executions", "workflows"]) {
      db.errors = { [table]: { message: "boom" } }
      await expect(readJobExecution("job-1", AS_RUNNER)).rejects.toThrow(/boom/)
    }
  })

  it("is on the toolkit, under jobs", () => {
    expect(buildToolkit().jobs.readJobExecution).toBe(readJobExecution)
  })
})
