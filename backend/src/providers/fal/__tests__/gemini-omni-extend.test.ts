import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// fal's Gemini Omni Flash 1.2 extend (decided 2026-11-17), through the real
// fal client against a stubbed `@fal-ai/client`: the request it submits (its
// four fields, nothing else, no reconcile hook), the URL it returns, and how a
// failure reaches the user — the model's 422 refusal of the clip as a final,
// refunded failure in our words, anything else as a retryable one, never
// fal's own text; a missing key as the shared missing-key sentence.
// ---------------------------------------------------------------------------

const { mockConfig, mockSubmit, mockStatus, mockResult, mockFire } = vi.hoisted(() => ({
  mockConfig: { FAL_KEY: "test-fal-key" },
  mockSubmit: vi.fn(),
  mockStatus: vi.fn(),
  mockResult: vi.fn(),
  mockFire: vi.fn(async () => {}),
}))

vi.mock("@/lib/config.js", () => ({ config: mockConfig }))
vi.mock("@fal-ai/client", () => ({
  fal: { config: vi.fn(), queue: { submit: mockSubmit, status: mockStatus, result: mockResult } },
}))
vi.mock("@/lib/reconcile/fire-on-task-created.js", () => ({ fireOnTaskCreated: mockFire }))

import { __resetFalConfiguredForTests } from "../client.js"
import {
  FAL_GEMINI_OMNI_EXTEND_ENDPOINT,
  GEMINI_OMNI_EXTEND_FAILED_MESSAGE,
  GEMINI_OMNI_EXTEND_REFUSED_MESSAGE,
  GEMINI_OMNI_EXTEND_REQUEST_REFUSED_MESSAGE,
  GEMINI_OMNI_EXTEND_STATUS_ERROR_RETRIES,
  falGeminiOmniExtend,
  geminiOmniExtendInput,
  isGeminiOmniExtendRefusal,
} from "../gemini-omni-extend.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { providerDetailOf } from "../../../lib/provider-error-detail.js"
import { falGeminiOmniExtendCostUsd } from "../pricing.js"

const REQ = { prompt: "she turns and runs", videoUrl: "https://scratch.example.com/tail.mp4", durationSec: 5, resolution: "1080p" }

/** fal's refusal of the clip, as its ApiError carries it. */
const refusal = () => Object.assign(new Error(""), {
  status: 422,
  body: { detail: [{ loc: ["body"], msg: "Could not generate a video with the given inputs", type: "invalid_request" }] },
})

beforeEach(() => {
  mockConfig.FAL_KEY = "test-fal-key"
  mockSubmit.mockReset().mockResolvedValue({ request_id: "req-1" })
  mockStatus.mockReset().mockResolvedValue({ status: "COMPLETED" })
  mockResult.mockReset().mockResolvedValue({ data: { video: { url: "https://fal.media/out.mp4", content_type: "video/mp4" } }, requestId: "req-1" })
  mockFire.mockReset()
  __resetFalConfiguredForTests()
})

describe("falGeminiOmniExtend — the request", () => {
  it("submits exactly prompt, video_url, duration and resolution to the extend endpoint", async () => {
    const out = await falGeminiOmniExtend(REQ)
    expect(mockSubmit).toHaveBeenCalledTimes(1)
    const [endpoint, { input }] = mockSubmit.mock.calls[0]!
    expect(endpoint).toBe("google/gemini-omni-flash/v1.2/extend")
    expect(endpoint).toBe(FAL_GEMINI_OMNI_EXTEND_ENDPOINT)
    expect(input).toEqual({ prompt: "she turns and runs", video_url: REQ.videoUrl, duration: 5, resolution: "1080p" })
    expect(Object.keys(input).sort()).toEqual(["duration", "prompt", "resolution", "video_url"])
    expect(out).toEqual({ videoUrl: "https://fal.media/out.mp4", requestId: "req-1" })
  })

  it("builds the body from the four fields alone, whatever else the caller holds", () => {
    const extra = { ...REQ, aspectRatio: "1:1", seed: 3, referenceImageUrls: ["x"] } as typeof REQ
    expect(geminiOmniExtendInput(extra)).toEqual({ prompt: REQ.prompt, video_url: REQ.videoUrl, duration: 5, resolution: "1080p" })
  })

  it("arms no reconcile hook: fal's clip is not the deliverable", async () => {
    await falGeminiOmniExtend(REQ)
    // fireOnTaskCreated is called with no options, so it persists nothing.
    expect((mockFire.mock.calls as unknown as unknown[][])[0]?.[0]).toBeUndefined()
  })
})

