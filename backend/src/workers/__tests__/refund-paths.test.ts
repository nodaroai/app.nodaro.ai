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

import { refundJobCredits, refundLoopTrimAddon } from "../shared.js"

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
    await refundJobCredits("usage-1", "job-1", "any error")
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when usageLogId is null (no reservation existed)", async () => {
    await refundJobCredits(null, "job-1", "any error")
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("no-ops when usageLogId is undefined", async () => {
    await refundJobCredits(undefined, "job-1", "any error")
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("calls CreditsService.refundCredits for a generic failure", async () => {
    refundCreditsSpy.mockResolvedValueOnce(undefined)
    await refundJobCredits("usage-1", "job-1", "Some generic provider error")
    expect(refundCreditsSpy).toHaveBeenCalledTimes(1)
    expect(refundCreditsSpy).toHaveBeenCalledWith("usage-1")
  })

  // Post-processing failure patterns: the provider already charged us, so
  // keep the user's credits to cover the upstream cost.
  it.each([
    "failed to upload to R2 bucket",
    "upload to R2 timed out",
    "R2 upload returned 500",
    "Failed to download image from R2",
    "Failed to download video from upstream",
    "Watermark failed during compositing",
    "Transcode failed at frame 100",
    "ffmpeg failed after producing output",
  ])('skips refund for post-processing failure: "%s"', async (errorMessage) => {
    await refundJobCredits("usage-1", "job-1", errorMessage)
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("error message matching is case-insensitive", async () => {
    await refundJobCredits("usage-1", "job-1", "FAILED TO UPLOAD to r2 bucket")
    expect(refundCreditsSpy).not.toHaveBeenCalled()
  })

  it("swallows errors from CreditsService — refund failure must not throw", async () => {
    refundCreditsSpy.mockRejectedValueOnce(new Error("supabase down"))
    await expect(
      refundJobCredits("usage-1", "job-1", "provider unreachable"),
    ).resolves.not.toThrow()
  })

  it("handles undefined errorMessage without crashing on .toLowerCase()", async () => {
    refundCreditsSpy.mockResolvedValueOnce(undefined)
    await refundJobCredits("usage-1", "job-1", undefined as unknown as string)
    // Undefined doesn't match post-processing patterns → refund fires.
    expect(refundCreditsSpy).toHaveBeenCalledTimes(1)
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
