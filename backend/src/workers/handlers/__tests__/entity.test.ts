import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockGenerateImage = vi.fn()
  const mockGenerateScript = vi.fn()
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockUploadImageMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/images/job-1.png")

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockGenerateImage,
    mockGenerateScript,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockUploadImageMaybeWatermark,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))
vi.mock("@/providers/index.js", () => ({ generateImage: mocks.mockGenerateImage }))
vi.mock("@/providers/script/script-generator.js", () => ({ generateScript: mocks.mockGenerateScript }))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  uploadImageMaybeWatermark: mocks.mockUploadImageMaybeWatermark,
}))

import { entityHandlers } from "../entity.js"

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return { name, data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false, ...overrides }
}

const PROVIDER_RESULT = {
  url: "https://provider.example.com/image.png",
  providerUsed: "nano-banana",
  cost: 0.02,
  displayCost: 0.025,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockGenerateScript.mockResolvedValue({ title: "My Script", scenes: [{ description: "Scene 1" }] })
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
})

describe("generate-character handler", () => {
  const handler = entityHandlers["generate-character"]

  it("happy path: generates character image", async () => {
    const job = makeJob("generate-character", { prompt: "a warrior" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a warrior", "nano-banana", undefined, undefined)
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(PROVIDER_RESULT.url, "job-1", "user-1", false)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })

  it("uses custom provider", async () => {
    const job = makeJob("generate-character", { prompt: "a wizard", provider: "flux" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a wizard", "flux", undefined, undefined)
  })

  it("passes source image as reference", async () => {
    const job = makeJob("generate-character", { prompt: "style transfer", sourceImageUrl: "https://ref.png" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("style transfer", "nano-banana", ["https://ref.png"], undefined)
  })
})

describe("generate-face handler", () => {
  const handler = entityHandlers["generate-face"]

  it("forces 1:1 aspect ratio", async () => {
    const job = makeJob("generate-face", { prompt: "a portrait" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a portrait", "nano-banana", undefined, { aspect_ratio: "1:1" })
  })
})

describe("generate-character-asset handler", () => {
  const handler = entityHandlers["generate-character-asset"]

  it("includes assetType in output", async () => {
    const job = makeJob("generate-character-asset", { prompt: "a sword", assetType: "weapon" })
    await handler(job as never, makeCtx())
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "weapon" },
    }))
  })
})

describe("generate-object handler", () => {
  const handler = entityHandlers["generate-object"]

  it("happy path", async () => {
    const job = makeJob("generate-object", { prompt: "a treasure chest" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a treasure chest", "nano-banana", undefined, undefined)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })
})

describe("generate-object-asset handler", () => {
  const handler = entityHandlers["generate-object-asset"]

  it("includes assetType in output", async () => {
    const job = makeJob("generate-object-asset", { prompt: "a key", assetType: "prop" })
    await handler(job as never, makeCtx())
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "prop" },
    }))
  })
})

describe("generate-location handler", () => {
  const handler = entityHandlers["generate-location"]

  it("happy path", async () => {
    const job = makeJob("generate-location", { prompt: "a dark forest" })
    await handler(job as never, makeCtx())
    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a dark forest", "nano-banana", undefined, undefined)
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", PROVIDER_RESULT.cost)
  })
})

describe("generate-location-asset handler", () => {
  const handler = entityHandlers["generate-location-asset"]

  it("includes assetType in output", async () => {
    const job = makeJob("generate-location-asset", { prompt: "a castle", assetType: "background" })
    await handler(job as never, makeCtx())
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "background" },
    }))
  })
})

describe("generate-script handler", () => {
  const handler = entityHandlers["generate-script"]

  it("happy path: generates script", async () => {
    const job = makeJob("generate-script", { prompt: "a story about adventure" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateScript).toHaveBeenCalledWith("a story about adventure", undefined, undefined, undefined, undefined, undefined)
    expect(mocks.mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      output_data: { script: { title: "My Script", scenes: [{ description: "Scene 1" }] } },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("shared entity handler behavior", () => {
  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const handler = entityHandlers["generate-character"]
    const job = makeJob("generate-character", { prompt: "cancelled" })
    await handler(job as never, makeCtx())
    expect(mocks.mockUpdate).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("passes watermark flag", async () => {
    const handler = entityHandlers["generate-character"]
    const job = makeJob("generate-character", { prompt: "watermarked" })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(PROVIDER_RESULT.url, "job-1", "user-1", true)
  })
})
