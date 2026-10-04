import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { randomUUID } from "node:crypto"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockHasCreditsRef = { value: true }
  const mockRefundJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockCreateAssetFromJob = vi.fn().mockResolvedValue(undefined)
  // Default: treat every attempt as the final one so existing failure tests
  // exercise the finalize+refund path. Per-test override for the retry case.
  const mockIsFinalJobAttempt = vi.fn().mockReturnValue(true)
  const mockIsPromptBlocked = vi.fn().mockReturnValue(false)
  // The Scene3D provider-grant pass. Identity by default (the overwhelmingly
  // common case: no delivery URL in the payload), overridden per test.
  const mockSignScene3DDeliveryUrls = vi.fn(async (payload: Record<string, unknown>) => payload)
  const mockInitProviders = vi.fn()
  const mockTryInlineReconcile = vi.fn().mockResolvedValue(undefined)

  // Handler mock — a single spy we can configure per test
  const mockHandler = vi.fn().mockResolvedValue(undefined)
  // A handler the private-plugin LOADER contributes (keyed "pro-3d-render"
  // below) and the pre-task refresh it must beat while it runs.
  const mockPluginHandler = vi.fn().mockResolvedValue(undefined)
  const mockRefreshPreTaskSentinel = vi.fn().mockResolvedValue(undefined)

  // Supabase mock
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  // Failure-path status CAS chain: update().eq("id").in("status",[...]).select("id").
  // Default: 1 row flipped (we won the race → refund proceeds). Per-test override
  // to [] simulates a concurrent completer/cancel having already moved the row.
  const mockCasSelect = vi.fn().mockResolvedValue({ data: [{ id: "job-1" }], error: null })
  const mockIn = vi.fn().mockReturnValue({ select: mockCasSelect })
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle, in: mockIn })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
  })

  // Captured processor callback from Worker constructor
  let capturedProcessor: ((job: unknown, token?: string) => Promise<void>) | null = null

  return {
    mockHasCreditsRef,
    mockRefundJobCredits,
    mockCreateAssetFromJob,
    mockIsFinalJobAttempt,
    mockIsPromptBlocked,
    mockSignScene3DDeliveryUrls,
    mockInitProviders,
    mockTryInlineReconcile,
    mockHandler,
    mockPluginHandler,
    mockRefreshPreTaskSentinel,
    mockFrom,
    mockSingle,
    mockEq,
    mockIn,
    mockCasSelect,
    mockSelect,
    mockUpdate,
    getCapturedProcessor: () => capturedProcessor,
    setCapturedProcessor: (p: ((job: unknown, token?: string) => Promise<void>) | null) => { capturedProcessor = p },
  }
})

// BullMQ Worker mock — must be a class (called with `new`)
vi.mock("bullmq", () => {
  class MockWorker {
    on = vi.fn()
    close = vi.fn()
    constructor(_queue: string, processor: (job: unknown, token?: string) => Promise<void>) {
      mocks.setCapturedProcessor(processor)
    }
  }
  // The REAL class shape matters: the worker throws `new DelayedError()` after
  // `job.moveToDelayed(...)`, and the drain tests assert `instanceof`.
  class DelayedError extends Error {
    constructor(message = "Delayed") { super(message); this.name = "DelayedError" }
  }
  return { Worker: MockWorker, DelayedError }
})

// IORedis mock — must be a class (called with `new`)
vi.mock("ioredis", () => {
  class FakeRedis {}
  return { default: FakeRedis }
})

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379", EDITION: "cloud" },
  hasCredits: () => mocks.mockHasCreditsRef.value,
  isCloud: () => mocks.mockHasCreditsRef.value,
  isCommunity: () => false,
  isBusiness: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/providers/index.js", () => ({
  initProviders: mocks.mockInitProviders,
  // The worker also starts the pasted-key watch; a no-op here (own suite).
  watchProviderCredentials: vi.fn(),
}))

vi.mock("@/config/content-filter.js", () => ({
  isPromptBlocked: mocks.mockIsPromptBlocked,
}))

vi.mock("../../services/scene3d-artifacts/delivery-provider-access.js", () => ({
  signScene3DDeliveryUrlsForProvider: mocks.mockSignScene3DDeliveryUrls,
}))

vi.mock("../shared.js", () => ({
  refundJobCredits: mocks.mockRefundJobCredits,
  createAssetFromJob: mocks.mockCreateAssetFromJob,
  isFinalJobAttempt: mocks.mockIsFinalJobAttempt,
}))

vi.mock("../inline-reconcile.js", () => ({
  tryInlineReconcile: mocks.mockTryInlineReconcile,
}))

// Mock all handler modules to return our controllable mockHandler
vi.mock("../handlers/image-ai.js", () => ({
  imageAIHandlers: { "generate-image": mocks.mockHandler },
}))
vi.mock("../handlers/video-ai.js", () => ({
  // Two distinct job names live behind the unified generate-video node:
  // its payload-builder dispatches `jobName` to either "image-to-video" or
  // "text-to-video" based on whether a start frame is wired. The worker map
  // therefore must route both names to the same handler family — we wire
  // both keys to the controllable spy so a single test can drive either path.
  videoAIHandlers: {
    "image-to-video": mocks.mockHandler,
    "text-to-video": mocks.mockHandler,
  },
}))
vi.mock("../handlers/ffmpeg.js", () => ({
  ffmpegHandlers: { "combine-videos": mocks.mockHandler },
}))
vi.mock("../handlers/audio-ai.js", () => ({
  audioAIHandlers: {},
}))
vi.mock("../handlers/suno.js", () => ({
  sunoHandlers: {},
}))
vi.mock("../handlers/entity.js", () => ({
  entityHandlers: {},
}))

