import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  selectChain: { data: null as any[] | null, error: null as { message: string } | null },
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(() => Promise.resolve({
        data: mocks.selectChain.data ?? mocks.rows,
        error: mocks.selectChain.error,
      })),
    })),
  },
}))

vi.mock("../sync-sweep.js", () => ({
  sweepStaleSyncJob: vi.fn().mockResolvedValue(undefined),
}))

import { reconcileInflightJobs } from "../cron.js"
import { sweepStaleSyncJob } from "../sync-sweep.js"

describe("reconcileInflightJobs", () => {
  beforeEach(() => {
    mocks.rows.length = 0
    mocks.selectChain.data = null
    mocks.selectChain.error = null
    ;(sweepStaleSyncJob as ReturnType<typeof vi.fn>).mockClear()
  })

  it("dispatches sync kinds (anthropic-sync) to sweepStaleSyncJob", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-sync-1",
      status: "processing",
      provider_kind: "anthropic-sync",
      provider_task_id: null,
      provider_call_started_at: stale,
      reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-sync-1" }))
    expect(result.swept).toBe(1)
  })

  it("dispatches null provider_kind to sweepStaleSyncJob (legacy fallback)", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-legacy",
      status: "processing",
      provider_kind: null,
      provider_task_id: null,
      provider_call_started_at: stale,
      reconcile_attempts: 0,
    })
    await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalled()
  })

  it("leaves async kinds (kie-standard, replicate-prediction) ALONE in Phase 2", async () => {
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-kie",
      status: "processing",
      provider_kind: "kie-standard",
      provider_task_id: "kt-abc",
      provider_call_started_at: stale,
      reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(result.skippedAsync).toBe(1)
  })

  it("skips rows within their kind's stale threshold", async () => {
    const recent = new Date(Date.now() - 1 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-recent",
      status: "processing",
      provider_kind: "anthropic-sync",
      provider_task_id: null,
      provider_call_started_at: recent,
      reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(result.notStale).toBe(1)
  })

  it("returns zeros when no candidates", async () => {
    const result = await reconcileInflightJobs()
    expect(result.scanned).toBe(0)
    expect(result.swept).toBe(0)
    expect(result.skippedAsync).toBe(0)
    expect(result.errors).toBe(0)
  })

  it("counts errors when the sweep handler throws", async () => {
    ;(sweepStaleSyncJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"))
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-err",
      status: "processing",
      provider_kind: "anthropic-sync",
      provider_task_id: null,
      provider_call_started_at: stale,
      reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(result.errors).toBe(1)
  })

  it("handles supabase select error gracefully (returns zero-result, no throw)", async () => {
    mocks.selectChain.data = null
    mocks.selectChain.error = { message: "transient" }
    const result = await reconcileInflightJobs()
    expect(result.scanned).toBe(0)
    expect(result.errors).toBe(0)  // pre-loop select error is recorded but not counted here
  })
})
