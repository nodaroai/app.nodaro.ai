/**
 * A failure sweep that overlaps an admin app expunge (decided 2026-10-07).
 *
 * The sweep reads a failed job (or execution) with its error and request,
 * then files a report from that read, one insert at a time. When the expunge
 * runs between the read and the insert, it clears the job and then clears the
 * reports filed for it — none yet — and the sweep's insert lands afterwards,
 * carrying the erased content into a report the (kind, job_id) dedup never
 * re-files. The sweep therefore re-reads the source rows of the reports it
 * just filed and clears every report whose source the expunge has erased.
 *
 * These tests run the real sweep and the real expunge write against one
 * in-memory database and run the expunge inside the sweep's insert, between
 * its read and its write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

import { supabase } from "../supabase.js"
import { sweepFailedExecutions, sweepFailedJobs } from "../app-report-sweep.js"
import { redactAppExpungeTargets } from "../app-expunge-targets.js"
import { resetInputOverridesColumnForTests } from "../execution-input-overrides.js"

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

const SECRET_PROMPT = "a portrait of my neighbour Dana at her front door"
const SECRET_ERROR = "Provider timeout while rendering 'Dana at her front door'"

function fakeDb(tables: Record<string, Row[]>, hooks: { beforeInsert?: (table: string, row: Row) => Promise<void> } = {}) {
  let nextId = 1
  const failRead = new Set<string>()
  const reads: string[] = []
  const from = (table: string) => {
    const filters: Filter[] = []
    let op: "select" | "update" | "insert" = "select"
    let patch: Row = {}
    let inserted: Row | null = null
    let max = Infinity
    const rows = () => (tables[table] ??= [])
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      gte: (c: string, v: string) => (filters.push((r) => typeof r[c] === "string" && (r[c] as string) >= v), q),
      order: () => q,
      limit: (n: number) => ((max = n), q),
      update: (p: Row) => ((op = "update"), (patch = p), q),
      insert: (row: Row) => ((op = "insert"), (inserted = row), q),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => run().then(resolve, reject),
    }
    const matching = () => rows().filter((r) => filters.every((f) => f(r)))
    const run = async (): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => {
      if (op === "insert") {
        await hooks.beforeInsert?.(table, inserted as unknown as Row)
        const row: Row = { id: `report-${nextId++}`, ...(inserted as Row | null) }
        const dup = rows().some(
          (r) =>
            r.kind === row.kind &&
            ((row.job_id != null && r.job_id === row.job_id) || (row.execution_id != null && r.execution_id === row.execution_id)),
        )
        if (dup) return { data: null, error: { message: "duplicate", code: "23505" } }
        rows().push(row)
        return { data: [row], error: null }
      }
      if (op === "update") {
        const hit = matching()
        for (const r of hit) Object.assign(r, structuredClone(patch))
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }
      reads.push(table)
      if (failRead.has(table) && reads.filter((t) => t === table).length > 1) return { data: null, error: { message: "read failed" } }
      return { data: structuredClone(matching().slice(0, max)), error: null }
    }
    return q
  }
  vi.mocked(supabase.from).mockImplementation(from as never)
  return { tables, failRead }
}

const recent = () => new Date(Date.now() - 60_000).toISOString()

function failedJob(id = "job-1"): Row {
  return {
    id,
    status: "failed",
    user_id: "u1",
    workflow_execution_id: "exec-1",
    error_message: SECRET_ERROR,
    error_detail: `raw: ${SECRET_PROMPT}`,
    provider: null,
    provider_kind: "kie-image",
    source: null,
    source_detail: null,
    completed_at: recent(),
    input_data: { model: "seedream-5-pro", type: "image-generate", prompt: SECRET_PROMPT },
    output_data: null,
    error_hint: null,
  }
}

function failedExecution(id = "exec-2"): Row {
  return {
    id,
    workflow_id: "wf-1",
    user_id: "u1",
    status: "failed",
    trigger_type: "manual",
    error_message: SECRET_ERROR,
    node_states: { n1: { status: "failed", error: SECRET_ERROR } },
    completed_at: recent(),
  }
}

const leaks = (rows: Row[]) => JSON.stringify(rows).includes("Dana")

/** The report row stays, with the expunge's own patch applied. */
function expectCleared(report: Row): void {
  expect(report.title).toBe("")
  expect(report.payload).toEqual({})
}