describe("falGeminiOmniExtend — failures", () => {
  it("the model's 422 refusal (thrown by result) is final and refunded, in our words, fal's text for the operator only", async () => {
    mockResult.mockRejectedValue(refusal())
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_REFUSED_MESSAGE)
    expect((err as Error).message).not.toMatch(/fal|422|invalid_request/i)
    expect(providerDetailOf(err)).toMatch(/Could not generate a video/)
  })

  it("the refusal surfaced as an ERROR status is the same failure", async () => {
    mockStatus.mockResolvedValue({ status: "ERROR", error: refusal() })
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_REFUSED_MESSAGE)
  })

  it("the refusal surfaced as an ERROR status carrying only its text is the same failure", async () => {
    mockStatus.mockResolvedValue({ status: "ERROR", error: "Could not generate a video with the given inputs" })
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_REFUSED_MESSAGE)
  })

  it("an ERROR status with other text is retried, in our words", async () => {
    mockStatus.mockResolvedValue({ status: "ERROR", error: "Internal server error" })
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_FAILED_MESSAGE)
  })

  it("the refusal thrown by submit itself, as a raw ApiError, is the same failure", async () => {
    mockSubmit.mockRejectedValue(refusal())
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("a 422 that names a field (the request's shape) is final too, in the request's words, never fal's", async () => {
    mockResult.mockRejectedValue(Object.assign(new Error(""), { status: 422, body: { detail: [{ loc: ["body", "duration"], msg: "Input should be less than or equal to 10", type: "less_than_equal" }] } }))
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_REQUEST_REFUSED_MESSAGE)
    expect(providerDetailOf(err)).toMatch(/less than or equal/)
  })

  it("a 422 answered to the submit itself (a field refused before anything is queued) is final too", async () => {
    mockSubmit.mockRejectedValue(Object.assign(new Error(""), { status: 422, body: { detail: [{ loc: ["body", "prompt"], msg: "String should have at least 1 character", type: "string_too_short" }] } }))
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_REQUEST_REFUSED_MESSAGE)
    expect((err as Error).message).not.toMatch(/at least 1 character/)
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it("a submit whose outcome is not known fails the attempt with no request id: retried, nothing kept", async () => {
    const { FalSubmitAmbiguousError } = await import("../client.js")
    mockSubmit.mockRejectedValue(new FalSubmitAmbiguousError("HTTP 502", 502))
    const onSubmitted = vi.fn(async () => {})
    const err = await falGeminiOmniExtend(REQ, { onSubmitted }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_FAILED_MESSAGE)
    expect((err as { requestEnded?: boolean }).requestEnded).toBe(false)
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it("a transient status read is tried again (bounded), then the request completes", async () => {
    mockStatus
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockRejectedValueOnce(Object.assign(new Error("bad gateway"), { status: 502 }))
      .mockResolvedValue({ status: "COMPLETED" })
    const out = await falGeminiOmniExtend(REQ, { pollIntervalMs: 0 })
    expect(out.videoUrl).toBe("https://fal.media/out.mp4")
    expect(mockSubmit).toHaveBeenCalledTimes(1)
  })

  it("status reads that keep failing give up after the bound, as a retryable failure", async () => {
    mockStatus.mockRejectedValue(new Error("socket hang up"))
    const err = await falGeminiOmniExtend(REQ, { pollIntervalMs: 0 }).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(mockStatus).toHaveBeenCalledTimes(GEMINI_OMNI_EXTEND_STATUS_ERROR_RETRIES + 1)
    // fal never answered: the request may still finish, so a retry keeps it.
    expect((err as { requestEnded?: boolean }).requestEnded).toBe(false)
  })

  it("marks a request fal answered as failed, and one it no longer knows, as ended; an unread result as not", async () => {
    mockStatus.mockResolvedValueOnce({ status: "FAILED", error: "model crashed" })
    expect(((await falGeminiOmniExtend(REQ, { pollIntervalMs: 0 }).catch((e: unknown) => e)) as { requestEnded?: boolean }).requestEnded).toBe(true)
    mockResult.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500, body: { detail: "Internal error" } }))
    expect(((await falGeminiOmniExtend(REQ, { pollIntervalMs: 0 }).catch((e: unknown) => e)) as { requestEnded?: boolean }).requestEnded).toBe(true)
    // A gateway in the way of the result says nothing of the request: kept.
    mockResult.mockRejectedValueOnce(Object.assign(new Error("bad gateway"), { status: 502 }))
    expect(((await falGeminiOmniExtend(REQ, { pollIntervalMs: 0 }).catch((e: unknown) => e)) as { requestEnded?: boolean }).requestEnded).toBe(false)
    mockResult.mockRejectedValueOnce(new Error("socket hang up"))
    expect(((await falGeminiOmniExtend(REQ, { pollIntervalMs: 0 }).catch((e: unknown) => e)) as { requestEnded?: boolean }).requestEnded).toBe(false)
    mockStatus.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }))
    expect(((await falGeminiOmniExtend(REQ, { resumeRequestId: "req-gone", pollIntervalMs: 0 }).catch((e: unknown) => e)) as { requestEnded?: boolean }).requestEnded).toBe(true)
  })

  it("a 500 is retried, in our words", async () => {
    mockResult.mockRejectedValue(Object.assign(new Error("boom"), { status: 500, body: { detail: "Internal error" } }))
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(false)
    expect((err as Error).message).toBe(GEMINI_OMNI_EXTEND_FAILED_MESSAGE)
  })

  it("no fal key: the missing-key sentence, naming FAL_KEY and not offering the nodaro.ai connection; nothing is submitted", async () => {
    mockConfig.FAL_KEY = ""
    const err = await falGeminiOmniExtend(REQ).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe("provider_key_missing")
    expect((err as Error).message).toMatch(/FAL_KEY/)
    expect((err as Error).message).toMatch(/not covered by the nodaro\.ai connection/)
    expect(mockSubmit).not.toHaveBeenCalled()
  })

  it("isGeminiOmniExtendRefusal reads a string detail too", () => {
    expect(isGeminiOmniExtendRefusal({ status: 422, body: { detail: "Could not generate a video with the given inputs" } })).toBe(true)
    expect(isGeminiOmniExtendRefusal({ status: 400, body: { detail: "Could not generate a video with the given inputs" } })).toBe(false)
    expect(isGeminiOmniExtendRefusal(new Error("Could not generate a video with the given inputs"))).toBe(false)
  })
})

