/**
 * Nodaro Image Upscale in the edit-image worker: a house model, so the job is
 * handed to its lane (lib/nodaro-image-upscale-lane.ts) and never reaches a
 * provider client of this worker's own.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ editImage: vi.fn(), runLane: vi.fn(async () => {}) }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) },
}))
vi.mock("@/providers/index.js", () => ({ generateImage: vi.fn(), editImage: mocks.editImage }))
vi.mock("@/lib/nodaro-image-upscale-lane.js", () => ({ runNodaroImageUpscaleJob: mocks.runLane }))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
}))

import { imageAIHandlers } from "../image-ai.js"

const handler = imageAIHandlers["edit-image"]

function run(data: Record<string, unknown>) {
  const job = { name: "edit-image", data: { jobId: "job-1", imageUrl: "https://img.png", ...data }, id: "bull-1", updateProgress: vi.fn() }
  return handler(job as never, { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("the edit-image worker and Nodaro Image Upscale", () => {
  it("hands the job to the lane, with its payload and job id, and calls no provider client", async () => {
    await run({ provider: "nodaro-image-upscale", upscaleFactor: "4" })
    expect(mocks.runLane).toHaveBeenCalledWith(expect.objectContaining({ provider: "nodaro-image-upscale", upscaleFactor: "4", imageUrl: "https://img.png" }), { jobId: "job-1" })
    expect(mocks.editImage).not.toHaveBeenCalled()
  })

  it("a lane rejection is the job's, unchanged", async () => {
    const err = Object.assign(new Error("House Fixture could not complete this run."), { deterministic: true })
    mocks.runLane.mockRejectedValueOnce(err)
    await expect(run({ provider: "nodaro-image-upscale" })).rejects.toBe(err)
  })

  it("every other model keeps its own path", async () => {
    mocks.editImage.mockResolvedValue({ url: "https://out.png", cost: 0 })
    await run({ provider: "recraft-upscale" }).catch(() => {})
    expect(mocks.runLane).not.toHaveBeenCalled()
    expect(mocks.editImage).toHaveBeenCalled()
  })
})
