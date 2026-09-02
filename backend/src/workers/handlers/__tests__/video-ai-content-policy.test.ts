import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock(). Mirrors the
// baseline mock set from video-ai.test.ts's "text-to-video handler" describe
// block (proven to import video-ai.ts safely), plus a new llm-client mock for
// the content-policy rewrite path (Task A2). `KieError` itself is imported
// REAL (unmocked) below — the handler's `err instanceof KieError` check
// needs the actual class, and content-policy-rewrite.ts's guard logic
// (length/unchanged-output checks) also runs for real: only the LLM call
// boundary (`llmCompleteStructured`) is mocked, so these tests exercise the
// real handler + real rewrite-helper flow end-to-end, not a mock echo.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockTextToVideo = vi.fn()
  const mockImageToVideo = vi.fn()
  const mockVideoToVideo = vi.fn()
  const mockLipSync = vi.fn()
  const mockLipSyncVideo = vi.fn()
  const mockMotionTransfer = vi.fn()
  const mockVideoUpscale = vi.fn()
  const mockFalLipSync = vi.fn()
  const mockSpeechToVideo = vi.fn()

  const mockUploadToR2 = vi.fn().mockResolvedValue("https://r2.example.com/videos/raw.mp4")
  const mockMergeVideoAudio = vi.fn().mockResolvedValue("/tmp/workdir/merged.mp4")
  const mockCleanupWorkDir = vi.fn().mockResolvedValue(undefined)

  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockWatermarkLocalVideoAndUpload = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1-merged.mp4")
  const mockGenerateAndUploadThumbnail = vi.fn().mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  const mockSetJobProgress = vi.fn(async () => {})

  const mockLlmCompleteStructured = vi.fn()

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockTextToVideo,
    mockImageToVideo,
    mockVideoToVideo,
    mockLipSync,
    mockLipSyncVideo,
    mockMotionTransfer,
    mockVideoUpscale,
    mockFalLipSync,
    mockSpeechToVideo,
    mockUploadToR2,
    mockMergeVideoAudio,
    mockCleanupWorkDir,
    mockCommitJobCredits,
    mockMarkJobCompleted,
    mockFinalizeJobWithMedia,
    mockUploadVideoMaybeWatermark,
    mockWatermarkLocalVideoAndUpload,
    mockGenerateAndUploadThumbnail,
    mockSetJobProgress,
    mockLlmCompleteStructured,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.mockUploadToR2,
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: mocks.mockTextToVideo,
  videoToVideo: mocks.mockVideoToVideo,
  lipSync: mocks.mockLipSync,
  lipSyncVideo: mocks.mockLipSyncVideo,
  motionTransfer: mocks.mockMotionTransfer,
  videoUpscale: mocks.mockVideoUpscale,
}))

vi.mock("../../../providers/fal/lip-sync.js", () => ({
  falLipSync: mocks.mockFalLipSync,
}))

vi.mock("@/providers/video/merge-video-audio.js", () => ({
  mergeVideoAudio: mocks.mockMergeVideoAudio,
}))

vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: mocks.mockCommitJobCredits,
    markJobCompleted: mocks.mockMarkJobCompleted,
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: mocks.mockSetJobProgress,
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  }
})

vi.mock("@/providers/kie/video.js", () => ({
  KieVideoProvider: class {
    speechToVideo = mocks.mockSpeechToVideo
  },
}))

vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))

// The LLM boundary: content-policy-rewrite.ts's rewriteForContentPolicy is
// NOT mocked (its real length/unchanged-output guard runs) — only the
// underlying llmCompleteStructured call is, so a too-short/rejected mock
// response exercises the real guard rather than asserting a canned return.
vi.mock("../../../lib/llm-client.js", () => ({
  llmCompleteStructured: mocks.mockLlmCompleteStructured,
}))

// ---------------------------------------------------------------------------
// Import module under test (real KieError — the handler's `instanceof` check
// needs the actual class, not a mock).
// ---------------------------------------------------------------------------

import { videoAIHandlers } from "../video-ai.js"
import { KieError, CONTENT_POLICY_MESSAGE, createUpstreamFailureError } from "../../../providers/kie/client.js"
import { UNCLASSIFIED_MODERATION_MESSAGES } from "../../../providers/kie/__tests__/__fixtures__/log-pull-fail-messages.js"

const handler = videoAIHandlers["text-to-video"]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "text-to-video",
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "usage-1",
    shouldWatermark: false,
    ...overrides,
  }
}

