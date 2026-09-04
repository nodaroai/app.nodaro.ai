/**
 * Unit tests for processVideoDirectorJob (Task 5 — Unit D′ worker).
 *
 * Strategy: mock runVideoDirector + defaultDirectorDeps via vi.mock on the ee/
 * orchestrate module (intercepted as a dynamic import); mock supabase so we
 * can assert DB write shapes without network I/O.
 *
 * The test exercises the exported processVideoDirectorJob function directly
 * so we avoid creating real BullMQ Worker connections.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() so variables are available inside vi.mock() factories.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // ee/video-director/orchestrate mocks
  const mockRunVideoDirector = vi.fn()
  const mockDefaultDirectorDeps = vi.fn()

  // Supabase chain: from("jobs").update({...}).eq("id", jobId) for the progress
  // writes, and .eq("id").in("status",[...]).select("id") for markJobFailed's
  // CAS — the terminal write is no longer unguarded (it could trample a
  // cancelled row) and no longer local to this file.
  const mockCasSelect = vi.fn().mockResolvedValue({ data: [{ id: "job-abc-123" }], error: null })
  const mockCasIn = vi.fn().mockReturnValue({ select: mockCasSelect })
  const mockEqAfterUpdate = vi.fn().mockReturnValue(
    Object.assign(Promise.resolve({ data: null, error: null }), { in: mockCasIn }),
  )
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqAfterUpdate })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  // Reserve→commit/refund credit lifecycle helpers (jobId-keyed CAS-on-reserved).
  const mockCommit = vi.fn().mockResolvedValue(undefined)
  const mockRefund = vi.fn().mockResolvedValue(0)

  return {
    mockRunVideoDirector,
    mockDefaultDirectorDeps,
    mockFrom,
    mockUpdate,
    mockEqAfterUpdate,
    mockCasIn,
    mockCasSelect,
    mockMarkJobCompleted: vi.fn().mockResolvedValue(true),
    mockCommit,
    mockRefund,
  }
})

// Dynamic import inside processVideoDirectorJob resolves through vitest's
// module registry — vi.mock intercepts it by canonical path.
vi.mock("@/ee/video-director/orchestrate.js", () => ({
  runVideoDirector: mocks.mockRunVideoDirector,
  defaultDirectorDeps: mocks.mockDefaultDirectorDeps,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/config.js", () => ({
  config: { REDIS_URL: "redis://localhost:6379" },
  hasCredits: () => true,
}))

vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mocks.mockCommit,
  refundReservedCreditsForJob: mocks.mockRefund,
}))

// The completion funnel. Mocked (not exercised) for the same reason every other
// worker suite mocks it: workers/shared.ts pulls sharp + youtube-dl-exec +
// @remotion at its top. lib/job-failure.js is deliberately NOT mocked — it is
// dependency-light on purpose (spec D10) and its CAS write is what these tests
// assert, through the mocked supabase.
vi.mock("../shared.js", () => ({
  markJobCompleted: mocks.mockMarkJobCompleted,
}))

// Import AFTER mocks are registered
import { processVideoDirectorJob, type VideoDirectorJobPayload } from "../video-director-worker.js"

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const VIDEO_URL = "https://cdn.example.com/director-result.mp4"

const BASE_PAYLOAD: VideoDirectorJobPayload = {
  jobId: "job-abc-123",
  genre: "explainer",
  brief: "Nodaro helps teams ship AI videos faster.",
  userId: "user-xyz",
  tier: "pro",
}

/** Fake FastifyInstance — only passed to defaultDirectorDeps which is mocked. */
const FAKE_APP = {} as FastifyInstance

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("processVideoDirectorJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default deps returned by defaultDirectorDeps mock
    const mockDeps = {
      author: vi.fn(),
      createSpeechJob: vi.fn(),
      createAlignmentJob: vi.fn(),
      createRenderJob: vi.fn(),
      waitForJob: vi.fn(),
      onProgress: undefined,
    }
    mocks.mockDefaultDirectorDeps.mockReturnValue(mockDeps)

    // Default success result from runVideoDirector
    mocks.mockRunVideoDirector.mockResolvedValue({
      videoUrl: VIDEO_URL,
      planType: "shot-sequence",
    })
  })

  it("marks the job completed with videoUrl on successful runVideoDirector", async () => {
    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    // defaultDirectorDeps should have been called with the app instance
    expect(mocks.mockDefaultDirectorDeps).toHaveBeenCalledWith(FAKE_APP)

    // runVideoDirector should be called with correct opts
    expect(mocks.mockRunVideoDirector).toHaveBeenCalledOnce()
    const [opts] = mocks.mockRunVideoDirector.mock.calls[0]
    expect(opts.genre).toBe(BASE_PAYLOAD.genre)
    expect(opts.brief).toBe(BASE_PAYLOAD.brief)
    expect(opts.userId).toBe(BASE_PAYLOAD.userId)
    expect(opts.tier).toBe(BASE_PAYLOAD.tier)

    // The completion goes through the ONE completion funnel now (spec §5.3):
    // it was a bare, CAS-less `update({status:"completed"})` that could trample
    // a cancelled row, and — more to the point — it published a video the
    // result gate never saw.
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith(
      BASE_PAYLOAD.jobId,
      { output_data: { videoUrl: VIDEO_URL } },
    )
    // status/progress/completed_at are the funnel's own columns — this worker
    // must not re-declare them, and must not write "completed" itself.
    const allUpdateCalls = mocks.mockUpdate.mock.calls as Record<string, unknown>[][]
    expect(allUpdateCalls.find(([d]: Record<string, unknown>[]) => d.status === "completed")).toBeUndefined()
  })

  it("does NOT commit the authoring credit when the completion CAS did not flip the row", async () => {
    // false = the user cancelled mid-run, a terminal writer won, or (once a
    // policy is registered) the result gate blocked or held the video. In every
    // one of those the credits are somebody else's to settle.
    mocks.mockMarkJobCompleted.mockResolvedValueOnce(false)

    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    expect(mocks.mockCommit).not.toHaveBeenCalled()
    expect(mocks.mockRefund).not.toHaveBeenCalled()
  })

  it("marks the job failed with error_message when runVideoDirector throws", async () => {
    const errorMessage = "speech: ElevenLabs quota exceeded"
    mocks.mockRunVideoDirector.mockRejectedValue(new Error(errorMessage))

    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    // The final DB update should set status = "failed" with the error message
    const allUpdateCalls = mocks.mockUpdate.mock.calls as Record<string, unknown>[][]
    const failedCall = allUpdateCalls.find(
      ([data]: Record<string, unknown>[]) => data.status === "failed",
    )
    expect(failedCall).toBeDefined()
    const [failedData] = failedCall!
    expect(failedData.error_message).toBe(errorMessage)
    expect(failedData.completed_at).toBeDefined()
    // The CAS this write NEVER had (spec §9, a bug fix riding along): before the
    // consolidation it was `.update({status:"failed"}).eq("id", jobId)` with no
    // status predicate at all, so it could trample a `cancelled` row — and, once
    // the vocabulary widened, a `pending_review` one.
    expect(mocks.mockCasIn).toHaveBeenCalledWith("status", ["pending", "queued", "processing"])

    // Must NOT have set completed
    const completedCall = allUpdateCalls.find(
      ([data]: Record<string, unknown>[]) => data.status === "completed",
    )
    expect(completedCall).toBeUndefined()
  })

  it("sets status=processing at the start of the job", async () => {
    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    const allUpdateCalls = mocks.mockUpdate.mock.calls as Record<string, unknown>[][]
    const processingCall = allUpdateCalls.find(
      ([data]: Record<string, unknown>[]) => data.status === "processing",
    )
    expect(processingCall).toBeDefined()
    // The .eq("id", jobId) call should follow the update
    expect(mocks.mockEqAfterUpdate).toHaveBeenCalledWith("id", BASE_PAYLOAD.jobId)
  })

  it("threads onProgress through to runVideoDirector deps", async () => {
    // runVideoDirector captures the deps and calls onProgress
    let capturedOnProgress: ((step: string) => void) | undefined
    mocks.mockRunVideoDirector.mockImplementation(async (_opts: unknown, deps: { onProgress?: (step: string) => void }) => {
      capturedOnProgress = deps.onProgress
      deps.onProgress?.("authoring")
      deps.onProgress?.("speech")
      return { videoUrl: VIDEO_URL, planType: "shot-sequence" }
    })

    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    // onProgress was threaded through
    expect(capturedOnProgress).toBeDefined()

    // Each onProgress call should trigger a DB progress update
    const progressUpdateCalls = (mocks.mockUpdate.mock.calls as Record<string, unknown>[][]).filter(
      ([data]: Record<string, unknown>[]) => typeof data.progress === "number" && data.status === "processing" && !data.output_data,
    )
    // "authoring" and "speech" each trigger one progress DB write
    expect(progressUpdateCalls.length).toBeGreaterThanOrEqual(2)
  })

  it("commits the reserved authoring credits on success (and does NOT refund)", async () => {
    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    expect(mocks.mockCommit).toHaveBeenCalledWith(BASE_PAYLOAD.jobId)
    expect(mocks.mockRefund).not.toHaveBeenCalled()
  })

  it("refunds the reserved authoring credits on failure (and does NOT commit)", async () => {
    mocks.mockRunVideoDirector.mockRejectedValue(new Error("render: endpoint 503"))

    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    expect(mocks.mockRefund).toHaveBeenCalledWith(BASE_PAYLOAD.jobId)
    expect(mocks.mockCommit).not.toHaveBeenCalled()
  })

  // The ordering is load-bearing and invisible in the code's shape: a refactor
  // that "tidied" the refund to after the status write would strand the
  // authoring credit, because sweepStuckOrchestratorJobs only re-scans
  // 'processing' rows. Assert it explicitly so it cannot be inverted silently.
  it("on failure, refunds BEFORE the terminal status write — never after", async () => {
    const order: string[] = []
    mocks.mockRefund.mockImplementation(async () => {
      order.push("refund")
      return 0
    })
    mocks.mockUpdate.mockImplementation((data: Record<string, unknown>) => {
      if (data.status === "failed") order.push("failed-write")
      return { eq: mocks.mockEqAfterUpdate }
    })
    mocks.mockRunVideoDirector.mockRejectedValue(new Error("render: endpoint 503"))

    await processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)

    expect(order).toEqual(["refund", "failed-write"])
  })

  it("on failure, if the refund throws, leaves the job 'processing' for the reconcile sweep (no 'failed' write, no rethrow)", async () => {
    // Failure path: runVideoDirector throws so we enter the catch.
    mocks.mockRunVideoDirector.mockRejectedValue(new Error("resolve: scene overlap"))
    // The refund RPC then throws transiently. The reconcile sweep
    // (sweepStuckOrchestratorJobs) only re-scans 'processing' rows, so the
    // worker must settle credits BEFORE the terminal 'failed' write — otherwise
    // a refund failure after a 'failed' write strands the reserved authoring
    // credit with no backstop.
    mocks.mockRefund.mockRejectedValue(new Error("refund RPC transient error"))

    // Must not rethrow: with attempts=1 a throw is harmless, but rethrowing
    // would surface as a bullJob error and (if attempts were ever raised)
    // re-run the whole author→…→render chain and double-charge sub-jobs.
    await expect(processVideoDirectorJob(BASE_PAYLOAD, FAKE_APP)).resolves.toBeUndefined()

    // Refund WAS attempted...
    expect(mocks.mockRefund).toHaveBeenCalledWith(BASE_PAYLOAD.jobId)

    // ...but because it threw, the row is left 'processing' (no terminal
    // 'failed' write) so the reconcile sweep picks it up and retries the refund.
    const allUpdateCalls = mocks.mockUpdate.mock.calls as Record<string, unknown>[][]
    const failedCall = allUpdateCalls.find(
      ([data]: Record<string, unknown>[]) => data.status === "failed",
    )
    expect(failedCall).toBeUndefined()
  })
})
