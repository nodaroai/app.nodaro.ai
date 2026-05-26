import { describe, it, expect, vi, beforeEach } from "vitest"

interface JobRow {
  id: string
  status: string
  error_message: string | null
}

interface ExecutionRow {
  id: string
  started_at: string | null
  node_states: Record<string, { status: string; jobId?: string }>
}

const mocks = vi.hoisted(() => ({
  executions: [] as ExecutionRow[],
  jobs: [] as JobRow[],
  updates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
  // BullMQ orchestration-job state per executionId. undefined = no job.
  orchJob: new Map<string, { state: string } | undefined>(),
}))

vi.mock("../../supabase.js", () => {
  function from(table: string) {
    if (table === "workflow_executions") {
      return {
        select: () => ({
          in: () => ({
            lt: () => ({
              limit: () =>
                Promise.resolve({ data: mocks.executions, error: null }),
            }),
          }),
        }),
        update: (updates: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            neq: () => {
              mocks.updates.push({ id, updates })
              return Promise.resolve({ data: null, error: null })
            },
          }),
        }),
      }
    }
    if (table === "jobs") {
      return {
        select: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: mocks.jobs.filter((j) => ids.includes(j.id)),
              error: null,
            }),
        }),
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  }
  return { supabase: { from } }
})

vi.mock("../../orchestration-queue.js", () => ({
  orchestrationQueue: {
    getJob: (jobId: string) => {
      const j = mocks.orchJob.get(jobId)
      if (!j) return Promise.resolve(null)
      return Promise.resolve({ id: jobId, getState: () => Promise.resolve(j.state) })
    },
  },
}))

import { reconcileWorkflowExecutionsTick } from "../workflow-executions-cron.js"

describe("reconcileWorkflowExecutionsTick", () => {
  beforeEach(() => {
    mocks.executions.length = 0
    mocks.jobs.length = 0
    mocks.updates.length = 0
    mocks.orchJob.clear()
  })

  it("marks an execution completed when all child jobs are completed in DB", async () => {
    mocks.executions.push({
      id: "exec-1",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running", jobId: "j1" },
        n2: { status: "completed", jobId: "j2" },
      },
    })
    mocks.jobs.push(
      { id: "j1", status: "completed", error_message: null },
      { id: "j2", status: "completed", error_message: null },
    )

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].id).toBe("exec-1")
    expect(mocks.updates[0].updates.status).toBe("completed")
    // node_states should be reconciled (j1 was running → now completed)
    expect(mocks.updates[0].updates.node_states).toMatchObject({
      n1: { status: "completed" },
      n2: { status: "completed" },
    })
  })

  it("skips an execution when child jobs are still pending/processing in DB AND BullMQ orchestrator job is active", async () => {
    mocks.executions.push({
      id: "exec-2",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running", jobId: "j1" },
        n2: { status: "running", jobId: "j2" },
      },
    })
    mocks.jobs.push(
      { id: "j1", status: "completed", error_message: null },
      { id: "j2", status: "processing", error_message: null },
    )
    // Orchestrator is alive — cron should NOT touch this row.
    mocks.orchJob.set("exec-2", { state: "active" })

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(0)
  })

  it("marks an orphaned execution failed when no BullMQ orchestration job exists (the blind-spot path)", async () => {
    mocks.executions.push({
      id: "exec-orphan",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        // jobId is a placeholder that was never persisted to `jobs`
        n1: { status: "running", jobId: "exec-node_1" },
      },
    })
    // No matching `jobs` row → reconcileNodeStatesFromJobs returns unchanged
    // No orchestration BullMQ job → orphan branch fires
    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toMatch(/orphaned/)
  })

  it("marks an execution failed when a child job failed and no others active", async () => {
    mocks.executions.push({
      id: "exec-3",
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "completed", jobId: "j1" },
        n2: { status: "running", jobId: "j2" },
      },
    })
    mocks.jobs.push(
      { id: "j1", status: "completed", error_message: null },
      { id: "j2", status: "failed", error_message: "Provider 500" },
    )

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toMatch(/reconciled by cron/)
  })

  it("marks an execution failed when older than the abandon threshold", async () => {
    mocks.executions.push({
      id: "exec-4",
      // 5 hours old — past the 4-hour threshold
      started_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      node_states: {
        n1: { status: "running", jobId: "j1" },
      },
    })
    // jobs table returns nothing — job ID was lost / never persisted
    // (mocks.jobs is empty)

    await reconcileWorkflowExecutionsTick()

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0].updates.status).toBe("failed")
    expect(mocks.updates[0].updates.error_message).toMatch(/abandoned/)
  })

  it("emits no updates when there are no stuck rows", async () => {
    await reconcileWorkflowExecutionsTick()
    expect(mocks.updates).toHaveLength(0)
  })
})
