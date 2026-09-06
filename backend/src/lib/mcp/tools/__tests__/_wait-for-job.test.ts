import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mocks.maybeSingle,
        })),
      })),
    })),
  },
}))

import { waitForJob } from "../_wait-for-job.js"

describe("waitForJob", () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset()
  })

  it("redacts private Recast remux bases from terminal output data", async () => {
    const outputData = {
      videoUrl: "https://public.example/final.mp4",
      pro: {
        unscoredUrl: "https://private.example/base.mp4?token=secret",
        audio: { revision: "audio-v2" },
      },
    }
    mocks.maybeSingle.mockResolvedValue({
      data: {
        status: "completed",
        output_data: outputData,
        job_type: "generate-video-pro",
        error_message: null,
      },
      error: null,
    })

    const result = await waitForJob({ jobId: "job-1", timeoutMs: 100 })

    expect(result.outputUrl).toBe("https://public.example/final.mp4")
    expect(result.outputData).toEqual({
      videoUrl: "https://public.example/final.mp4",
      pro: { audio: { revision: "audio-v2" } },
    })
    expect(outputData.pro.unscoredUrl).toContain("private.example")
  })

  /**
   * A held job (spec 2026-09-03-job-policy-hook-design §6.4) is neither
   * terminal nor a timeout: it is parked on a human, for an unbounded time.
   * Polling to the deadline and answering `"timeout"` is a LIE that makes an
   * MCP client re-run a request already sitting in a review queue — and the
   * duplicate would be held too.
   */
  it("returns pending_review at once instead of burning the deadline and reporting a timeout", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        status: "pending_review",
        // `output_data` is NULL on a held row by contract (D6) — the assertion
        // below pins that nothing is invented from it either.
        output_data: null,
        job_type: "image-generate",
        error_message: null,
      },
      error: null,
    })

    const started = Date.now()
    const result = await waitForJob({ jobId: "job-held", timeoutMs: 120_000 })
    const elapsed = Date.now() - started

    expect(result.status).toBe("pending_review")
    expect(result.outputUrl).toBeNull()
    expect(result.outputData).toBeNull()
    // Not a failure, so nothing to report as an error.
    expect(result.error).toBeNull()
    expect(result.jobType).toBe("image-generate")
    // Returned on the FIRST read — well inside one 1.5s poll interval, and
    // nowhere near the 120s deadline it used to burn.
    expect(elapsed).toBeLessThan(1500)
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1)
  })
})

// Audit 2026-09-06 fix #2 (A-9 / D-7): the helper polled every 1.5 s with no
// signal, no backoff, turned one DB hiccup into `failed`, and the two tests
// returned on the first read — the poll, timeout and error arms were never
// exercised. Fake timers drive the loop here.
describe("waitForJob — the loop", () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset()
  })

  it("polls until the row is terminal, backing off between reads", async () => {
    vi.useFakeTimers()
    try {
      mocks.maybeSingle
        .mockResolvedValueOnce({ data: { status: "processing", output_data: null, job_type: "generate-image", error_message: null }, error: null })
        .mockResolvedValueOnce({ data: { status: "processing", output_data: null, job_type: "generate-image", error_message: null }, error: null })
        .mockResolvedValueOnce({ data: { status: "completed", output_data: { imageUrl: "https://r2/x.png" }, job_type: "generate-image", error_message: null }, error: null })
      const p = waitForJob({ jobId: "job-1", timeoutMs: 60_000 })
      await vi.advanceTimersByTimeAsync(20_000)
      const result = await p
      expect(result.status).toBe("completed")
      expect(result.outputUrl).toBe("https://r2/x.png")
      expect(mocks.maybeSingle).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it("answers timeout when the deadline passes with the job still running", async () => {
    vi.useFakeTimers()
    try {
      mocks.maybeSingle.mockResolvedValue({ data: { status: "processing", output_data: null, job_type: "generate-video", error_message: null }, error: null })
      const p = waitForJob({ jobId: "job-2", timeoutMs: 10_000 })
      await vi.advanceTimersByTimeAsync(12_000)
      const result = await p
      expect(result.status).toBe("timeout")
      expect(result.error).toContain("did not complete")
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops when the caller's signal aborts, reporting aborted rather than timeout", async () => {
    vi.useFakeTimers()
    try {
      mocks.maybeSingle.mockResolvedValue({ data: { status: "processing", output_data: null, job_type: "generate-video", error_message: null }, error: null })
      const ac = new AbortController()
      const p = waitForJob({ jobId: "job-3", timeoutMs: 60_000, signal: ac.signal })
      await vi.advanceTimersByTimeAsync(2_000)
      ac.abort()
      await vi.advanceTimersByTimeAsync(6_000)
      const result = await p
      expect(result.status).toBe("aborted")
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries one transient DB error before giving up", async () => {
    vi.useFakeTimers()
    try {
      mocks.maybeSingle
        .mockResolvedValueOnce({ data: null, error: { message: "connection reset" } })
        .mockResolvedValueOnce({ data: { status: "completed", output_data: { videoUrl: "https://r2/v.mp4" }, job_type: "generate-video", error_message: null }, error: null })
      const p = waitForJob({ jobId: "job-4", timeoutMs: 60_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await p
      expect(result.status).toBe("completed")
      expect(result.outputUrl).toBe("https://r2/v.mp4")
    } finally {
      vi.useRealTimers()
    }
  })

  it("fails on a second consecutive DB error", async () => {
    vi.useFakeTimers()
    try {
      mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "connection reset" } })
      const p = waitForJob({ jobId: "job-5", timeoutMs: 60_000 })
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await p
      expect(result.status).toBe("failed")
      expect(result.error).toContain("DB error")
    } finally {
      vi.useRealTimers()
    }
  })
})
