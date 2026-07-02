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

  // Supabase chain: from("jobs").update({...}).eq("id", jobId)
  // The update chain terminates at .eq() which returns a Promise.
  const mockEqAfterUpdate = vi.fn().mockResolvedValue({ data: null, error: null })
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

    // The final DB update should set status = "completed" with videoUrl
    const allUpdateCalls = mocks.mockUpdate.mock.calls as Record<string, unknown>[][]
    const completedCall = allUpdateCalls.find(
      ([data]: Record<string, unknown>[]) => data.status === "completed",
    )
    expect(completedCall).toBeDefined()
    const [completedData] = completedCall!
    expect(completedData.progress).toBe(100)
    expect((completedData.output_data as Record<string, unknown>).videoUrl).toBe(VIDEO_URL)
    expect(completedData.completed_at).toBeDefined()
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
