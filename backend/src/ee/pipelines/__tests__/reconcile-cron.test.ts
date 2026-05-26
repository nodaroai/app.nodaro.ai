import { describe, it, expect, vi, beforeEach } from "vitest"

interface PipelineRow {
  id: string
  user_id: string
  status: string
  created_at: string | null
}

interface StageRow {
  id: string
  pipeline_id: string
  resume_count: number
  status: string
}

const mocks = vi.hoisted(() => ({
  pipelines: [] as PipelineRow[],
  stages: [] as StageRow[],
  pipelineUpdates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
  stageUpdates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
  stageAttemptInserts: [] as Array<Record<string, unknown>>,
  // BullMQ getJob return value per-pipeline. undefined → no job.
  bullmqJob: new Map<string, { state: string } | undefined>(),
  enqueueCalls: [] as Array<{ pipelineId: string; reason: string }>,
  refundCalls: [] as Array<{ pipelineId: string; reason: string }>,
}))

vi.mock("../../../lib/supabase.js", () => {
  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          in: () => ({
            lt: () => ({
              limit: () =>
                Promise.resolve({ data: mocks.pipelines, error: null }),
            }),
          }),
        }),
        update: (updates: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            mocks.pipelineUpdates.push({ id, updates })
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    }
    if (table === "pipeline_stages") {
      const filters: Record<string, unknown> = {}
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val
          return builder
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => {
          const stage = mocks.stages.find(
            (s) =>
              s.pipeline_id === filters.pipeline_id && s.status === filters.status,
          )
          return Promise.resolve({ data: stage ?? null, error: null })
        },
        update: (updates: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => {
            mocks.stageUpdates.push({ id, updates })
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
      return builder
    }
    if (table === "pipeline_stage_attempts") {
      return {
        insert: (row: Record<string, unknown>) => {
          mocks.stageAttemptInserts.push(row)
          return Promise.resolve({ data: null, error: null })
        },
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  }
  return { supabase: { from } }
})

vi.mock("../queue.js", () => ({
  pipelineOrchestrationQueue: {
    getJob: vi.fn((jobId: string) => {
      const pipelineId = jobId.replace(/^pipeline-/, "")
      const job = mocks.bullmqJob.get(pipelineId)
      if (!job) return Promise.resolve(null)
      return Promise.resolve({
        id: jobId,
        getState: () => Promise.resolve(job.state),
      })
    }),
  },
  enqueuePipelineRun: vi.fn((args: { pipelineId: string; reason: string }) => {
    mocks.enqueueCalls.push({ pipelineId: args.pipelineId, reason: args.reason })
    return Promise.resolve()
  }),
}))

vi.mock("../credits.js", () => ({
  refundPipelineCredits: vi.fn(
    (args: { pipelineId: string; reason: string }) => {
      mocks.refundCalls.push({
        pipelineId: args.pipelineId,
        reason: args.reason,
      })
      return Promise.resolve()
    },
  ),
}))

import { reconcilePipelinesTick } from "../reconcile-cron.js"

const HOUR = 60 * 60 * 1000

describe("reconcilePipelinesTick", () => {
  beforeEach(() => {
    mocks.pipelines.length = 0
    mocks.stages.length = 0
    mocks.pipelineUpdates.length = 0
    mocks.stageUpdates.length = 0
    mocks.stageAttemptInserts.length = 0
    mocks.bullmqJob.clear()
    mocks.enqueueCalls.length = 0
    mocks.refundCalls.length = 0
  })

  it("re-enqueues a stuck pipeline with no live BullMQ job + increments resume_count", async () => {
    mocks.pipelines.push({
      id: "p1",
      user_id: "u1",
      status: "running",
      created_at: new Date(Date.now() - HOUR).toISOString(),
    })
    mocks.stages.push({
      id: "s1",
      pipeline_id: "p1",
      resume_count: 1,
      status: "running",
    })
    // mocks.bullmqJob.get("p1") returns undefined → no live job

    await reconcilePipelinesTick()

    expect(mocks.enqueueCalls).toHaveLength(1)
    expect(mocks.enqueueCalls[0]).toEqual({ pipelineId: "p1", reason: "resume" })
    expect(mocks.stageUpdates).toHaveLength(1)
    expect(mocks.stageUpdates[0].updates.resume_count).toBe(2)
    expect(mocks.stageAttemptInserts).toHaveLength(1)
    expect(mocks.stageAttemptInserts[0].trigger).toBe("cron_reconcile")
    expect(mocks.stageAttemptInserts[0].attempt_n).toBe(2)
    expect(mocks.refundCalls).toHaveLength(0)
  })

  it("skips a pipeline whose BullMQ job is active", async () => {
    mocks.pipelines.push({
      id: "p2",
      user_id: "u1",
      status: "running",
      created_at: new Date(Date.now() - HOUR).toISOString(),
    })
    mocks.bullmqJob.set("p2", { state: "active" })

    await reconcilePipelinesTick()

    expect(mocks.enqueueCalls).toHaveLength(0)
    expect(mocks.stageUpdates).toHaveLength(0)
    expect(mocks.pipelineUpdates).toHaveLength(0)
  })

  it("marks a pipeline failed when resume_count is at MAX_RESUME", async () => {
    mocks.pipelines.push({
      id: "p3",
      user_id: "u1",
      status: "running",
      created_at: new Date(Date.now() - HOUR).toISOString(),
    })
    // At-cap: current=3, increment would be 4 → > MAX_RESUME (3)
    mocks.stages.push({
      id: "s3",
      pipeline_id: "p3",
      resume_count: 3,
      status: "running",
    })

    await reconcilePipelinesTick()

    expect(mocks.enqueueCalls).toHaveLength(0)
    expect(mocks.pipelineUpdates).toHaveLength(1)
    expect(mocks.pipelineUpdates[0].updates).toMatchObject({
      status: "failed",
      failure_reason: "resume_limit_exceeded_cron",
    })
    expect(mocks.refundCalls).toHaveLength(1)
    expect(mocks.refundCalls[0]).toEqual({
      pipelineId: "p3",
      reason: "resume_limit_exceeded_cron",
    })
  })

  it("marks a pipeline failed when older than the 6-hour abandon threshold", async () => {
    mocks.pipelines.push({
      id: "p4",
      user_id: "u1",
      status: "running",
      // 7 hours old
      created_at: new Date(Date.now() - 7 * HOUR).toISOString(),
    })

    await reconcilePipelinesTick()

    expect(mocks.pipelineUpdates).toHaveLength(1)
    expect(mocks.pipelineUpdates[0].updates).toMatchObject({
      status: "failed",
      failure_reason: "stale_abandoned_by_cron",
    })
    expect(mocks.refundCalls).toHaveLength(1)
    expect(mocks.refundCalls[0].reason).toBe("stale_abandoned_by_cron")
    expect(mocks.enqueueCalls).toHaveLength(0)
  })

  it("re-enqueues even when there's no running stage (between-stages case)", async () => {
    mocks.pipelines.push({
      id: "p5",
      user_id: "u1",
      status: "running",
      created_at: new Date(Date.now() - HOUR).toISOString(),
    })
    // No stage rows — pipeline is "between stages"

    await reconcilePipelinesTick()

    expect(mocks.enqueueCalls).toHaveLength(1)
    // No stage updates / audit row when no running stage exists
    expect(mocks.stageUpdates).toHaveLength(0)
    expect(mocks.stageAttemptInserts).toHaveLength(0)
  })
})