const VIDEO_RESULT = {
  url: "https://provider.example.com/video.mp4",
  providerUsed: "minimax",
  cost: 0.4,
  displayCost: 0.5,
}

const ORIGINAL_PROMPT = "A red sports car drifting through a neon-lit futuristic city at night."
const REWRITTEN_PROMPT = "A red sports car drifting through a generic, brightly lit futuristic city street at night."

/** A COPYRIGHT-classified terminal block — the one class the rewriter can
 *  help. The class is now passed explicitly: production never produces
 *  `contentPolicy: true` with a null class (createUpstreamFailureError always
 *  classifies), and the rewrite gate is an allow-list on the class (M-19b), so
 *  a classless fixture would no longer describe anything reachable. Its
 *  internalDetails is copyright text, which is exactly what the real
 *  classifier would tag "copyright". */
function makePolicyError(message = CONTENT_POLICY_MESSAGE): KieError {
  return new KieError(
    message,
    "task failed: [500] may be related to copyright restrictions",
    "Generation",
    true,
    true,
    "copyright",
  )
}

function makeNonPolicyError(): KieError {
  return new KieError("Generation failed, please try again.", "task failed: [500] internal error", "Generation", true, false)
}

/** Same terminal content block as makePolicyError, but tagged `likeness` (the
 *  class is passed explicitly — this fixture is not re-classified from its
 *  `internalDetails`). The rewrite prompt is copyright-aware only, so asking it
 *  to fix a real-person-likeness block is a no-op that burns an LLM call and a
 *  paid retry; video-ai.ts's guard throws these straight through. */
function makeLikenessError(): KieError {
  return new KieError(
    CONTENT_POLICY_MESSAGE,
    "task failed: [500] may be related to copyright restrictions",
    "Generation",
    true,
    true,
    "likeness",
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // mockClear() (inside clearAllMocks) does NOT drain a pending
  // mockRejectedValueOnce/mockResolvedValueOnce queue — if a test fails
  // before consuming every queued "once" value (e.g. an early throw), the
  // leftover would silently bleed into the next test's first call. These two
  // mocks are the ones every test queues with `.Once` chains, so reset them
  // fully (not just clear) to guarantee a blank queue each test.
  mocks.mockTextToVideo.mockReset()
  mocks.mockLlmCompleteStructured.mockReset()
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/thumbnails/job-1.png")
  mocks.mockMarkJobCompleted.mockResolvedValue(true)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
})

// ---------------------------------------------------------------------------
// text-to-video — content-policy rewrite-once (Task A2)
// ---------------------------------------------------------------------------

