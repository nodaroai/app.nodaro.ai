import { describe, it, expect, vi, beforeEach } from "vitest"

// Hoist the credits mock so resume.ts picks it up at import time.
vi.mock("../credits.js", () => ({
  refundPipelineCredits: vi.fn(async () => undefined),
}))

import { resumeActiveOrchestrators } from "../resume.js"
import { refundPipelineCredits } from "../credits.js"

beforeEach(() => {
  vi.clearAllMocks()
})

// Minimal BullMQ Job shim — only the fields the helper touches.
function makeJob(pipelineId: string) {
  return {
    data: { pipelineId },
    remove: vi.fn(async () => undefined),
  }
}

interface StageFixture {
  id: string
  stage_name: string
  resume_count: number
}

interface SupabaseFixture {
  stage: StageFixture | null
  reservationUsageLogId?: string | null
  stageUpdates: Array<{ id: string; patch: Record<string, unknown> }>
  pipelineUpdates: Array<Record<string, unknown>>
  attemptInserts: Array<Record<string, unknown>>
}

function makeSupabase(opts: {
  stage: StageFixture | null
  reservationUsageLogId?: string | null
}): { client: unknown; fixture: SupabaseFixture } {
  const fixture: SupabaseFixture = {
    stage: opts.stage,
    reservationUsageLogId: opts.reservationUsageLogId,
    stageUpdates: [],
    pipelineUpdates: [],
    attemptInserts: [],
  }
  const client = {
    from(table: string) {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: fixture.stage, error: null }),
                  }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              fixture.stageUpdates.push({ id, patch })
              return { error: null }
            },
          }),
        }
      }
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { reservation_usage_log_id: fixture.reservationUsageLogId ?? null },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              fixture.pipelineUpdates.push(patch)
              return { error: null }
            },
          }),
        }
      }
      if (table === "pipeline_stage_attempts") {
        return {
          insert: async (row: Record<string, unknown>) => {
            fixture.attemptInserts.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`unmocked table: ${table}`)
    },
  }
  return { client, fixture }
}

describe("resumeActiveOrchestrators", () => {
  it("increments resume_count and writes audit row when below cap", async () => {
    const { client, fixture } = makeSupabase({
      stage: { id: "s1", stage_name: "characters", resume_count: 1 },
    })
    const job = makeJob("p1")
    const queue = { getJobs: vi.fn(async () => [job]) } as never
    const result = await resumeActiveOrchestrators(client as never, queue)
    expect(result).toEqual({ resumed: 1, failed: 0 })
    // resume_count was incremented to 2.
    expect(fixture.stageUpdates).toEqual([{ id: "s1", patch: { resume_count: 2 } }])
    // Audit row written with `trigger='resume'` and the new attempt_n.
    expect(fixture.attemptInserts).toEqual([
      { pipeline_stage_id: "s1", attempt_n: 2, trigger: "resume", output: {} },
    ])
    // BullMQ job was NOT removed — worker will re-pick up on next poll.
    expect(job.remove).not.toHaveBeenCalled()
    expect(refundPipelineCredits).not.toHaveBeenCalled()
  })

  it("fails pipeline + refunds + removes job when resume_count would exceed cap", async () => {
    const { client, fixture } = makeSupabase({
      stage: { id: "s1", stage_name: "characters", resume_count: 3 },
      reservationUsageLogId: "log-1",
    })
    const job = makeJob("p1")
    const queue = { getJobs: vi.fn(async () => [job]) } as never
    const result = await resumeActiveOrchestrators(client as never, queue)
    expect(result).toEqual({ resumed: 0, failed: 1 })
    // Pipeline was flipped to failed.
    expect(fixture.pipelineUpdates).toEqual([
      { status: "failed", failure_reason: "resume_limit_exceeded" },
    ])
    // Canonical refund helper invoked (looks up + clears reservation_usage_log_id).
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1",
        reason: "resume_limit_exceeded",
      }),
    )
    // Drop the dead job.
    expect(job.remove).toHaveBeenCalledTimes(1)
    // No audit row was written (we're failing, not resuming).
    expect(fixture.attemptInserts).toEqual([])
    expect(fixture.stageUpdates).toEqual([])
  })

  it("ignores jobs with no running stage (pipeline already finished)", async () => {
    const { client, fixture } = makeSupabase({ stage: null })
    const job = makeJob("p1")
    const queue = { getJobs: vi.fn(async () => [job]) } as never
    const result = await resumeActiveOrchestrators(client as never, queue)
    expect(result).toEqual({ resumed: 0, failed: 0 })
    expect(fixture.stageUpdates).toEqual([])
    expect(fixture.attemptInserts).toEqual([])
    expect(job.remove).not.toHaveBeenCalled()
  })

  it("invokes refund helper even when pipeline has no reservation_usage_log_id (helper is a no-op)", async () => {
    const { client } = makeSupabase({
      stage: { id: "s1", stage_name: "characters", resume_count: 3 },
      reservationUsageLogId: null,
    })
    const job = makeJob("p1")
    const queue = { getJobs: vi.fn(async () => [job]) } as never
    const result = await resumeActiveOrchestrators(client as never, queue)
    expect(result.failed).toBe(1)
    // Helper is called unconditionally; it internally short-circuits when no
    // reservation is on file.
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1",
        reason: "resume_limit_exceeded",
      }),
    )
    expect(job.remove).toHaveBeenCalledTimes(1)
  })
})