// Private-plugins loader (Stage 1 VCP extraction) — mocked to a no-op so this
// suite never attempts a real `@nodaroai/cloud-plugins` import or builds the
// real toolkit (which eagerly constructs a real BullMQ `Queue` via
// lib/queue.js — this file's `bullmq` mock above only stubs `Worker`). It
// contributes ONE handler, so the liveness tests can show a loader-contributed
// handler and a core one beating the pre-task sentinel alike (the wrap covers
// every handler the worker dispatches, not a map of them);
// load.ts's own suite (lib/private-plugins/__tests__/load.test.ts) covers the
// merge logic. `engines: {}` mirrors `emptyResult()`'s real shape (S8) —
// `video-worker.ts` destructures `engines` off this result and reads
// `engines.surround` unconditionally, so an incomplete mock here throws at
// module-import time, not inside a test body.
vi.mock("@/lib/private-plugins/load.js", () => ({
  loadPrivatePlugins: vi.fn().mockResolvedValue({
    handlers: { "pro-3d-render": mocks.mockPluginHandler }, loaded: [], engines: {},
  }),
}))

// Only the liveness refresh is replaced; the rest of the module stays real for
// the core handlers this suite imports unmocked.
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/reconcile/persistence.js")>()),
  refreshPreTaskSentinel: mocks.mockRefreshPreTaskSentinel,
}))

// Mock KieError — must be a real class for instanceof checks
vi.mock("@/providers/kie/client.js", () => {
  class KieError extends Error {
    public readonly internalDetails: string
    public readonly context: string
    constructor(sanitizedMessage: string, internalDetails: string, context: string) {
      super(sanitizedMessage)
      this.name = "KieError"
      this.internalDetails = internalDetails
      this.context = context
    }
  }
  return { KieError }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { createVideoWorker, DRAIN_REQUEUE_DELAY_MS } from "../video-worker.js"
import { PRE_TASK_HEARTBEAT_MS, PRE_TASK_HEARTBEAT_MAX_MS } from "../pre-task-heartbeat.js"
import { STALE_THRESHOLD_MS } from "../../lib/reconcile/types.js"
import { SCENE3D_HEARTBEAT_MS } from "../handlers/scene3d.js"
import { LLM_STRUCTURED_HEARTBEAT_MS } from "../handlers/llm-structured.js"
import { KieError } from "../../providers/kie/client.js"
// Real class (module not mocked) — the worker's self-heal branch discriminates
// on isPostProcessingError, so tests must throw the genuine type.
import { PostProcessingError } from "../../lib/post-processing-error.js"
// Real class (module not mocked) — the drain branch discriminates on
// instanceof DrainAbortError, so tests must throw the genuine type.
import { DrainAbortError, beginWorkerDrain, _resetWorkerDrainForTests } from "../../lib/worker-drain.js"
// Real journal (module not mocked) with a scripted Redis — the hand-off tests
// drive the actual claim-time refusal, not a stand-in for it.
import { createStageJournal } from "../../lib/private-plugins/stage-journal.js"
import type { PluginStageKey, PluginStageToolkit } from "../../lib/private-plugins/scene3d-contract.js"
import { DelayedError } from "bullmq"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockJobRecord(overrides: Record<string, unknown> = {}) {
  return {
    usage_log_id: "usage-1",
    user_id: "user-1",
    should_watermark: false,
    profiles: { public_outputs: true },
    ...overrides,
  }
}

function makeBullJob(name: string, data: Record<string, unknown> = {}) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
    // BullMQ's in-processor requeue primitive (drain path): the job moves back
    // to the queue WITHOUT spending an attempt.
    moveToDelayed: vi.fn().mockResolvedValue(undefined),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockHasCreditsRef.value = true
  mocks.mockSingle.mockResolvedValue({ data: mockJobRecord(), error: null })
  mocks.mockSignScene3DDeliveryUrls.mockImplementation(async (payload: Record<string, unknown>) => payload)
})

describe("createVideoWorker", () => {
  it("initializes providers and captures the processor", () => {
    createVideoWorker()
    expect(mocks.mockInitProviders).toHaveBeenCalled()
    expect(mocks.getCapturedProcessor()).toBeDefined()
  })
})