describe("text-to-video handler — content-policy rewrite-once", () => {
  it("flagged error: rewrites once, retries once with the rewritten prompt, and discloses it on the persisted output", async () => {
    const policyError = makePolicyError()
    mocks.mockTextToVideo
      .mockRejectedValueOnce(policyError)
      .mockResolvedValueOnce(VIDEO_RESULT)
    mocks.mockLlmCompleteStructured.mockResolvedValue({
      output: { rewrittenPrompt: REWRITTEN_PROMPT },
      inputTokens: 20,
      outputTokens: 20,
    })

    const job = makeJob({ prompt: ORIGINAL_PROMPT })
    await handler(job as never, makeCtx())

    // Exactly one retry — the original call plus one rewritten resubmit.
    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(2)
    expect(mocks.mockTextToVideo.mock.calls[0][0]).toBe(ORIGINAL_PROMPT)
    expect(mocks.mockTextToVideo.mock.calls[1][0]).toBe(REWRITTEN_PROMPT)
    // The options object (5th positional arg) is the SAME reference on both
    // calls — proves it was extracted to a shared const, not hand-duplicated.
    expect(mocks.mockTextToVideo.mock.calls[0][4]).toBe(mocks.mockTextToVideo.mock.calls[1][4])

    // Exactly one rewrite call, with the app's model/temperature/schema contract.
    expect(mocks.mockLlmCompleteStructured).toHaveBeenCalledTimes(1)
    const [req, , opts] = mocks.mockLlmCompleteStructured.mock.calls[0]
    expect(req).toEqual(
      expect.objectContaining({
        modelId: "gemini-3.6-flash",
        system: expect.stringContaining("Keep every Element block"),
        temperature: 0,
        maxTokens: 4096,
        timeoutMs: 60_000,
      }),
    )
    expect(opts).toEqual({ schemaName: "content_policy_rewrite", maxRetries: 1 })

    // Disclosure lands as a top-level field beside the video url.
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: "text-to-video",
        extraOutputData: expect.objectContaining({
          contentPolicyRewrite: { original: ORIGINAL_PROMPT, rewritten: REWRITTEN_PROMPT },
        }),
      }),
    )
  })

  it("second flagged failure: rethrows without a third textToVideo call", async () => {
    const policyError = makePolicyError()
    // Both attempts hit the same deterministic content screen.
    mocks.mockTextToVideo.mockRejectedValue(policyError)
    mocks.mockLlmCompleteStructured.mockResolvedValue({
      output: { rewrittenPrompt: REWRITTEN_PROMPT },
      inputTokens: 20,
      outputTokens: 20,
    })

    const job = makeJob({ prompt: ORIGINAL_PROMPT })
    await expect(handler(job as never, makeCtx())).rejects.toBe(policyError)

    // One retry attempted, no further (third) resubmit.
    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(2)
    expect(mocks.mockLlmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("non-policy KieError: rethrows immediately, no rewrite attempted", async () => {
    const nonPolicyError = makeNonPolicyError()
    mocks.mockTextToVideo.mockRejectedValueOnce(nonPolicyError)

    const job = makeJob({ prompt: ORIGINAL_PROMPT })
    await expect(handler(job as never, makeCtx())).rejects.toBe(nonPolicyError)

    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockLlmCompleteStructured).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("likeness-classified policy KieError: rethrows immediately, no rewrite attempted", async () => {
    const likenessError = makeLikenessError()
    // The fixture proves itself: `contentPolicy` IS true, so the boolean half of
    // the guard would let this through to the rewrite — only the class stops it.
    expect(likenessError.contentPolicy).toBe(true)
    expect(likenessError.contentPolicyClass).toBe("likeness")
    mocks.mockTextToVideo.mockRejectedValueOnce(likenessError)

    const job = makeJob({ prompt: ORIGINAL_PROMPT })
    await expect(handler(job as never, makeCtx())).rejects.toBe(likenessError)

    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
    // rewriteForContentPolicy is REAL in this file (only its llmCompleteStructured
    // boundary is mocked), so "the LLM was never called" IS "never rewritten".
    expect(mocks.mockLlmCompleteStructured).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("safety-classified policy KieError: rethrows immediately, no rewrite attempted (M-19b)", async () => {
    // Built through the REAL classifier from a verbatim log-pull failMsg, so
    // this test fails if EITHER half regresses: the moderation-vocabulary
    // widening (the class must come out "safety") or the allow-list gate (a
    // safety block must never reach the copyright-only rewriter).
    vi.spyOn(console, "error").mockImplementation(() => {})
    const safetyError = createUpstreamFailureError(
      `task failed: [400] ${UNCLASSIFIED_MODERATION_MESSAGES[0].failMsg}`,
      "Generation",
    )
    expect(safetyError.contentPolicy).toBe(true)
    expect(safetyError.contentPolicyClass).toBe("safety")
    mocks.mockTextToVideo.mockRejectedValueOnce(safetyError)

    const job = makeJob({ prompt: ORIGINAL_PROMPT })
    await expect(handler(job as never, makeCtx())).rejects.toBe(safetyError)

    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockLlmCompleteStructured).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })

  it("the copyright rewrite gate fires only for contentPolicyClass 'copyright'", async () => {
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../video-ai.ts", import.meta.url), "utf8"),
    )
    expect(src).toMatch(/err\.contentPolicyClass\s*!==\s*"copyright"/)
    // The old deny-list shape must be gone, not merely supplemented.
    expect(src).not.toMatch(/contentPolicyClass\s*===\s*"likeness"/)
  })

  it("null rewrite (guard rejects a too-short output): rethrows the original error, no second textToVideo call", async () => {
    const policyError = makePolicyError()
    mocks.mockTextToVideo.mockRejectedValueOnce(policyError)
    // Real rewriteForContentPolicy guard: output.length must be >= 40 chars.
    // This is deliberately too short so the REAL guard (not a mock) returns
    // null — exercising rewriteForContentPolicy's own logic end-to-end.
    mocks.mockLlmCompleteStructured.mockResolvedValue({
      output: { rewrittenPrompt: "too short" },
      inputTokens: 5,
      outputTokens: 5,
    })

    const job = makeJob({ prompt: ORIGINAL_PROMPT })
    await expect(handler(job as never, makeCtx())).rejects.toBe(policyError)

    expect(mocks.mockTextToVideo).toHaveBeenCalledTimes(1)
    expect(mocks.mockLlmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