// Decided 2026-11-17: a retry of the job resumes the request it submitted.
describe("falGeminiOmniExtend — resuming a submitted request", () => {
  it("tells the caller the new request's id right after submit", async () => {
    const onSubmitted = vi.fn(async () => {})
    await falGeminiOmniExtend(REQ, { onSubmitted })
    expect(onSubmitted).toHaveBeenCalledWith("req-1")
    expect(onSubmitted.mock.invocationCallOrder[0]).toBeLessThan(mockStatus.mock.invocationCallOrder[0]!)
  })

  it("with a request to resume, polls and fetches it and submits nothing", async () => {
    const onSubmitted = vi.fn(async () => {})
    const out = await falGeminiOmniExtend(REQ, { resumeRequestId: "req-9", onSubmitted })
    expect(mockSubmit).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(mockStatus.mock.calls[0]![1]).toEqual({ requestId: "req-9" })
    expect(mockResult.mock.calls[0]![1]).toEqual({ requestId: "req-9" })
    expect(out.requestId).toBe("req-9")
  })
})

describe("falGeminiOmniExtendCostUsd — the measured bill", () => {
  it("matches the two measured runs (4.06 s sent + 3 s at 360p: 4.514 units; at 720p: 10.651; one unit $0.0273)", () => {
    const unit = 0.0273
    expect(falGeminiOmniExtendCostUsd({ resolution: "360p", sentSec: 4.06, addedSec: 3 })! / unit).toBeCloseTo(4.514, 2)
    expect(falGeminiOmniExtendCostUsd({ resolution: "720p", sentSec: 4.06, addedSec: 3 })! / unit).toBeCloseTo(10.651, 2)
  })

  it("is never below the measured bills: 1080p and 4K (not measured) take 720p's thinking allowance", () => {
    const thinking = (res: string) => falGeminiOmniExtendCostUsd({ resolution: res, sentSec: 0, addedSec: 0 })!
    expect(thinking("1080p")).toBe(thinking("720p"))
    expect(thinking("4k")).toBe(thinking("720p"))
    expect(thinking("720p")).toBeGreaterThan(thinking("360p"))
  })

  it("is null for a resolution it does not render", () => {
    expect(falGeminiOmniExtendCostUsd({ resolution: "480p", sentSec: 10, addedSec: 5 })).toBeNull()
  })
})