beforeEach(() => {
  vi.mocked(supabase.from).mockReset()
  resetInputOverridesColumnForTests()
})

describe("a job sweep overlapping an expunge", () => {
  it("clears the report it filed from a job the expunge erased between the sweep's read and its insert", async () => {
    const db = fakeDb(
      { jobs: [failedJob()], app_reports: [] },
      {
        // The sweep has read the job; the expunge runs now, before the insert lands.
        beforeInsert: async (table) => {
          if (table !== "app_reports") return
          const result = await redactAppExpungeTargets({ levels: [{ executionIds: [], jobIds: ["job-1"] }] })
          expect(result.reports).toBe(0) // nothing filed yet — the report lands after
        },
      },
    )

    const { reported } = await sweepFailedJobs()

    expect(reported).toBe(1)
    expect(leaks(db.tables.jobs)).toBe(false)
    expect(db.tables.app_reports).toHaveLength(1)
    expect(db.tables.app_reports[0]).toMatchObject({ kind: "job-failure", job_id: "job-1" })
    expectCleared(db.tables.app_reports[0]!)
    expect(leaks(db.tables.app_reports)).toBe(false)
  })

  it("keeps the report of a job nobody erased", async () => {
    const db = fakeDb({ jobs: [failedJob()], app_reports: [] })

    await sweepFailedJobs()

    expect(db.tables.app_reports).toHaveLength(1)
    expect(db.tables.app_reports[0]!.title).toContain(SECRET_ERROR)
    expect((db.tables.app_reports[0]!.payload as Row).prompt).toBe(SECRET_PROMPT)
  })

  it("clears only the reports whose job was erased", async () => {
    const db = fakeDb(
      { jobs: [failedJob("job-1"), failedJob("job-2")], app_reports: [] },
      {
        beforeInsert: async (table, row) => {
          if (table === "app_reports" && row.job_id === "job-1") {
            await redactAppExpungeTargets({ levels: [{ executionIds: [], jobIds: ["job-1"] }] })
          }
        },
      },
    )

    await sweepFailedJobs()

    const byJob = new Map(db.tables.app_reports.map((r) => [r.job_id, r]))
    expectCleared(byJob.get("job-1")!)
    expect(byJob.get("job-2")!.title).toContain(SECRET_ERROR)
  })

  it("does not throw when the re-read fails, and keeps the reports it filed", async () => {
    const db = fakeDb({ jobs: [failedJob()], app_reports: [] })
    db.failRead.add("jobs")

    await expect(sweepFailedJobs()).resolves.toEqual({ scanned: 1, reported: 1 })
    expect(db.tables.app_reports).toHaveLength(1)
  })
})

describe("an execution sweep overlapping an expunge", () => {
  it("clears the report it filed from an execution the expunge erased between the sweep's read and its insert", async () => {
    const db = fakeDb(
      { workflow_executions: [failedExecution()], jobs: [], app_reports: [] },
      {
        beforeInsert: async (table) => {
          if (table !== "app_reports") return
          await redactAppExpungeTargets({ levels: [{ executionIds: ["exec-2"], jobIds: [] }] })
        },
      },
    )

    const { reported } = await sweepFailedExecutions()

    expect(reported).toBe(1)
    expect(leaks(db.tables.workflow_executions)).toBe(false)
    expect(db.tables.app_reports[0]).toMatchObject({ kind: "execution-failure", execution_id: "exec-2" })
    expectCleared(db.tables.app_reports[0]!)
    expect(leaks(db.tables.app_reports)).toBe(false)
  })

  it("keeps the report of an execution nobody erased", async () => {
    const db = fakeDb({ workflow_executions: [failedExecution()], jobs: [], app_reports: [] })

    await sweepFailedExecutions()

    expect(db.tables.app_reports[0]!.title).toContain(SECRET_ERROR)
  })
})
