import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  return { maybeSingle, select: vi.fn((_columns: string) => ({ eq: vi.fn(() => ({ maybeSingle })) })) }
})

vi.mock("../../../supabase.js", () => ({
  supabase: { from: vi.fn(() => ({ select: mocks.select })) },
}))

import { waitForJob } from "../_wait-for-job.js"
import type { ErrorHint } from "../../../safety-block.js"
import type { PluginJobErrorHint, PluginWaitForJobResult } from "../../../private-plugins/types.js"

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

// A cloud plugin waits on its child job through the toolkit's `jobs.waitForJob`
// and decides a retry from the child's structured failure verdict
// (`jobs.error_hint`), never from its message text.
describe("waitForJob — the child's error_hint", () => {
  beforeEach(() => {
    mocks.maybeSingle.mockReset()
  })

  it("reads error_hint in the poll", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { status: "completed", output_data: { videoUrl: "https://r2/v.mp4" }, job_type: "video-to-video", error_message: null, error_hint: null },
      error: null,
    })
    await waitForJob({ jobId: "job-1", timeoutMs: 100 })
    expect(String(mocks.select.mock.calls.at(-1)?.[0])).toContain("error_hint")
  })

  it("returns a failed job's error_hint", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        status: "failed",
        output_data: null,
        job_type: "video-to-video",
        error_message: "The provider refused the input video",
        error_hint: { kind: "input-refused", subject: "input_video" },
      },
      error: null,
    })
    const result = await waitForJob({ jobId: "job-1", timeoutMs: 100 })
    expect(result.status).toBe("failed")
    expect(result.errorHint).toEqual({ kind: "input-refused", subject: "input_video" })
  })

  it("answers errorHint null for a failed job without one", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { status: "failed", output_data: null, job_type: "video-to-video", error_message: "boom" },
      error: null,
    })
    const result = await waitForJob({ jobId: "job-1", timeoutMs: 100 })
    expect(result.errorHint).toBeNull()
  })

  // The column is shape-checked on `kind` only: anything else is not a hint.
  it.each([
    ["an array", [{ kind: "input-refused" }]],
    ["an object with no kind", { subject: "input_video" }],
    ["a non-string kind", { kind: 3, subject: "input_video" }],
    ["a string", "input-refused"],
  ])("answers errorHint null for a failed job whose error_hint is %s", async (_label, errorHint) => {
    mocks.maybeSingle.mockResolvedValue({
      data: { status: "failed", output_data: null, job_type: "video-to-video", error_message: "boom", error_hint: errorHint },
      error: null,
    })
    const result = await waitForJob({ jobId: "job-1", timeoutMs: 100 })
    expect(result.status).toBe("failed")
    expect(result.errorHint).toBeNull()
  })

  it("answers errorHint null for a completed job", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        status: "completed",
        output_data: { videoUrl: "https://r2/v.mp4" },
        job_type: "video-to-video",
        error_message: null,
        // Never read off a job that did not fail.
        error_hint: { kind: "input-refused", subject: "input_video" },
      },
      error: null,
    })
    const result = await waitForJob({ jobId: "job-1", timeoutMs: 100 })
    expect(result.status).toBe("completed")
    expect(result.errorHint).toBeNull()
  })

  it("answers errorHint null when the job is not found", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await waitForJob({ jobId: "job-gone", timeoutMs: 100 })
    expect(result.status).toBe("failed")
    expect(result.errorHint).toBeNull()
  })

  it("types the hint a plugin gets exactly like the plugin contract's PluginJobErrorHint", () => {
    // The contract's union is a hand-copied mirror of the host's: a new arm
    // on either side without the other fails here, not in a plugin.
    expectTypeOf<PluginJobErrorHint>().toEqualTypeOf<ErrorHint>()
    expectTypeOf<PluginWaitForJobResult["errorHint"]>().toEqualTypeOf<PluginJobErrorHint | null | undefined>()
    expectTypeOf<Awaited<ReturnType<typeof waitForJob>>["errorHint"]>().toExtend<PluginWaitForJobResult["errorHint"]>()
  })
})
