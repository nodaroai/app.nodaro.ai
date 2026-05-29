import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  selectChain: { data: null as any[] | null, error: null as { message: string } | null },
  // Rows returned by the never-started sweep query (the one using `.is(...)`).
  // Defaults empty so pre-existing tests (which only seed `rows`) are unaffected.
  neverStartedRows: [] as any[],
  neverStartedChain: { data: null as any[] | null, error: null as { message: string } | null },
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      // The main candidate query uses `.not(...)`; the never-started sweep uses
      // `.is("provider_call_started_at", null)`. Track which one this builder is
      // so `.limit()` returns the right fixture set.
      let isNeverStarted = false
      const chain: any = {
        select: vi.fn(() => chain),
        in: vi.fn(() => chain),
        not: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        is: vi.fn(() => {
          isNeverStarted = true
          return chain
        }),
        lt: vi.fn(() => chain),
        limit: vi.fn(() =>
          Promise.resolve(
            isNeverStarted
              ? { data: mocks.neverStartedChain.data ?? mocks.neverStartedRows, error: mocks.neverStartedChain.error }
              : { data: mocks.selectChain.data ?? mocks.rows, error: mocks.selectChain.error },
          ),
        ),
      }
      return chain
    }),
  },
}))

vi.mock("../sync-sweep.js", () => ({
  sweepStaleSyncJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../kie.js", () => ({
  reconcileKieJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../replicate.js", () => ({
  reconcileReplicateJob: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../elevenlabs.js", () => ({
  reconcileElevenLabsJob: vi.fn().mockResolvedValue(undefined),
}))

import { reconcileInflightJobs } from "../cron.js"
import { sweepStaleSyncJob } from "../sync-sweep.js"
import { reconcileKieJob } from "../kie.js"
import { reconcileReplicateJob } from "../replicate.js"
import { reconcileElevenLabsJob } from "../elevenlabs.js"

describe("reconcileInflightJobs", () => {
  beforeEach(() => {
    mocks.rows.length = 0
    mocks.selectChain.data = null
    mocks.selectChain.error = null
    mocks.neverStartedRows.length = 0
    mocks.neverStartedChain.data = null
    mocks.neverStartedChain.error = null
    ;(sweepStaleSyncJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileKieJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileReplicateJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileElevenLabsJob as ReturnType<typeof vi.fn>).mockClear()
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

  it("dispatches async kinds (kie-standard) to per-provider handler in Phase 3", async () => {
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
    // sweepStaleSyncJob is NOT called — async kind goes to the kie handler instead.
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(result.recovered).toBe(1)
  })

  it("dispatches kie-aleph and kie-veo-1080p to reconcileKieJob (not the sync sweep)", async () => {
    // Reconcile blind-spot regression: both kinds were absent from KIE_KINDS,
    // so a stuck Aleph or VEO 1080p row was force-failed via sync-sweep
    // instead of recovered via the right poll endpoint.
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    mocks.rows.push(
      {
        id: "j-aleph",
        status: "processing",
        provider_kind: "kie-aleph",
        provider_task_id: "t-aleph",
        provider_call_started_at: stale,
        reconcile_attempts: 0,
      },
      {
        id: "j-veo1080",
        status: "processing",
        provider_kind: "kie-veo-1080p",
        provider_task_id: "t-parent-veo",
        provider_call_started_at: stale,
        reconcile_attempts: 0,
      },
    )
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(reconcileKieJob).toHaveBeenCalledTimes(2)
    expect(result.recovered).toBe(2)
  })

  it("dispatches the pre-task sentinel to sweepStaleSyncJob (mark failed + refund)", async () => {
    // Pre-task instrumentation: worker writes provider_kind=pre-task at
    // the status=processing transition so a crash before createKieTask is
    // visible to the reconcile filter. 30-min threshold + sync-sweep means
    // the row gets marked failed and credits refunded.
    const stale = new Date(Date.now() - 40 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-pretask",
      status: "processing",
      provider_kind: "pre-task",
      provider_task_id: null,
      provider_call_started_at: stale,
      reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "j-pretask", provider_kind: "pre-task" }),
    )
    expect(result.swept).toBe(1)
  })

  it("unknown provider_kind falls through to sweepStaleSyncJob (spec §5.5 catch-all)", async () => {
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    // Cast through to bypass the ProviderKind literal type guard — this is
    // the exact case the catch-all defends against: a new value added to the
    // PROVIDER_KIND_VALUES tuple without updating the dispatch sets in cron.ts.
    mocks.rows.push({
      id: "j-future",
      status: "processing",
      provider_kind: "kie-future-model" as unknown as string,
      provider_task_id: "task-1",
      provider_call_started_at: stale,
      reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({
      id: "j-future",
      provider_kind: "kie-future-model",
    }))
    expect(result.swept).toBe(1)
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
    expect(result.recovered).toBe(0)
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

  it("sweeps never-started pending jobs (provider_call_started_at IS NULL) the main scan can't see", async () => {
    // These jobs were created but never claimed by a worker, so they have no
    // provider_call_started_at and are excluded from the main candidate query.
    // The never-started sweep must mark them failed + refund via sweepStaleSyncJob.
    mocks.neverStartedRows.push(
      { id: "j-orphan-1", provider_kind: null, reconcile_attempts: 0 },
      { id: "j-orphan-2", provider_kind: null, reconcile_attempts: 2 },
    )
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-orphan-1" }))
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-orphan-2" }))
    expect(result.swept).toBe(2)
  })

  it("never-started sweep does not run for the main candidate set (no double-processing)", async () => {
    // A started+stale job goes through the main path only; the never-started
    // query returns empty, so it isn't swept twice.
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-started", status: "processing", provider_kind: "anthropic-sync",
      provider_task_id: null, provider_call_started_at: stale, reconcile_attempts: 0,
    })
    const result = await reconcileInflightJobs()
    expect(result.swept).toBe(1)
    expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
  })
})