describe("video worker processor", () => {
  let processor: (job: unknown, token?: string) => Promise<void>

  beforeEach(() => {
    createVideoWorker()
    processor = mocks.getCapturedProcessor()!
    expect(processor).toBeDefined()
  })

  it("routes to correct handler for known job type", async () => {
    const job = makeBullJob("generate-image")
    await processor(job)
    expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
  })

  // -------------------------------------------------------------------------
  // Scene3D delivery artifacts for an EXTERNAL provider.
  //
  // A 3D Render Pro shot still's URL is the AUTHENTICATED delivery endpoint —
  // its bytes stay in the private scene bucket by contract — so a provider
  // fetching `referenceImageUrls` server-to-server gets a 401. THIS dispatch is
  // where the swap for a signed, bounded GET happens, because it is the one
  // point every lane converges on (orchestrated DAG, canvas Run, REST, MCP) and
  // the last moment before the provider call.
  //
  // The behaviour of the grant itself is proved in
  // `services/scene3d-artifacts/__tests__/delivery-provider-access.test.ts`;
  // what is pinned here is the WIRING: the pass runs with the job OWNER's id
  // (not the actor of whatever request enqueued it), and its result is what the
  // handler receives.
  // -------------------------------------------------------------------------
  it("signs Scene3D delivery URLs with the job owner's identity before the handler runs", async () => {
    const signed = { jobId: "job-1", referenceImageUrls: ["https://private.example/signed?X-Amz-Signature=abc"] }
    mocks.mockSignScene3DDeliveryUrls.mockResolvedValue(signed)

    const job = makeBullJob("generate-image", { referenceImageUrls: ["https://app.nodaro.ai/v1/3d-scene/deliveries/j/assets/a"] })
    await processor(job)

    expect(mocks.mockSignScene3DDeliveryUrls).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImageUrls: ["https://app.nodaro.ai/v1/3d-scene/deliveries/j/assets/a"] }),
      // `jobs.user_id` from the row read at pickup — the delivery's owner.
      "user-1",
    )
    // The handler runs on the SIGNED payload, not the authenticated one.
    expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
    expect((mocks.mockHandler.mock.calls[0][0] as { data: unknown }).data).toBe(signed)
  })

  it("runs the pass BEFORE the handler, so no provider call sees an unsigned URL", async () => {
    const order: string[] = []
    mocks.mockSignScene3DDeliveryUrls.mockImplementation(async (payload: Record<string, unknown>) => {
      order.push("sign")
      return payload
    })
    mocks.mockHandler.mockImplementation(async () => { order.push("handler") })

    await processor(makeBullJob("generate-image"))
    expect(order).toEqual(["sign", "handler"])
  })

  // -------------------------------------------------------------------------
  // INVARIANT — the pickup CAS OVERWRITES `jobs.job_type` with the BullMQ job
  // name. This is a guard, not a description: two systems outside this file
  // are built on the rewrite, and both fail SILENTLY when it stops happening.
  //
  //  1. THE GALLERY. `routes/gallery.ts` (+ its MCP twin
  //     `lib/mcp/tools/gallery.ts`) allowlists rows with
  //     `.in("job_type", [...IMAGE_JOBS, ...VIDEO_JOBS, ...AUDIO_JOBS])`, and
  //     those sets are spelled in QUEUE-NAME vocabulary. Orchestrated DAG rows
  //     are inserted with `job_type = node.type` — `generate-video`,
  //     `modify-image`, `upscale-image` are in no allowlist — so they appear in
  //     the gallery only because this UPDATE rewrites them to the name
  //     payload-builder dispatched under. A production sample had 225 of 400
  //     completed DAG rows depending on it. Weaken the write to
  //     `job_type: row.job_type ?? job.name` and that history vanishes from
  //     every gallery surface with no error anywhere.
  //     (`routes/__tests__/gallery.test.ts` pins the three renames.)
  //  2. THE PLUGIN CONTRACT. `@nodaroai/cloud-plugins` reads the row back
  //     through `tk.jobs.readJob(...).job_type` and sometimes guards on it
  //     (`row.job_type !== "generate-video-pro"`). Such a guard is correct only
  //     because that lane inserts and enqueues the SAME string; a lane that
  //     admits X and enqueues Y must accept BOTH. Trusting the old "backfill"
  //     wording is what left the Scene3D advanced preview lane dark for a day
  //     (private plugins PR #467).
  //
  // The fixture pairs a row that ALREADY carries a different `job_type` with a
  // differently-named BullMQ job — that pairing is the discriminator. A row
  // with a null `job_type` would pass under `?? job.name` too and prove nothing.
  // -------------------------------------------------------------------------
  it("pickup OVERWRITES job_type with the BullMQ job name (gallery + plugin invariant)", async () => {
    // Exactly how the orchestrator inserts a unified generate-video node:
    // `job_type = node.type` = "generate-video", enqueued as "image-to-video".
    mocks.mockSingle.mockResolvedValue({
      data: mockJobRecord({ job_type: "generate-video" }),
      error: null,
    })

    await processor(makeBullJob("image-to-video"))

    const pickup = mocks.mockUpdate.mock.calls.find(
      ([fields]) => (fields as Record<string, unknown> | undefined)?.status === "processing",
    )
    expect(
      pickup,
      "The pickup CAS (`.update({status:\"processing\", …})` in video-worker.ts) did not run — the assertions below cannot judge the job_type invariant.",
    ).toBeDefined()

    const fields = pickup![0] as Record<string, unknown>
    expect(
      fields.job_type,
      "INVARIANT BROKEN: the pickup CAS must set `job_type: job.name` UNCONDITIONALLY. " +
        "The row here already carried job_type=\"generate-video\" (how node-executor.ts inserts a DAG row) " +
        "and was picked up as \"image-to-video\", so a `?? job.name` / `if (!row.job_type)` backfill leaves " +
        "\"generate-video\" on the row. Consequence 1 (gallery): routes/gallery.ts and lib/mcp/tools/gallery.ts " +
        "filter `.in(\"job_type\", …)` with QUEUE names, so the row silently disappears from every gallery surface " +
        "(a prod sample: 225 of 400 completed DAG rows depend on this rewrite). Consequence 2 (plugins): " +
        "@nodaroai/cloud-plugins reads the row via tk.jobs.readJob().job_type and guards on it — the contract is " +
        "that a plugin lane accepts BOTH the type its route admitted and the queue name it enqueued under " +
        "(see lib/private-plugins/types.ts::readJob). Change this only with both consumers changed first.",
    ).toBe("image-to-video")
  })

  // Track 0.13: the pickup names `slot_wait_ms` (migration 451). Staging runs
  // dev against the shared database before the migration reaches it — and a
  // statement naming a missing column is not applied at all, so without the
  // retry every job would be discarded as "not runnable".
  it("pickup retries without slot_wait_ms while the column is missing, and the job runs", async () => {
    const { resetSlotWaitColumnForTests } = await import("../../lib/jobs-slot-wait-column.js")
    try {
      mocks.mockSingle.mockResolvedValue({ data: mockJobRecord(), error: null })
      mocks.mockCasSelect
        .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column jobs.slot_wait_ms does not exist" } })
        .mockResolvedValueOnce({ data: [{ id: "job-1" }], error: null })

      await processor(makeBullJob("generate-image"))

      expect(mocks.mockCasSelect.mock.calls[0]?.[0]).toContain("slot_wait_ms")
      expect(mocks.mockCasSelect.mock.calls[1]?.[0]).toBe("id")
      expect(mocks.mockHandler).toHaveBeenCalledTimes(1)
    } finally {
      resetSlotWaitColumnForTests()
    }
  })

  // Phase 4: BullMQ stall-retry guard + inline recovery (Layer 1).
  it("stall-retry: skips handler AND dispatches to tryInlineReconcile when provider_task_id is set", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({
        provider_task_id: "t-existing",
        provider_kind: "kie-suno",
        reconcile_attempts: 0,
        job_type: "suno-generate",
      }),
      error: null,
    })

    const job = makeBullJob("suno-generate")
    await processor(job)

    expect(mocks.mockHandler).not.toHaveBeenCalled()
    // Status update to "processing" is also skipped — we don't touch the row.
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    )
    // The Layer-1 win: inline reconcile fires immediately instead of waiting
    // for the cron at the kie-suno 30-min threshold.
    expect(mocks.mockTryInlineReconcile).toHaveBeenCalledWith({
      id: "job-1",
      provider_kind: "kie-suno",
      provider_task_id: "t-existing",
      reconcile_attempts: 0,
      job_type: "suno-generate",
      // input_data is now carried through so the fal inline path can recover its
      // endpoint; absent on this record → null.
      input_data: null,
    })
  })

  it("stall-retry: passes null provider_kind through (cron will sweep)", async () => {
    // Legacy row from before Phase 1 — provider_task_id set but kind missing.
    // tryInlineReconcile handles this case by logging + returning; the cron's
    // catch-all then sweeps the row.
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({
        provider_task_id: "t-legacy",
        provider_kind: null,
        reconcile_attempts: 0,
        job_type: "generate-image",
      }),
      error: null,
    })

    await processor(makeBullJob("generate-image"))

    expect(mocks.mockTryInlineReconcile).toHaveBeenCalledWith(
      expect.objectContaining({ provider_kind: null }),
    )
  })

  it("normal flow: runs handler when provider_task_id is null", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({ provider_task_id: null }),
      error: null,
    })

    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockHandler).toHaveBeenCalled()
  })

  it("throws for unknown job type", async () => {
    const job = makeBullJob("unknown-job-type")
    await expect(processor(job)).rejects.toThrow("Unknown job type: unknown-job-type")
  })

  it("updates job to 'processing' before calling handler", async () => {
    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    )
  })

  it("sets provider_kind='pre-task' + provider_call_started_at in the processing transition", async () => {
    // Reconcile blind-spot regression: a worker crash between status=processing
    // and the first onTaskCreated used to leave the row invisible to the
    // reconcile cron (NULL provider_call_started_at filter). The pre-task
    // sentinel + timestamp make the row visible at the 30-min threshold, and
    // the sync-sweep marks it failed + refunds the reservation.
    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "processing",
        provider_kind: "pre-task",
        provider_call_started_at: expect.any(String),
      }),
    )
  })

  it("uses should_watermark from job record in cloud edition", async () => {
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({ should_watermark: true }),
      error: null,
    })

    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockHandler).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ shouldWatermark: true }),
    )
  })

  it("always sets shouldWatermark=false in self-hosted edition", async () => {
    mocks.mockHasCreditsRef.value = false
    mocks.mockSingle.mockResolvedValueOnce({
      data: mockJobRecord({ should_watermark: true }),
      error: null,
    })

    const job = makeBullJob("generate-image")
    await processor(job)

    expect(mocks.mockHandler).toHaveBeenCalledWith(
      job,
      expect.objectContaining({ shouldWatermark: false }),
    )
  })

  it("sets isPublicOutput=false when prompt is blocked", async () => {
    mocks.mockIsPromptBlocked.mockReturnValueOnce(true)

    const job = makeBullJob("generate-image", { prompt: "blocked content" })
    await processor(job)

    // The update call should have is_public: false
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ is_public: false }),
    )
  })

  it("creates asset after successful handler", async () => {
    const job = makeBullJob("generate-image")
    await processor(job)
    expect(mocks.mockCreateAssetFromJob).toHaveBeenCalledWith("job-1", "user-1")
  })

  it("updates job to 'failed' on error", async () => {
    mocks.mockHandler.mockRejectedValueOnce(new Error("handler crashed"))

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow("handler crashed")

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: "handler crashed" }),
    )
  })

  it("stores the sanitized message in error_message and the REDACTED internal details in error_detail", async () => {
    mocks.mockHandler.mockRejectedValueOnce(
      new KieError(
        "Image generation failed",
        "KIE API returned 500: internal server error at https://api.kie.ai/v1/x?token=abc",
        "generate-image",
      ),
    )

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow("Image generation failed")

    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        error_message: "Image generation failed",
        error_detail: "KIE API returned 500: internal server error at api.kie.ai/…",
      }),
    )
  })

  it("writes error_detail: null for a plain Error (no provider text)", async () => {
    mocks.mockHandler.mockRejectedValueOnce(new Error("handler crashed"))
    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow("handler crashed")
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error_message: "handler crashed", error_detail: null }),
    )
  })

  it("refunds credits on error — passes the ERROR OBJECT so the PostProcessingError type signal survives", async () => {
    const crash = new Error("crash")
    mocks.mockHandler.mockRejectedValueOnce(crash)

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow()

    // The worker MUST forward the thrown value (not just its message) so
    // refundJobCredits can distinguish a post-provider PostProcessingError
    // (skip) from a pre-provider plain error (refund).
    expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", crash)
  })

  it("does NOT trample or refund a concurrently-completed job (failure CAS flips 0 rows)", async () => {
    // Race: a concurrent writer (inflight-reconcile cron / stall re-pick) already
    // moved the row to a terminal state (completed → credits committed + asset
    // delivered, or cancelled → already refunded). The final-attempt failure
    // UPDATE's status CAS (.in("status",["pending","processing"])) then matches 0
    // rows. We must NOT refund (would orphan a delivered+billed result) and the
    // completed status must survive.
    // Two queued CAS results: pickup CAS wins (row was live at pickup), then
    // the failure CAS misses (concurrent writer landed mid-handler).
    mocks.mockCasSelect
      .mockResolvedValueOnce({ data: [{ id: "job-1" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    // Deliberately a PLAIN Error: upgrading it to PostProcessingError would
    // reroute this test into the self-heal branch (row left processing).
    mocks.mockHandler.mockRejectedValueOnce(new Error("post-provider upload 500"))

    const job = makeBullJob("generate-image")
    await expect(processor(job)).rejects.toThrow("post-provider upload 500")

    // The CAS guard was applied. Two DIFFERENT guards run in this path: the
    // worker's own pickup CAS (["pending","processing"] — unchanged, D9 keeps
    // completion single-shot) and the failure CAS, which is markJobFailed's
    // FAILABLE_STATUSES: "queued" is newly failable, "pending_review" never is.
    expect(mocks.mockIn).toHaveBeenCalledWith("status", ["pending", "processing"])
    expect(mocks.mockIn).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])
    expect(
      mocks.mockIn.mock.calls.every((c) => !(c[1] as string[]).includes("pending_review")),
    ).toBe(true)
    // ...and because 0 rows were flipped, no refund fired.
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
  })

  it("pickup CAS: discards a job cancelled while queued (0 rows flipped) — handler never runs, no refund", async () => {
    // A1 (audit): cancelling a still-queued job sets status='cancelled' and
    // refunds, but BullMQ queue removal is best-effort — the worker still
    // dequeues the entry. The pickup UPDATE must CAS on live statuses and
    // abort when it flips 0 rows. The old unguarded overwrite resurrected the
    // row to 'processing' and ran the full provider generation: the user kept
    // the refund AND got the output, while we paid the provider.
    mocks.mockCasSelect.mockResolvedValueOnce({ data: [], error: null })

    const job = makeBullJob("generate-image")
    await expect(processor(job)).resolves.toBeUndefined()

    expect(mocks.mockHandler).not.toHaveBeenCalled()
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
  })

  // -------------------------------------------------------------------------
  // Post-provider self-heal (audit spec, worker branch). A PostProcessingError
  // on the FINAL attempt means the provider already delivered and we already
  // paid — if the row is reconcile-recoverable (persisted task id + a kind the
  // reconcile system owns), marking it failed+charged throws away a result the
  // cron can recover (or a refund the sweep would grant). Leave it
  // `processing`; reconcile drives it to completed or refunded+anomaly.
  // -------------------------------------------------------------------------
  describe("post-provider self-heal branch", () => {
    it.each([
      ["kie-standard", "t-kie"],
      ["kie-suno", "t-suno"],
      ["replicate-prediction", "p-rep"],
      ["heygen", "video-hg"], // D3: leave for the sync-sweep's fail+refund
    ])(
      "final attempt + PostProcessingError + recoverable row (%s) → resolves, row left processing, no refund",
      async (kind, taskId) => {
        // First select: fresh run (no task id → stall guard doesn't divert).
        // Second select: the catch-branch's fresh row read.
        mocks.mockSingle
          .mockResolvedValueOnce({ data: mockJobRecord({ provider_task_id: null }), error: null })
          .mockResolvedValueOnce({
            data: { provider_kind: kind, provider_task_id: taskId, status: "processing" },
            error: null,
          })
        mocks.mockHandler.mockRejectedValueOnce(new PostProcessingError("R2 upload failed"))

        const job = makeBullJob("generate-image")
        await expect(processor(job)).resolves.toBeUndefined()

        expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
          expect.objectContaining({ status: "failed" }),
        )
        expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
      },
    )

    it("final attempt + PostProcessingError + SYNC kind → existing fail path (refund guard decides)", async () => {
      mocks.mockSingle
        .mockResolvedValueOnce({ data: mockJobRecord({ provider_task_id: null }), error: null })
        .mockResolvedValueOnce({
          data: { provider_kind: "elevenlabs-sync", provider_task_id: "t-x", status: "processing" },
          error: null,
        })
      const err = new PostProcessingError("R2 upload failed")
      mocks.mockHandler.mockRejectedValueOnce(err)

      const job = makeBullJob("generate-image")
      await expect(processor(job)).rejects.toThrow("R2 upload failed")

      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      )
      // refundJobCredits receives the typed error and SKIPS internally — the
      // worker must still forward it (refund-direction contract unchanged).
      expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", err)
    })

    it("final attempt + PostProcessingError + NO provider_task_id → existing fail path", async () => {
      mocks.mockSingle
        .mockResolvedValueOnce({ data: mockJobRecord({ provider_task_id: null }), error: null })
        .mockResolvedValueOnce({
          data: { provider_kind: "kie-standard", provider_task_id: null, status: "processing" },
          error: null,
        })
      mocks.mockHandler.mockRejectedValueOnce(new PostProcessingError("watermark failed"))

      const job = makeBullJob("generate-image")
      await expect(processor(job)).rejects.toThrow("watermark failed")

      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      )
    })

    it("row already cancelled at the fresh read → falls through; CAS flips 0 rows → no refund", async () => {
      mocks.mockSingle
        .mockResolvedValueOnce({ data: mockJobRecord({ provider_task_id: null }), error: null })
        .mockResolvedValueOnce({
          data: { provider_kind: "kie-standard", provider_task_id: "t-1", status: "cancelled" },
          error: null,
        })
      // Pickup CAS wins; failure CAS misses (row is cancelled).
      mocks.mockCasSelect
        .mockResolvedValueOnce({ data: [{ id: "job-1" }], error: null })
        .mockResolvedValueOnce({ data: [], error: null })
      mocks.mockHandler.mockRejectedValueOnce(new PostProcessingError("upload failed"))

      const job = makeBullJob("generate-image")
      await expect(processor(job)).rejects.toThrow("upload failed")

      expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    })

    it("NON-final attempt + PostProcessingError → rethrows without consulting the row", async () => {
      mocks.mockIsFinalJobAttempt.mockReturnValueOnce(false)
      mocks.mockHandler.mockRejectedValueOnce(new PostProcessingError("transient R2 blip"))

      const job = makeBullJob("generate-image")
      await expect(processor(job)).rejects.toThrow("transient R2 blip")

      // Only the initial jobRecord fetch — the self-heal branch (and its
      // fresh select) must not run on retryable attempts.
      expect(mocks.mockSingle).toHaveBeenCalledTimes(1)
      expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    })

    it("plain Error + recoverable-looking row → existing fail path (inpaint composite guard)", async () => {
      // REFUND-CRITICAL boundary (handlers/image-ai.ts): compositeInpaint
      // failures throw PLAIN errors precisely so they refund. The self-heal
      // branch must never divert them to reconcile — the cron would
      // "recover" the job by finalizing the raw, un-composited image.
      mocks.mockSingle.mockResolvedValueOnce({
        data: mockJobRecord({ provider_task_id: null }),
        error: null,
      })
      const plain = new Error("composite failed")
      mocks.mockHandler.mockRejectedValueOnce(plain)

      const job = makeBullJob("generate-image")
      await expect(processor(job)).rejects.toThrow("composite failed")

      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed" }),
      )
      expect(mocks.mockRefundJobCredits).toHaveBeenCalledWith("usage-1", "job-1", plain)
    })
  })

  it("does NOT refund or mark failed on a non-final attempt — BullMQ will retry", async () => {
    // Regression: refunding on a retryable attempt destroys the reservation,
    // so a successful retry commits against an already-refunded usage_log
    // (no-op) → the media is delivered for free.
    mocks.mockIsFinalJobAttempt.mockReturnValueOnce(false)
    mocks.mockHandler.mockRejectedValueOnce(new Error("transient KIE 503"))

    const job = makeBullJob("generate-image")
    // Still rethrows so BullMQ schedules the retry...
    await expect(processor(job)).rejects.toThrow("transient KIE 503")
    // ...but the reservation is left intact and the row is not marked failed.
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
  })

  // -------------------------------------------------------------------------
  // Unified generate-video node — dispatch parity contract.
  //
  // The new node never emits its own `job.name`; payload-builder swaps in
  // either "image-to-video" (start frame wired) or "text-to-video" (text-only).
  // The worker must continue to route those job-name strings to the same i2v
  // and t2v handlers it has always used — no new entries needed in the map,
  // just confirmation that both names still resolve.
  //
  // Adding these guards prevents a future refactor (e.g., introducing a
  // dedicated "generate-video" handler key) from silently breaking dispatch
  // for the unified node while leaving the legacy single-node routes intact.
  // -------------------------------------------------------------------------

  it("dispatch parity: routes 'image-to-video' job.name through videoAIHandlers (generate-video start-frame mode)", async () => {
    const job = makeBullJob("image-to-video", { provider: "kling" })
    await processor(job)
    expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
  })

  it("dispatch parity: routes 'text-to-video' job.name through videoAIHandlers (generate-video text-only mode)", async () => {
    const job = makeBullJob("text-to-video", { provider: "kling" })
    await processor(job)
    expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
  })

  it("dispatch parity: does NOT recognize 'generate-video' as a job name (payload-builder must rewrite it)", async () => {
    // Regression net: if anyone removes the mode-dispatch swap in
    // payload-builder.ts and lets the raw node type leak through to
    // BullMQ, the worker has nothing to do with it. Surface that as a
    // fast crash, not a silent stall on a queue with no handler.
    const job = makeBullJob("generate-video")
    await expect(processor(job)).rejects.toThrow("Unknown job type: generate-video")
  })

  // -------------------------------------------------------------------------
  // Drain-abort classification (incident 2026-07-15).
  //
  // A DrainAbortError means the WORKER is dying (deploy SIGTERM), not that the
  // job failed: the row must be left exactly as-is (reservation intact, status
  // untouched) and the error rethrown so BullMQ requeues the job with its lock
  // released — the replacement process re-picks it seconds after boot. Marking
  // it failed+refunded would throw away a provider task that is still running
  // (or already delivered) upstream.
  // -------------------------------------------------------------------------

  // 2026-08-18 (recast run f4f503b6): a rethrow SPENDS a BullMQ attempt, and
  // two rollouts inside two minutes (staging deploys on every dev merge)
  // exhausted `attempts: 3` on one paid cycle — the job went failed-permanent
  // in BullMQ while its row sat `processing` for 30 minutes until the reconcile
  // sweep failed it. A drain is the WORKER dying, not the job failing: it must
  // go back to the queue at zero cost — `job.moveToDelayed(now + δ, token)` +
  // `DelayedError`, the same primitive the social-publish worker already uses.
  it("DrainAbortError → moves the job back to the queue WITHOUT spending an attempt (moveToDelayed + DelayedError); row untouched", async () => {
    mocks.mockIsFinalJobAttempt.mockReturnValueOnce(true) // even on the final attempt
    mocks.mockHandler.mockRejectedValueOnce(new DrainAbortError())

    const job = makeBullJob("generate-image")
    await expect(processor(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)

    // Requeued through BullMQ's own primitive, with the processor's lock token,
    // a short delay (the replacement container is already up — Railway rolls
    // the new one in before draining the old), never a long park.
    expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
    const [ts, token] = job.moveToDelayed.mock.calls[0]
    expect(token).toBe("lock-token")
    expect(ts - Date.now()).toBeGreaterThan(0)
    expect(ts - Date.now()).toBeLessThanOrEqual(10_000)

    // Only the pickup jobRecord fetch — no self-heal row re-select.
    expect(mocks.mockSingle).toHaveBeenCalledTimes(1)
    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
  })

  it("DrainAbortError when moveToDelayed itself fails (lock gone / connection closing) → falls back to the plain rethrow, still no mark-failed/refund", async () => {
    mocks.mockHandler.mockRejectedValueOnce(new DrainAbortError())
    const job = makeBullJob("generate-image")
    job.moveToDelayed.mockRejectedValueOnce(new Error("Missing lock for job bull-1"))

    await expect(processor(job, "lock-token")).rejects.toBeInstanceOf(DrainAbortError)

    expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
    expect(mocks.mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
  })

  // -------------------------------------------------------------------------
  // Handler liveness (2026-09-15, staging Pro 3D Render job 99ede351; widened
  // 2026-09-22 to every handler).
  //
  // The pickup above stamps `pre-task` on every row, and the reconcile cron
  // fails + refunds a row whose stamp is 30 minutes old. The Pro run never
  // refreshed it and was failed at minute 31 with its worker alive. The wrap
  // first covered only the plugin loader's map; a core ffmpeg long-runner (an
  // hour-long multicam apply-edl cut) had the same exposure. Every handler the
  // worker DISPATCHES is wrapped now — plugin, relay or core — so a job type
  // nobody listed is covered the day it ships.
  // -------------------------------------------------------------------------
  describe("handler liveness (pre-task heartbeat)", () => {
    afterEach(() => { vi.useRealTimers() })

    const runsFor = (ms: number) => () => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

    it("a loader-contributed handler beats the pre-task sentinel for its job for as long as it runs", async () => {
      vi.useFakeTimers()
      mocks.mockPluginHandler.mockImplementationOnce(runsFor(35 * 60_000))
      const job = makeBullJob("pro-3d-render")

      const run = processor(job, "lock-token")
      await vi.advanceTimersByTimeAsync(35 * 60_000)
      await run

      expect(mocks.mockPluginHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
      expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBeGreaterThanOrEqual(34)
      expect(new Set(mocks.mockRefreshPreTaskSentinel.mock.calls.map(([id]) => id))).toEqual(new Set(["job-1"]))

      const beats = mocks.mockRefreshPreTaskSentinel.mock.calls.length
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBe(beats)
    })

    // The wrap used to cover ONLY the plugin map; a core ffmpeg long-runner
    // (an hour-long multicam apply-edl cut) aged into the 30-minute sweep with
    // its worker still rendering. Every handler the worker dispatches beats now.
    it("a CORE handler is wrapped too: a long ffmpeg run beats the sentinel for as long as it runs", async () => {
      vi.useFakeTimers()
      mocks.mockHandler.mockImplementationOnce(runsFor(35 * 60_000))
      const job = makeBullJob("combine-videos")

      const run = processor(job, "lock-token")
      await vi.advanceTimersByTimeAsync(35 * 60_000)
      await run

      expect(mocks.mockHandler).toHaveBeenCalledWith(job, expect.objectContaining({ jobId: "job-1" }))
      expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBeGreaterThanOrEqual(34)
      expect(new Set(mocks.mockRefreshPreTaskSentinel.mock.calls.map(([id]) => id))).toEqual(new Set(["job-1"]))

      const beats = mocks.mockRefreshPreTaskSentinel.mock.calls.length
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBe(beats)
    })

    it("a short core handler settles before the first beat — nothing is refreshed for it", async () => {
      vi.useFakeTimers()
      mocks.mockHandler.mockImplementationOnce(runsFor(PRE_TASK_HEARTBEAT_MS - 1))

      const run = processor(makeBullJob("generate-image"), "lock-token")
      await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MS - 1)
      await run

      expect(mocks.mockHandler).toHaveBeenCalled()
      expect(mocks.mockRefreshPreTaskSentinel).not.toHaveBeenCalled()
    })

    it("the hung-handler backstop survives the wrap: beats stop at the cap and a core handler that never settles ages into the sweep", async () => {
      vi.useFakeTimers()
      mocks.mockHandler.mockImplementationOnce(runsFor(PRE_TASK_HEARTBEAT_MAX_MS + 60 * 60_000))

      const run = processor(makeBullJob("generate-image"), "lock-token")
      await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS)
      // It beat the WHOLE way to the cap (every interval but the capped tick),
      // not merely once — so a wrap that stopped early would fail here too.
      const beatsAtCap = mocks.mockRefreshPreTaskSentinel.mock.calls.length
      expect(beatsAtCap).toBeGreaterThanOrEqual(Math.floor(PRE_TASK_HEARTBEAT_MAX_MS / PRE_TASK_HEARTBEAT_MS) - 1)

      // A full sweep threshold past the cap: not one more beat, so the stamp
      // has aged past STALE_THRESHOLD_MS["pre-task"] by the time the run ends.
      await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS["pre-task"] + PRE_TASK_HEARTBEAT_MS)
      expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBe(beatsAtCap)

      await vi.advanceTimersByTimeAsync(60 * 60_000)
      await run
    })

    // A handler whose legitimate run outlives the default cap (apply-edl on a
    // direct lane, hours of ffmpeg) declares its own budget — the one it gives
    // its own work — and the dispatch site honours it: the beats continue past
    // the default cap and stop at the declared budget instead.
    it("a handler that declares its own liveness budget beats past the default cap, up to that budget", async () => {
      vi.useFakeTimers()
      const budgetMs = PRE_TASK_HEARTBEAT_MAX_MS + 3 * 60 * 60_000
      const declared = Object.assign(
        vi.fn(async (_job: unknown, _ctx: unknown) => { await runsFor(budgetMs + 60 * 60_000)() }),
        { livenessBudgetMs: vi.fn(() => budgetMs) },
      )
      mocks.mockHandler.mockImplementationOnce((job: unknown, ctx: unknown) => declared(job, ctx))
      ;(mocks.mockHandler as unknown as { livenessBudgetMs?: unknown }).livenessBudgetMs = declared.livenessBudgetMs
      try {
        const job = makeBullJob("combine-videos")
        const run = processor(job, "lock-token")

        await vi.advanceTimersByTimeAsync(PRE_TASK_HEARTBEAT_MAX_MS + 60 * 60_000)
        // The dispatch site asked the handler for its budget, with the job.
        expect(declared.livenessBudgetMs).toHaveBeenCalledWith(job)
        const pastDefault = mocks.mockRefreshPreTaskSentinel.mock.calls.length
        expect(pastDefault).toBeGreaterThan(Math.floor(PRE_TASK_HEARTBEAT_MAX_MS / PRE_TASK_HEARTBEAT_MS))

        await vi.advanceTimersByTimeAsync(2 * 60 * 60_000) // → the declared budget
        const atBudget = mocks.mockRefreshPreTaskSentinel.mock.calls.length
        expect(atBudget).toBeGreaterThanOrEqual(Math.floor(budgetMs / PRE_TASK_HEARTBEAT_MS) - 1)

        await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS["pre-task"] + PRE_TASK_HEARTBEAT_MS)
        expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBe(atBudget)

        await vi.advanceTimersByTimeAsync(60 * 60_000)
        await run
      } finally {
        delete (mocks.mockHandler as unknown as { livenessBudgetMs?: unknown }).livenessBudgetMs
      }
    })

    it("a drain hand-off stops the beats and still goes back to the queue at no attempt cost", async () => {
      vi.useFakeTimers()
      mocks.mockPluginHandler.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { setTimeout(resolve, 5 * 60_000) })
        throw new Error("Scene processing did not complete", { cause: new DrainAbortError() })
      })
      const job = makeBullJob("pro-3d-render")

      const run = processor(job, "lock-token").catch((error: unknown) => error)
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(await run).toBeInstanceOf(DelayedError)
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1)

      const beats = mocks.mockRefreshPreTaskSentinel.mock.calls.length
      expect(beats).toBeGreaterThanOrEqual(4)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(mocks.mockRefreshPreTaskSentinel.mock.calls.length).toBe(beats)
    })

    it("budget: a handed-back row waits out the requeue delay on a stamp at most one beat old, far inside the threshold", () => {
      expect(DRAIN_REQUEUE_DELAY_MS + 2 * PRE_TASK_HEARTBEAT_MS).toBeLessThan(STALE_THRESHOLD_MS["pre-task"])
    })

    it("budget: the core long-running handlers' own pre-task heartbeats beat well inside the threshold too", () => {
      for (const interval of [SCENE3D_HEARTBEAT_MS, LLM_STRUCTURED_HEARTBEAT_MS]) {
        expect(2 * interval).toBeLessThan(STALE_THRESHOLD_MS["pre-task"])
      }
    })
  })

  // -------------------------------------------------------------------------
  // A private plugin's PAID stage when the deploy SIGTERM lands
  // (2026-09-15, staging, Pro jobs 351f0270 and 35bd1f1f).
  //
  // Both jobs were mid planner call when their container was replaced. The
  // process was killed, the successor re-ran the job, found the stage's
  // invocation marker with no result and — refusing to pay twice — failed and
  // refunded the whole run. The hand-off contract: the in-flight call finishes
  // and completes its stage; the NEXT claim (made with `handOffOnDrain`)
  // throws DrainAbortError before any journal write; the plugin lets it leave
  // its handler (wrapped or not); and this catch moves the job back to the
  // queue without failing, refunding or spending an attempt.
  // -------------------------------------------------------------------------
  describe("private-plugin stage hand-off on SIGTERM", () => {
    afterEach(() => _resetWorkerDrainForTests())

    function scriptedJournal() {
      const ops: string[] = []
      const redis = {
        eval: vi.fn(async (_script: string, _keys: number, _key: string, op: string, token: string, fence: number | string) => {
          ops.push(op)
          if (op === "claim") {
            return JSON.stringify({ status: "claimed", checkpoint: null,
              lease: { token, fence: Number(fence) + 1, expiresAt: Date.now() + 60_000 } })
          }
          return "true"
        }),
      }
      return { journal: createStageJournal(redis, async () => {}), ops }
    }

    /** The plugin stage runner's shape: claim → invocation marker → paid work → complete → release. */
    async function runStage(journal: PluginStageToolkit, key: PluginStageKey,
      work: () => Promise<Record<string, unknown>>, handOffOnDrain: boolean) {
      const claim = await journal.claim(key, 60_000, handOffOnDrain ? { handOffOnDrain } : undefined)
      if (claim.status === "completed") return claim.output
      if (claim.status !== "claimed") throw new Error("busy")
      await journal.checkpoint(key, claim.lease, { invoked: true, receipt: null })
      const output = await work()
      await journal.complete(key, claim.lease, output)
      await journal.release(key, claim.lease)
      return output
    }

    /** A two-stage run whose loop wraps whatever a stage throws in its own run error. */
    function planThenReview(journal: PluginStageToolkit, hooks: {
      duringPlannerCall?: () => void; betweenStages?: () => void; handOffOnDrain?: boolean
    }) {
      const handOff = hooks.handOffOnDrain ?? true
      const jobId = randomUUID(), userId = randomUUID()
      const key = (stage: string): PluginStageKey =>
        ({ jobId, userId, attemptIndex: 0, stage, inputHash: "c".repeat(64), engineVersion: "1.0.0" })
      return async () => {
        try {
          await runStage(journal, key("planning"), async () => {
            hooks.duringPlannerCall?.()
            return { artifactId: "plan-1" }
          }, handOff)
          hooks.betweenStages?.()
          await runStage(journal, key("review"), async () => ({ artifactId: "review-1" }), handOff)
        } catch (error) {
          throw new Error("Scene processing did not complete", { cause: error })
        }
      }
    }

    function expectHandedBackUnfailed(job: ReturnType<typeof makeBullJob>) {
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1)
      expect(job.moveToDelayed.mock.calls[0][1]).toBe("lock-token")
      expect(mocks.mockRefundJobCredits).not.toHaveBeenCalled()
      expect(mocks.mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }))
    }

    it("SIGTERM during the in-flight paid call: the call completes its stage, the next stage is never opened, the job is handed back", async () => {
      mocks.mockIsFinalJobAttempt.mockReturnValue(true) // even on the final attempt
      const { journal, ops } = scriptedJournal()
      mocks.mockHandler.mockImplementationOnce(planThenReview(journal, { duringPlannerCall: beginWorkerDrain }))

      const job = makeBullJob("generate-image")
      await expect(processor(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)

      // The planner stage recorded its result through the drain; the review
      // stage left NOTHING in the journal for the successor to find ambiguous.
      expect(ops).toEqual(["claim", "checkpoint", "complete", "release"])
      expectHandedBackUnfailed(job)
    })

    it("SIGTERM at the boundary between two stages: handed back before the next stage opens", async () => {
      const { journal, ops } = scriptedJournal()
      mocks.mockHandler.mockImplementationOnce(planThenReview(journal, { betweenStages: beginWorkerDrain }))

      const job = makeBullJob("generate-image")
      await expect(processor(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)

      expect(ops).toEqual(["claim", "checkpoint", "complete", "release"])
      expectHandedBackUnfailed(job)
    })

    it("a plugin bundle's own copy of DrainAbortError (matched by name) is handed back too", async () => {
      const foreign = Object.assign(new Error("worker draining"), { name: "DrainAbortError" })
      mocks.mockHandler.mockRejectedValueOnce(new Error("Scene processing did not complete", { cause: foreign }))

      const job = makeBullJob("generate-image")
      await expect(processor(job, "lock-token")).rejects.toBeInstanceOf(DelayedError)
      expectHandedBackUnfailed(job)
    })

    it("control — a plugin that does not opt in keeps running its next stage through the drain (no change until it adopts the contract)", async () => {
      const { journal, ops } = scriptedJournal()
      mocks.mockHandler.mockImplementationOnce(planThenReview(journal,
        { duringPlannerCall: beginWorkerDrain, handOffOnDrain: false }))

      const job = makeBullJob("generate-image")
      await expect(processor(job, "lock-token")).resolves.toBeUndefined()

      expect(ops).toEqual(["claim", "checkpoint", "complete", "release", "claim", "checkpoint", "complete", "release"])
      expect(job.moveToDelayed).not.toHaveBeenCalled()
    })

    it("an ordinary failure during a drain is NOT mistaken for a hand-back", async () => {
      beginWorkerDrain()
      mocks.mockHandler.mockRejectedValueOnce(new Error("Scene processing did not complete", { cause: new Error("provider 503") }))

      const job = makeBullJob("generate-image")
      await expect(processor(job, "lock-token")).rejects.toThrow("Scene processing did not complete")
      expect(job.moveToDelayed).not.toHaveBeenCalled()
      expect(mocks.mockRefundJobCredits).toHaveBeenCalled()
    })
  })
})
