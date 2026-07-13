import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as any[],
  selectChain: { data: null as any[] | null, error: null as { message: string; code?: string } | null },
  // When non-null, successive MAIN-scan queries consume results from this
  // queue in order (used by the 42703 column-missing fallback tests).
  mainScanQueue: null as Array<{ data: any[] | null; error: { message: string; code?: string } | null }> | null,
  // Rows returned by the never-started sweep query (the one using `.is(...)`).
  // Defaults empty so pre-existing tests (which only seed `rows`) are unaffected.
  neverStartedRows: [] as any[],
  neverStartedChain: { data: null as any[] | null, error: null as { message: string } | null },
  // Rows returned by the stuck-render sweep (the one using `.filter("input_data->>type", ...)`).
  renderRows: [] as any[],
  renderChain: { data: null as any[] | null, error: null as { message: string } | null },
  // Live BullMQ entries returned by videoQueue.getJobs (checkpoint-resume liveness scan).
  queueJobs: [] as any[],
  // [jobName, payload] tuples captured from videoQueue.add (checkpoint-resume requeue).
  queueAddCalls: [] as Array<[string, Record<string, unknown>]>,
  // UPDATE payloads captured from the resume CAS (`.update(...)` on the jobs table).
  updateCalls: [] as Array<Record<string, unknown>>,
  // What the resume CAS's terminal `.select("id")` resolves to.
  updateResult: { data: [{ id: "u1" }] as any[] | null, error: null as { message: string } | null },
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      // The main candidate query uses `.not(...)`; the never-started sweep uses
      // `.is("provider_call_started_at", null)`. Track which one this builder is
      // so `.limit()` returns the right fixture set.
      let isNeverStarted = false
      // The component-wrapper sweep filters `.eq("provider","component")`; return
      // an empty set so it's a no-op in these tests (covered by its own suite).
      let isComponentWrapper = false
      // The stuck-render sweep filters `.filter("input_data->>type","eq","render-video")`.
      // It ALSO calls `.is(...)`, so isRender must take precedence in `.limit()`.
      let isRender = false
      // The checkpoint-resume CAS is an `.update(...)` builder terminated by
      // `.select("id")` — in update mode `select` RESOLVES instead of chaining.
      let isUpdate = false
      const chain: any = {
        update: vi.fn((arg: Record<string, unknown>) => {
          isUpdate = true
          mocks.updateCalls.push(arg)
          return chain
        }),
        select: vi.fn(() =>
          isUpdate
            ? Promise.resolve({ data: mocks.updateResult.data, error: mocks.updateResult.error })
            : chain,
        ),
        in: vi.fn((col?: string) => {
          if (col === "input_data->>type") isRender = true
          return chain
        }),
        not: vi.fn(() => chain),
        eq: vi.fn((col?: string, val?: unknown) => {
          if (col === "provider" && val === "component") isComponentWrapper = true
          return chain
        }),
        is: vi.fn(() => {
          isNeverStarted = true
          return chain
        }),
        filter: vi.fn(() => chain),
        lt: vi.fn(() => chain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        limit: vi.fn(() =>
          Promise.resolve(
            isRender
              ? { data: mocks.renderChain.data ?? mocks.renderRows, error: mocks.renderChain.error }
              : isComponentWrapper
                ? { data: [], error: null }
                : isNeverStarted
                  ? { data: mocks.neverStartedChain.data ?? mocks.neverStartedRows, error: mocks.neverStartedChain.error }
                  : (mocks.mainScanQueue?.shift()
                      ?? { data: mocks.selectChain.data ?? mocks.rows, error: mocks.selectChain.error }),
          ),
        ),
      }
      return chain
    }),
  },
}))

