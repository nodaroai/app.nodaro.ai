/**
 * L2#2 — Credit refund path tests.
 *
 * Two refund pathways with subtle correctness rules. Bugs here cost real
 * money — either the user is overcharged (refund didn't fire) or
 * undercharged (we refunded when we shouldn't have).
 *
 *   1. `refundJobCredits` — fires on job failure. SKIPS the refund when
 *      the error is a post-processing failure (provider already charged
 *      us, so we keep the user's credits to cover that cost).
 *
 *   2. `refundLoopTrimAddon` — fires when the smart-loop-cut post-process
 *      failed but the underlying i2v generation succeeded. Refunds ONLY
 *      the addon (not the base i2v cost) so the user keeps the un-trimmed
 *      clip without paying for the trim attempt.
 *
 * Both functions are non-fatal: a refund failure must NOT propagate up
 * and fail the worker job — better to have a credit accounting hiccup
 * than a stuck job.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted: mocks need to live before imports
const { hasCreditsState, supabaseMock, refundCreditsSpy, commitCreditsSpy } = vi.hoisted(() => ({
  hasCreditsState: { enabled: true },
  supabaseMock: { from: vi.fn() },
  refundCreditsSpy: vi.fn(),
  commitCreditsSpy: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: supabaseMock }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))
vi.mock("@/lib/config.js", async () => {
  const actual = await vi.importActual<typeof import("@/lib/config.js")>("@/lib/config.js")
  return {
    ...actual,
    hasCredits: () => hasCreditsState.enabled,
  }
})
// CreditsService is dynamic-imported by both refund functions
vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: {
    refundCredits: refundCreditsSpy,
    commitCredits: commitCreditsSpy,
  },
}))

import { refundJobCredits, refundLoopTrimAddon, isFinalJobAttempt } from "../shared.js"
import { PostProcessingError, isPostProcessingError, runPostProcessing } from "../../lib/post-processing-error.js"

// Minimal BullMQ Job shape for isFinalJobAttempt.
function fakeJob(attemptsMade: number, attempts?: number) {
  return { attemptsMade, opts: { attempts } } as unknown as Parameters<typeof isFinalJobAttempt>[0]
}

beforeEach(() => {
  hasCreditsState.enabled = true
  supabaseMock.from.mockReset()
  refundCreditsSpy.mockReset()
  commitCreditsSpy.mockReset()
})

// ---------------------------------------------------------------------------
// refundJobCredits — full job refund on failure
// ---------------------------------------------------------------------------

describe("refundJobCredits", () => {
  it("no-ops when hasCredits() is false (self-hosted edition)", async () => {
    hasCreditsState.enabled = false
    await refundJobCredits("usage-1", "job-1", new Error("any error"))
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when usageLogId is null (no reservation existed)", async () => {
    await refundJobCredits(null, "job-1", new Error("any error"))
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when usageLogId is undefined", async () => {
    await refundJobCredits(undefined, "job-1", new Error("any error"))
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("calls CreditsService.refundCredits for a generic (plain Error) failure", async () => {
    refundCreditsSpy.mockResolvedValueOnce(undefined)
    await refundJobCredits("usage-1", "job-1", new Error("Some generic provider error"))
    expect(refundCreditsSpy).toHaveBeenCalledTimes(1)
    expect(refundCreditsSpy).toHaveBeenCalledWith("usage-1")
  })

  // ── SAFE DIRECTION: every PRE-provider failure must REFUND. These are the
  // ACTUAL strings thrown by real code paths BEFORE/at the provider call. The
  // old substring guard wrongly skipped some of these ("Failed to download
  // image" is thrown by KIE input download — pre-provider) which would CHARGE
  // a user for a job the provider never did. With the typed-signal guard, a
  // plain Error always refunds regardless of message.
  it.each([
    // input download (kie/image.ts:61 — downloads the INPUT image before the call)
    "Failed to download image: 404",
    // input download (kie/video.ts — input image before i2v)
    "Failed to download image: HTTP 500",
    // createTask / provider rejection
    "KIE createTask failed: invalid params",
    // content moderation / NSFW
    "Content flagged as NSFW by provider",
    // validation
    "edit-image requires imageUrl",
    // timeout before result
    "Provider timed out after 600000ms",
    // generic unreachable
    "provider unreachable",
    // even a message that looks like an upload error but is a PLAIN error
    // (e.g. uploading the INPUT cover-src for suno-cover, pre-provider) refunds
    "Failed to download: https://example.com/input.mp4 (403)",
  ])('REFUNDS for pre-provider plain Error: "%s"', async (errorMessage) => {
    refundCreditsSpy.mockResolvedValueOnce(undefined)
    await refundJobCredits("usage-1", "job-1", new Error(errorMessage))
    expect(refundCreditsSpy).toHaveBeenCalledTimes(1)
    expect(refundCreditsSpy).toHaveBeenCalledWith("usage-1")
  })

  // ── REVENUE: a PostProcessingError means the provider already delivered (we
  // were billed), so SKIP the refund. The message is irrelevant — the TYPE is
  // the signal. These wrap the REAL post-provider thrown strings.
  it.each([
    new PostProcessingError("ffmpeg failed: Conversion failed!"), // watermark/transcode/strip/loop-cut
    new PostProcessingError("FFmpeg merge failed"),               // mergeVideoAudio
    new PostProcessingError("Failed to download: https://r2/result.mp4 (500)"), // result re-download
    new PostProcessingError("Access Denied"),                     // raw AWS SDK R2 upload error
    new PostProcessingError("socket hang up"),                    // raw AWS SDK R2 upload error
  ])("SKIPS refund for PostProcessingError: %s", async (err) => {
    await refundJobCredits("usage-1", "job-1", err)
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("SKIPS refund when the error carries the postProcessing marker but lost its prototype", async () => {
    // Simulate a re-thrown/wrapped error that kept own-props but not its class.
    const wrapped = Object.assign(new Error("ffmpeg failed: x"), { postProcessing: true })
    await refundJobCredits("usage-1", "job-1", wrapped)
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("swallows errors from CreditsService — refund failure must not throw", async () => {
    refundCreditsSpy.mockRejectedValueOnce(new Error("supabase down"))
    await expect(
      refundJobCredits("usage-1", "job-1", new Error("provider unreachable")),
    ).resolves.not.toThrow()
  })

  it("REFUNDS when passed undefined (no signal → safe default)", async () => {
    refundCreditsSpy.mockResolvedValueOnce(undefined)
    await refundJobCredits("usage-1", "job-1", undefined)
    expect(refundCreditsSpy).toHaveBeenCalledTimes(1)
  })

  // Backward-compat: legacy string call sites (render-worker "cancelled",
  // node-executor cancel reason) pass a string — must still REFUND (these are
  // all pre-delivery / cancellation paths).
  it.each(["cancelled", "node timed out", "execution aborted"])(
    'REFUNDS for legacy string reason: "%s"',
    async (reason) => {
      refundCreditsSpy.mockResolvedValueOnce(undefined)
      await refundJobCredits("usage-1", "job-1", reason)
      expect(refundCreditsSpy).toHaveBeenCalledTimes(1)
    },
  )
})

// ---------------------------------------------------------------------------
// PostProcessingError signal — unit coverage for the classifier + wrapper.
// ---------------------------------------------------------------------------

describe("isPostProcessingError", () => {
  it("true for a PostProcessingError instance", () => {
    expect(isPostProcessingError(new PostProcessingError("x"))).toBe(true)
  })
  it("true for an error carrying postProcessing=true (prototype lost)", () => {
    expect(isPostProcessingError(Object.assign(new Error("x"), { postProcessing: true }))).toBe(true)
  })
  it("false for a plain Error (pre-provider → refund)", () => {
    expect(isPostProcessingError(new Error("Failed to download image: 404"))).toBe(false)
  })
  it("false for a string", () => {
    expect(isPostProcessingError("ffmpeg failed: x")).toBe(false)
  })
  it("false for undefined/null", () => {
    expect(isPostProcessingError(undefined)).toBe(false)
    expect(isPostProcessingError(null)).toBe(false)
  })
})

describe("runPostProcessing", () => {
  it("passes through the resolved value on success", async () => {
    await expect(runPostProcessing(async () => "ok")).resolves.toBe("ok")
  })

  it("re-tags a plain Error (real ffmpeg string) as PostProcessingError, preserving message + cause", async () => {
    const original = new Error("ffmpeg failed: Conversion failed!")
    const caught = await runPostProcessing(async () => {
      throw original
    }).catch((e) => e)
    expect(caught).toBeInstanceOf(PostProcessingError)
    expect(isPostProcessingError(caught)).toBe(true)
    expect((caught as Error).message).toBe("ffmpeg failed: Conversion failed!")
    expect((caught as Error & { cause?: unknown }).cause).toBe(original)
  })

  it("re-tags a raw AWS SDK-style error string", async () => {
    const caught = await runPostProcessing(async () => {
      throw new Error("Access Denied")
    }).catch((e) => e)
    expect(isPostProcessingError(caught)).toBe(true)
  })

  it("does NOT double-wrap an already-PostProcessingError", async () => {
    const inner = new PostProcessingError("FFmpeg merge failed")
    const caught = await runPostProcessing(async () => {
      throw inner
    }).catch((e) => e)
    expect(caught).toBe(inner) // same instance, no nesting
  })
})

// ---------------------------------------------------------------------------
// refundLoopTrimAddon — partial refund when smart-loop-cut fails
// ---------------------------------------------------------------------------

/**
 * Build a usage_logs row for the supabase mock to return on .single().
 */
