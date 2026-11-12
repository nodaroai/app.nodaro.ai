/**
 * The worker: decompose the image, then finalize — the base as the run's image,
 * every layer stored beside it and filed in the Library under its name, each
 * layer's data on `layerData` — and settle on the row of the images STORED (a
 * layer that cannot be stored is dropped; a base that cannot be stored refunds).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const m = vi.hoisted(() => ({
  run: vi.fn(),
  ensure: vi.fn(async (url: string) => url),
  finalize: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true })),
  base: vi.fn(async (id: string) => ({ "split-into-layers:1k:4": 40, "split-into-layers:2k:4": 67, "split-into-layers:1k:1": 13, "split-into-layers:1k:3": 31 } as Record<string, number>)[id]),
  progress: vi.fn(async () => {}),
}))

vi.mock("@/providers/kie/layer-decomposition.js", () => ({ runLayerDecomposition: m.run }))
vi.mock("@/providers/kie/video.js", () => ({ ensureImageForProvider: m.ensure }))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: m.finalize }))
vi.mock("@/lib/credit-id-base.js", () => ({ creditIdBaseCredits: m.base }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: () => async () => {} }))
vi.mock("@/workers/shared.js", () => ({ setJobProgress: m.progress, startProgressRamp: () => ({ stop: () => {} }) }))

import { PostProcessingError } from "@/lib/post-processing-error.js"
import { LAYER_STORE_ATTEMPTS } from "../recover.js"
import { worker } from "../worker.js"

const ctx = { jobId: "job-1", jobUserId: "u1", usageLogId: "ul-1", shouldWatermark: false }
const job = (data: Record<string, unknown>) => ({ data: { jobId: "job-1", imageUrl: "https://in.png", ...data }, updateProgress: async () => {} }) as never

const LAYERS = [
  { url: "https://kie/l1.png", zIndex: 1, name: "Bottom caption text", description: "The caption.", width: 1727, height: 607, box: { x1: 82, y1: 1239, x2: 944, y2: 1412 }, boxNormalized: { x1: 80, y1: 807, x2: 921, y2: 919 } },
  { url: "https://kie/l2.png", zIndex: 2, name: "Arctic fox", width: 1108, height: 946 },
  { url: "https://kie/l3.png", zIndex: 3 },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.run.mockResolvedValue({ taskId: "t1", baseUrl: "https://kie/base.png", layers: LAYERS, kieCredits: 15.84, providerMs: 25000 })
})

describe("split-into-layers worker", () => {
  const STORED = ["https://r2/1.png", "https://r2/2.png", "https://r2/3.png"]
  const inputOf = () => m.finalize.mock.calls[0]![0] as Record<string, any>

  it("asks for Max layers + 1 images at the size, then finalizes the base, the layers (filed under their names) and their data", async () => {
    await worker(job({ maxLayers: 3, size: "1K", prompt: " the fox " }), ctx as never)
    expect(m.run).toHaveBeenCalledWith({ imageUrl: "https://in.png", maxImages: 4, size: "1K", prompt: "the fox" }, expect.objectContaining({ modelKey: "seedream-5-5-layer-decomposition" }))
    const input = inputOf()
    expect(input.jobType).toBe("edit-image")
    expect(input.result).toMatchObject({ url: "https://kie/base.png", providerUsed: "seedream-5-5-layer-decomposition", kieTaskId: "t1", providerMs: 25000 })
    expect(input.result.cost).toBeCloseTo(15.84 * 0.005)
    expect(input.storeAttempts).toBe(LAYER_STORE_ATTEMPTS)
    expect(LAYER_STORE_ATTEMPTS).toBeGreaterThan(1)
    expect(input.extraImageSets).toEqual([{ key: "layers", library: true, dropUnstorable: true, images: [
      { url: "https://kie/l1.png", name: "Bottom caption text" },
      { url: "https://kie/l2.png", name: "Arctic fox" },
      { url: "https://kie/l3.png" },
    ] }])
    // The layer data names each layer's STORED file, and the STORED base it was cut from.
    const extra = input.extraOutputData({ layers: STORED }, { layers: [] }, "https://r2/base.png")
    expect(extra.layerCount).toBe(3)
    expect(extra.layersNotSaved).toBe(0)
    expect(extra.layerData[0]).toEqual({ name: "Bottom caption text", description: "The caption.", zIndex: 1, width: 1727, height: 607, box: { x1: 82, y1: 1239, x2: 944, y2: 1412 }, boxNormalized: { x1: 80, y1: 807, x2: 921, y2: 919 }, url: "https://r2/1.png", baseUrl: "https://r2/base.png" })
    expect(extra.layerData[2]).toEqual({ zIndex: 3, url: "https://r2/3.png", baseUrl: "https://r2/base.png" })
    // 3 layers stored + the base = 4 images, at the 1K row.
    expect(await input.meteredBaseCredits({ layers: STORED }, { layers: [] })).toBe(40)
    expect(m.base).toHaveBeenCalledWith("split-into-layers:1k:4")
  })

  it("auto settles at the 2K tier", async () => {
    await worker(job({ maxLayers: 9, size: "auto" }), ctx as never)
    expect(m.run.mock.calls[0]![0]).toEqual({ imageUrl: "https://in.png", maxImages: 10, size: "auto" })
    expect(await inputOf().meteredBaseCredits({ layers: STORED }, { layers: [] })).toBe(67)
    expect(m.base).toHaveBeenCalledWith("split-into-layers:2k:4")
  })

  it("a layer that could not be stored is dropped: its data is left out, it is counted as not saved, and the run is charged for the images stored", async () => {
    await worker(job({ maxLayers: 3 }), ctx as never)
    const input = inputOf()
    // Layer 2 (index 1) was dropped: the stored list holds layers 1 and 3.
    const extra = input.extraOutputData({ layers: ["https://r2/1.png", "https://r2/3.png"] }, { layers: [1] }, "https://r2/base.png")
    expect(extra.layerCount).toBe(2)
    expect(extra.layersNotSaved).toBe(1)
    expect(extra.layerData.map((l: { zIndex: number; url: string; baseUrl: string }) => [l.zIndex, l.url, l.baseUrl])).toEqual([[1, "https://r2/1.png", "https://r2/base.png"], [3, "https://r2/3.png", "https://r2/base.png"]])
    // 2 layers + the base = 3 images.
    expect(await input.meteredBaseCredits({ layers: ["https://r2/1.png", "https://r2/3.png"] }, { layers: [1] })).toBe(31)
    expect(m.base).toHaveBeenCalledWith("split-into-layers:1k:3")
  })

  it("a run that found no element completes with its base alone, charged the one-image row", async () => {
    m.run.mockResolvedValue({ taskId: "t1", baseUrl: "https://kie/base.png", layers: [] })
    await worker(job({}), ctx as never)
    const input = inputOf()
    expect(input.extraImageSets).toEqual([{ key: "layers", library: true, dropUnstorable: true, images: [] }])
    expect(input.extraOutputData({ layers: [] }, { layers: [] }, "https://r2/base.png")).toEqual({ layerData: [], layerCount: 0, layersNotSaved: 0 })
    expect(await input.meteredBaseCredits({ layers: [] }, { layers: [] })).toBe(13)
    expect(m.base).toHaveBeenCalledWith("split-into-layers:1k:1")
    expect(input.result.cost).toBeNull()
  })

  it("never holds more layers than it asked for", async () => {
    m.run.mockResolvedValue({ taskId: "t1", baseUrl: "https://kie/base.png", layers: [...LAYERS, { url: "https://kie/l4.png", zIndex: 4 }] })
    await worker(job({ maxLayers: 2 }), ctx as never)
    expect(inputOf().extraImageSets[0].images).toHaveLength(2)
  })

  it("no price (no credits in this edition): nothing metered", async () => {
    m.base.mockResolvedValueOnce(undefined as never)
    await worker(job({ maxLayers: 3 }), ctx as never)
    expect(await inputOf().meteredBaseCredits({ layers: STORED }, { layers: [] })).toBeUndefined()
  })

  it("a base picture that cannot be stored fails the job as a refundable error, never a post-processing one", async () => {
    m.finalize.mockRejectedValueOnce(new PostProcessingError("R2 down") as never)
    const err = await worker(job({}), ctx as never).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/the base picture could not be saved \(R2 down\)/)
    const { isPostProcessingError } = await import("@/lib/post-processing-error.js")
    expect(isPostProcessingError(err)).toBe(false)
  })

  it("a provider failure fails the job (the video worker's failure path refunds it)", async () => {
    m.run.mockRejectedValue(new Error("Generation failed"))
    await expect(worker(job({}), ctx as never)).rejects.toThrow("Generation failed")
    expect(m.finalize).not.toHaveBeenCalled()
  })
})
