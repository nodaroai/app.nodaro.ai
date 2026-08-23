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
})
