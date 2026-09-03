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