vi.mock("../../queue.js", () => ({
  videoQueue: {
    getJobs: vi.fn(async () => mocks.queueJobs),
    add: vi.fn(async (name: string, data: Record<string, unknown>) => {
      mocks.queueAddCalls.push([name, data])
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

vi.mock("../fal.js", () => ({
  reconcileFalJob: vi.fn().mockResolvedValue(undefined),
}))

import { reconcileInflightJobs, STUCK_ORCHESTRATOR_JOB_TYPES, CHECKPOINT_RESUMABLE_JOB_TYPES } from "../cron.js"
import { sweepStaleSyncJob } from "../sync-sweep.js"
import { reconcileKieJob } from "../kie.js"
import { reconcileReplicateJob } from "../replicate.js"
import { reconcileElevenLabsJob } from "../elevenlabs.js"
import { reconcileFalJob } from "../fal.js"

describe("reconcileInflightJobs", () => {
  beforeEach(() => {
    mocks.rows.length = 0
    mocks.selectChain.data = null
    mocks.selectChain.error = null
    mocks.mainScanQueue = null
    mocks.neverStartedRows.length = 0
    mocks.neverStartedChain.data = null
    mocks.neverStartedChain.error = null
    mocks.renderRows.length = 0
    mocks.renderChain.data = null
    mocks.renderChain.error = null
    mocks.queueJobs.length = 0
    mocks.queueAddCalls.length = 0
    mocks.updateCalls.length = 0
    mocks.updateResult.data = [{ id: "u1" }]
    mocks.updateResult.error = null
    ;(sweepStaleSyncJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileKieJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileReplicateJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileElevenLabsJob as ReturnType<typeof vi.fn>).mockClear()
    ;(reconcileFalJob as ReturnType<typeof vi.fn>).mockClear()
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

  it("dispatches fal-request to reconcileFalJob (POSITIVE dispatch, not the sync sweep)", async () => {
    // audit S4: the catch-all `else` silently sweeps any kind missing a branch
    // (fail+refund), and the async-parity test won't catch a missing dispatch —
    // so this MUST assert reconcileFalJob is positively called.
    // fal-request threshold is 5 min; make the row comfortably past it.
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-fal",
      status: "processing",
      provider_kind: "fal-request",
      provider_task_id: "req-1",
      provider_call_started_at: stale,
      reconcile_attempts: 0,
      job_type: "lip-sync",
      input_data: { provider: "sync-lipsync-v3" },
    })
    const result = await reconcileInflightJobs()
    expect(reconcileFalJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-fal" }))
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(result.recovered).toBe(1)
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

  it("skips a stale row whose finalize_claimed_at is fresh (a finalizer is mid-flight)", async () => {
    // The worker (or a prior cron tick) CAS-claimed the finalize via
    // claim_job_finalize and is downloading/uploading right now. Dispatching a
    // second finalizer would double-download the provider result and race the
    // same R2 key — skip and let the next tick re-check.
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-claimed",
      status: "processing",
      provider_kind: "kie-standard",
      provider_task_id: "task-1",
      provider_call_started_at: stale,
      reconcile_attempts: 0,
      finalize_claimed_at: new Date(Date.now() - 60 * 1000).toISOString(),
    })
    const result = await reconcileInflightJobs()
    expect(reconcileKieJob).not.toHaveBeenCalled()
    expect(sweepStaleSyncJob).not.toHaveBeenCalled()
    expect(result.notStale).toBe(1)
  })

  it("dispatches a stale row whose finalize claim has expired (claimant crashed)", async () => {
    const stale = new Date(Date.now() - 40 * 60 * 1000).toISOString()
    mocks.rows.push({
      id: "j-claim-expired",
      status: "processing",
      provider_kind: "kie-standard",
      provider_task_id: "task-2",
      provider_call_started_at: stale,
      reconcile_attempts: 0,
      finalize_claimed_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    })
    const result = await reconcileInflightJobs()
    expect(reconcileKieJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-claim-expired" }))
    expect(result.recovered).toBe(1)
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

  it("42703 (finalize_claimed_at column missing) → retries the scan without the column and still dispatches (audit H2)", async () => {
    // Deploy window: new code, migration 210/211 not applied yet. The first
    // candidate SELECT names finalize_claimed_at and fails with 42703; the
    // cron must fall back to a column-less scan (pre-claim semantics: treat
    // all claims as absent) instead of silently disabling ALL reconciliation.
    const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    mocks.mainScanQueue = [
      { data: null, error: { message: 'column "jobs.finalize_claimed_at" does not exist', code: "42703" } },
      {
        data: [{
          id: "j-fallback",
          status: "processing",
          provider_kind: "kie-standard",
          provider_task_id: "t-fb",
          provider_call_started_at: stale,
          reconcile_attempts: 0,
        }],
        error: null,
      },
    ]
    const result = await reconcileInflightJobs()
    expect(reconcileKieJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-fallback" }))
    expect(result.recovered).toBe(1)
  })

  it("main-scan error does NOT skip the auxiliary sweeps (audit H2)", async () => {
    // The old early-return on a scan error also skipped sweepNeverStartedJobs /
    // sweepStuckComponentWrappers / sweepStuckRenderJobs — one bad column or
    // transient DB error silently disabled the whole refund-sweep system.
    mocks.selectChain.data = null
    mocks.selectChain.error = { message: "transient" }
    mocks.neverStartedRows.push({ id: "j-orphan-x", provider_kind: null, reconcile_attempts: 0 })
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-orphan-x" }))
    expect(result.swept).toBe(1)
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

  it("sweeps stuck render jobs (processing, no provider_call_started_at) invisible to every other path", async () => {
    // Render jobs leak when a render stalls past BullMQ's stall cap: the row stays
    // 'processing' with no provider_call_started_at and provider != 'component', so
    // the main scan, sweepNeverStartedJobs (pending-only), and the component sweep
    // all miss them. The render sweep must mark them failed + refund.
    mocks.renderRows.push(
      { id: "j-render-1", provider_kind: null, reconcile_attempts: 0 },
      { id: "j-render-2", provider_kind: null, reconcile_attempts: 1 },
    )
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-render-1" }))
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-render-2" }))
    expect(result.swept).toBe(2)
  })

  it("sweeps stranded video-director jobs (processing, no provider_call_started_at) — credit-leak backstop", async () => {
    // video-director never sets provider_call_started_at (the director calls no
    // provider directly; sub-jobs do). If the worker process dies mid-chain
    // (Railway deploy / OOM / SIGKILL) the catch never runs, leaving the reserved
    // "video-director" authoring credit stranded. The orchestrator sweep covers
    // input_data.type IN ('render-video','video-director') so both shapes are caught.
    mocks.renderRows.push(
      { id: "j-director-1", provider_kind: null, reconcile_attempts: 0 },
      { id: "j-director-2", provider_kind: null, reconcile_attempts: 1 },
    )
    const result = await reconcileInflightJobs()
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-director-1" }))
    expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-director-2" }))
    expect(result.swept).toBe(2)
  })

  describe("checkpointed plugin job resume (gvp/evp)", () => {
    const gvpRow = (overrides: Record<string, unknown> = {}) => ({
      id: "j-gvp-1",
      provider_kind: null,
      reconcile_attempts: 0,
      user_id: "user-1",
      usage_log_id: "usage-1",
      input_data: {
        type: "generate-video-pro",
        prompt: "a man walking in the forest",
        userPrompt: "a man walking in the forest",
        provider: "seedance-2-fast",
        duration: 46,
        resolution: "480p",
        aspectRatio: "adaptive",
        generateAudio: true,
        referenceImageUrls: [],
      },
      output_data: {
        pro: {
          version: 1,
          pricing: { mode: "multi", reserveBase: 148, segmentDurations: [14, 11, 11, 11] },
          segments: [{ status: "done", r2Url: "https://r2/j-gvp-1-seg1.mp4", duration: 14 }],
        },
      },
      ...overrides,
    })

    it("membership: all four types are swept; only gvp/evp are checkpoint-resumable", () => {
      expect([...STUCK_ORCHESTRATOR_JOB_TYPES]).toEqual(
        ["render-video", "video-director", "generate-video-pro", "edit-video-pro"])
      expect([...CHECKPOINT_RESUMABLE_JOB_TYPES].sort()).toEqual(["edit-video-pro", "generate-video-pro"])
    })

    it("gvp row with a checkpoint + attempts 0 → requeued for resume, NOT failed: payload reconstructed from the row, CAS bumps attempts + requeued_for_resume + fresh started_at", async () => {
      mocks.renderRows.push(gvpRow())
      const result = await reconcileInflightJobs()

      // requeued, not swept
      expect(sweepStaleSyncJob).not.toHaveBeenCalled()
      expect(result.recovered).toBe(1)
      expect(result.swept).toBe(0)

      // BullMQ payload: {jobId, userId, ...input_data, proPricing (from the
      // checkpoint — money-authoritative), usageLogId}; inert extra keys ride along
      expect(mocks.queueAddCalls).toHaveLength(1)
      const [jobName, payload] = mocks.queueAddCalls[0]
      expect(jobName).toBe("generate-video-pro")
      expect(payload).toMatchObject({
        jobId: "j-gvp-1",
        userId: "user-1",
        prompt: "a man walking in the forest",
        provider: "seedance-2-fast",
        duration: 46,
        resolution: "480p",
        aspectRatio: "adaptive",
        generateAudio: true,
        proPricing: { mode: "multi", reserveBase: 148, segmentDurations: [14, 11, 11, 11] },
        usageLogId: "usage-1",
      })

      // CAS: one resume max, machine tag, started_at refreshed so queue-wait
      // doesn't eat the next RENDER_STALE_MS window
      expect(mocks.updateCalls).toHaveLength(1)
      expect(mocks.updateCalls[0].reconcile_attempts).toBe(1)
      expect(mocks.updateCalls[0].reconcile_last_error).toBe("requeued_for_resume")
      expect(typeof mocks.updateCalls[0].started_at).toBe("string")
      // the row is NOT failed — no status flip in the resume update
      expect(mocks.updateCalls[0].status).toBeUndefined()
    })

    it("evp row with a checkpoint resumes the same way", async () => {
      mocks.renderRows.push(gvpRow({
        id: "j-evp-1",
        input_data: { type: "edit-video-pro", videoUrl: "https://r2/src.mp4", spanStart: 2, spanEnd: 12, prompt: "p", provider: "seedance-2", mode: "replace" },
        output_data: { pro: { kind: "edit", version: 1, pricing: { mode: "replace", reserveBase: 100 }, segments: [] } },
      }))
      const result = await reconcileInflightJobs()

      expect(sweepStaleSyncJob).not.toHaveBeenCalled()
      expect(result.recovered).toBe(1)
      expect(mocks.queueAddCalls).toHaveLength(1)
      const [jobName, payload] = mocks.queueAddCalls[0]
      expect(jobName).toBe("edit-video-pro")
      expect(payload).toMatchObject({
        jobId: "j-evp-1", videoUrl: "https://r2/src.mp4", spanStart: 2, spanEnd: 12,
        proPricing: { mode: "replace", reserveBase: 100 },
      })
    })

    it("resume already spent (attempts ≥ 1) → swept as before, no requeue", async () => {
      mocks.renderRows.push(gvpRow({ reconcile_attempts: 1 }))
      const result = await reconcileInflightJobs()

      expect(mocks.queueAddCalls).toHaveLength(0)
      expect(sweepStaleSyncJob).toHaveBeenCalledWith(expect.objectContaining({ id: "j-gvp-1", reconcile_attempts: 1 }))
      expect(result.swept).toBe(1)
      expect(result.recovered).toBe(0)
    })

    it("no checkpoint yet (single-mode gvp / crash before plan) → swept, no requeue", async () => {
      mocks.renderRows.push(gvpRow({ output_data: null }))
      const result = await reconcileInflightJobs()

      expect(mocks.queueAddCalls).toHaveLength(0)
      expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
      expect(result.swept).toBe(1)
    })

    it("checkpoint without pricing → swept (payload can't be reconstructed money-authoritatively)", async () => {
      mocks.renderRows.push(gvpRow({ output_data: { pro: { version: 1, segments: [] } } }))
      const result = await reconcileInflightJobs()

      expect(mocks.queueAddCalls).toHaveLength(0)
      expect(result.swept).toBe(1)
    })

    it("live BullMQ entry for the row (slow run, not dead) → neither requeued NOR swept", async () => {
      mocks.queueJobs.push({ data: { jobId: "j-gvp-1" } })
      mocks.renderRows.push(gvpRow())
      const result = await reconcileInflightJobs()

      expect(mocks.queueAddCalls).toHaveLength(0)
      expect(sweepStaleSyncJob).not.toHaveBeenCalled()
      expect(mocks.updateCalls).toHaveLength(0)
      expect(result.notStale).toBe(1)
      expect(result.swept).toBe(0)
      expect(result.recovered).toBe(0)
    })

    it("CAS lost (0 rows updated — cancel/complete landed or another tick won) → falls through to sweep, no requeue", async () => {
      mocks.updateResult.data = []
      mocks.renderRows.push(gvpRow())
      const result = await reconcileInflightJobs()

      expect(mocks.queueAddCalls).toHaveLength(0)
      expect(sweepStaleSyncJob).toHaveBeenCalledTimes(1)
      expect(result.swept).toBe(1)
    })

    it("render-video / video-director are NEVER resumed, even with checkpoint-shaped output_data", async () => {
      mocks.renderRows.push(
        gvpRow({ id: "j-r", input_data: { type: "render-video" } }),
        gvpRow({ id: "j-d", input_data: { type: "video-director" } }),
      )
      const result = await reconcileInflightJobs()

      expect(mocks.queueAddCalls).toHaveLength(0)
      expect(sweepStaleSyncJob).toHaveBeenCalledTimes(2)
      expect(result.swept).toBe(2)
    })
  })
})
