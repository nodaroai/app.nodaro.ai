// @test-watches supabase/migrations/*.sql backend/src/workers/video-director-worker.ts
// The run workers' admission rows (run-admit.ts): which status of an
// execution or a pipeline waits (a fresh acquire, may park), which started (a
// re-admission, never parks) and which ended (no admission); and every column
// the admission reads exists in the migrations — a select naming a missing
// column returns no row, and the run would then be admitted on its payload
// alone.
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { jobsColumns, selectColumns, tableColumns } from "../../__tests__/jobs-schema.js"
import type { BillingContext } from "../../billing-context.js"

const refs = vi.hoisted(() => ({
  /** What the admission read answers. */
  read: async (): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: null, error: null }),
}))
vi.mock("../../supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => refs.read() }) }) }) },
}))

const {
  EXECUTION_PICKUP_COLUMNS, PIPELINE_PICKUP_COLUMNS, executionWorkerRow, pipelineWorkerRow, readExecutionWorkerRow, readPipelineWorkerRow,
} = await import("../run-admit.js")
const { WORKER_ROW_COLUMNS } = await import("../worker-admit.js")

describe("executionWorkerRow", () => {
  it("a pending execution waits (fresh); running and stopping started (readmit); an ended one is not admitted", () => {
    expect(executionWorkerRow("e", { user_id: "U", status: "pending" }, "U")?.status).toBe("pending")
    expect(executionWorkerRow("e", { user_id: "U", status: "running" }, "U")?.status).toBe("processing")
    expect(executionWorkerRow("e", { user_id: "U", status: "stopping" }, "U")?.status).toBe("processing")
    for (const s of ["completed", "failed", "cancelled", "timed_out", "discarded"]) expect(executionWorkerRow("e", { user_id: "U", status: s }, "U"), s).toBeNull()
  })

  it("an unread row is admitted fresh on the payload's user; the workspace and trigger ride from the row", () => {
    expect(executionWorkerRow("e", null, "U")).toMatchObject({ id: "e", user_id: "U", status: "pending" })
    expect(executionWorkerRow("e", { user_id: "U", status: "pending", workspace_id: "ws", trigger_type: "webhook", mcp_client: "x" }, "U"))
      .toMatchObject({ workspace_id: "ws", source: "webhook", mcp_client: "x", parent_job_id: null, workflow_execution_id: null })
  })
})

describe("pipelineWorkerRow", () => {
  it("a queued pipeline waits (fresh); one driven before is re-admitted; an ended one is not admitted", () => {
    expect(pipelineWorkerRow("p", { user_id: "U", status: "queued" }, "U")?.status).toBe("pending")
    expect(pipelineWorkerRow("p", { user_id: "U", status: "running" }, "U")?.status).toBe("processing")
    expect(pipelineWorkerRow("p", { user_id: "U", status: "awaiting_approval" }, "U")?.status).toBe("processing")
    for (const s of ["completed", "failed", "cancelled", "forked"]) expect(pipelineWorkerRow("p", { user_id: "U", status: s }, "U"), s).toBeNull()
  })
})

describe("a pipeline's admission row carries the payer its worker read", () => {
  it("a workspace payer gives the row its workspace pair; a personal one leaves it personal", () => {
    const ws: BillingContext = { payer: "workspace", userId: "U", workspaceId: "W9", orgId: "O9", memberCap: null, entitlements: { watermark: false, dailyCapCredits: null, parallelism: 12, tierForGates: "business" } } as unknown as BillingContext
    expect(pipelineWorkerRow("p", { user_id: "U", status: "queued" }, "U", ws)).toMatchObject({ workspace_id: "W9", org_id: "O9" })
    expect(pipelineWorkerRow("p", { user_id: "U", status: "queued" }, "U", { payer: "user", userId: "U" })).toMatchObject({ workspace_id: null, org_id: null })
    expect(pipelineWorkerRow("p", { user_id: "U", status: "queued" }, "U")).toMatchObject({ workspace_id: null })
  })
})

describe("a run whose row is gone is not admitted; one whose row could not be read is", () => {
  it("no row at all (deleted while it waited): no admission, for an execution and a pipeline", async () => {
    refs.read = async () => ({ data: null, error: null })
    expect(await readExecutionWorkerRow("e", "U")).toBeNull()
    expect(await readPipelineWorkerRow("p", "U")).toBeNull()
  })

  it("a read that failed (an error, or a throw): admitted fresh on the payload's line", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    refs.read = async () => ({ data: null, error: { message: "statement timeout" } })
    expect(await readExecutionWorkerRow("e", "U")).toMatchObject({ id: "e", user_id: "U", status: "pending" })
    expect(await readPipelineWorkerRow("p", "U")).toMatchObject({ id: "p", user_id: "U", status: "pending" })
    refs.read = async () => { throw new Error("connection reset") }
    expect(await readExecutionWorkerRow("e", "U")).toMatchObject({ id: "e", user_id: "U", status: "pending" })
    vi.restoreAllMocks()
  })

  it("a row read: admitted from it", async () => {
    refs.read = async () => ({ data: { id: "e", user_id: "U", status: "running" }, error: null })
    expect(await readExecutionWorkerRow("e", "U")).toMatchObject({ status: "processing" })
  })
})

describe("the run workers' admission reads", () => {
  it("every column the execution and pipeline admission reads exists in supabase/migrations", () => {
    const exec = tableColumns("workflow_executions")
    const pipes = tableColumns("pipelines")
    expect(exec.size).toBeGreaterThan(5)
    expect(pipes.size).toBeGreaterThan(3)
    expect(selectColumns(EXECUTION_PICKUP_COLUMNS).filter((c) => !exec.has(c))).toEqual([])
    expect(selectColumns(PIPELINE_PICKUP_COLUMNS).filter((c) => !pipes.has(c))).toEqual([])
  })

  it("the director's pickup reads every column admission reads, and they exist", () => {
    const src = readFileSync(resolve(__dirname, "../../../workers/video-director-worker.ts"), "utf8")
    expect(src).toMatch(/\.from\("jobs"\)\.select\(WORKER_ROW_COLUMNS\)/)
    const cols = jobsColumns()
    expect(selectColumns(WORKER_ROW_COLUMNS).filter((c) => !cols.has(c))).toEqual([])
  })
})