function mockUsageLog(reservedCredits: number, metadata: Record<string, unknown> = {}) {
  // Build the chained `.from().select().eq().single()` mock for the read.
  const singleMock = vi.fn().mockResolvedValue({
    data: { credits_used: reservedCredits, metadata },
    error: null,
  })
  const eqMock = vi.fn().mockReturnValue({ single: singleMock })
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
  // Build the chained `.from().update().eq()` mock for the writes.
  const updateEqMock = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock })
  // The .from(table) returns different chains per table — easier to just
  // return both methods on every call.
  supabaseMock.from.mockImplementation(() => ({
    select: selectMock,
    update: updateMock,
  }))
}

describe("refundLoopTrimAddon", () => {
  it("no-ops when hasCredits() is false", async () => {
    hasCreditsState.enabled = false
    await refundLoopTrimAddon("job-1", "usage-1", 5)
    expect(commitCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when usageLogId is null", async () => {
    await refundLoopTrimAddon("job-1", null, 5)
    expect(commitCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when addonCredits is 0 (nothing to refund)", async () => {
    await refundLoopTrimAddon("job-1", "usage-1", 0)
    expect(commitCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when addonCredits is negative (defensive)", async () => {
    await refundLoopTrimAddon("job-1", "usage-1", -3)
    expect(commitCreditsSpy).not.toHaveBeenCalled()
  })

  it("commits actual = reserved - addonCredits (e.g., 25 - 5 = 20)", async () => {
    mockUsageLog(25)
    await refundLoopTrimAddon("job-1", "usage-1", 5)
    expect(commitCreditsSpy).toHaveBeenCalledTimes(1)
    expect(commitCreditsSpy).toHaveBeenCalledWith("usage-1", 20)
  })

  it("clamps actual to >= 0 when addonCredits exceeds reserved", async () => {
    mockUsageLog(2)
    await refundLoopTrimAddon("job-1", "usage-1", 5) // 2 - 5 = -3 → clamp to 0
    expect(commitCreditsSpy).toHaveBeenCalledWith("usage-1", 0)
  })

  it("stamps usage_logs.metadata.loop_trim_refunded = true", async () => {
    mockUsageLog(25, { existing_field: "preserved" })
    await refundLoopTrimAddon("job-1", "usage-1", 5)
    // The .update() mock was called with the merged metadata object.
    const updateCalls = supabaseMock.from.mock.results
      .map((r) => r.value)
      .flatMap((tableObj) => (tableObj.update as ReturnType<typeof vi.fn>).mock.calls)
    const usageLogUpdate = updateCalls.find(
      (call) => (call[0] as Record<string, unknown>).metadata !== undefined,
    )
    expect(usageLogUpdate, "expected an update with a metadata field").toBeDefined()
    const metadata = (usageLogUpdate![0] as Record<string, unknown>).metadata as Record<string, unknown>
    expect(metadata.loop_trim_refunded).toBe(true)
    expect(metadata.existing_field, "existing metadata fields preserved").toBe("preserved")
  })

  it("when usage_log read fails, returns silently (logs error, no commit)", async () => {
    // Read returns no data + error
    const singleMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    })
    const eqMock = vi.fn().mockReturnValue({ single: singleMock })
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock })
    supabaseMock.from.mockReturnValue({ select: selectMock, update: vi.fn() })
    await expect(refundLoopTrimAddon("job-1", "usage-1", 5)).resolves.not.toThrow()
    expect(commitCreditsSpy).not.toHaveBeenCalled()
  })

  it("swallows errors from CreditsService.commitCredits — non-fatal", async () => {
    mockUsageLog(25)
    commitCreditsSpy.mockRejectedValueOnce(new Error("commit failed"))
    await expect(refundLoopTrimAddon("job-1", "usage-1", 5)).resolves.not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// isFinalJobAttempt — gate that prevents refunding (and thus free generations)
// on a non-final BullMQ attempt. Must be the exact inverse of BullMQ's
// shouldRetryJob: retry iff attemptsMade + 1 < opts.attempts.
// ---------------------------------------------------------------------------

describe("isFinalJobAttempt", () => {
  it("video queue (attempts:3): only the 3rd processing (attemptsMade=2) is final", () => {
    // attemptsMade is 0 during the first processing in BullMQ v5.
    expect(isFinalJobAttempt(fakeJob(0, 3))).toBe(false) // 1st run → will retry
    expect(isFinalJobAttempt(fakeJob(1, 3))).toBe(false) // 2nd run → will retry
    expect(isFinalJobAttempt(fakeJob(2, 3))).toBe(true)  // 3rd run → terminal
  })

  it("render queue (attempts:4): only the 4th processing (attemptsMade=3) is final", () => {
    expect(isFinalJobAttempt(fakeJob(0, 4))).toBe(false)
    expect(isFinalJobAttempt(fakeJob(1, 4))).toBe(false)
    expect(isFinalJobAttempt(fakeJob(2, 4))).toBe(false)
    expect(isFinalJobAttempt(fakeJob(3, 4))).toBe(true)
  })

  it("treats missing opts.attempts as 1 (single attempt → always final)", () => {
    expect(isFinalJobAttempt(fakeJob(0, undefined))).toBe(true)
  })

  it("attempts:1 → the only attempt is final", () => {
    expect(isFinalJobAttempt(fakeJob(0, 1))).toBe(true)
  })
})
