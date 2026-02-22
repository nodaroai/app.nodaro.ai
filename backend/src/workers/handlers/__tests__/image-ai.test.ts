import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockGenerateImage = vi.fn()
  const mockEditImage = vi.fn()
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockUploadImageMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/images/job-1.png")

  // Supabase chain
  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockGenerateImage,
    mockEditImage,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockUploadImageMaybeWatermark,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/providers/index.js", () => ({
  generateImage: mocks.mockGenerateImage,
  editImage: mocks.mockEditImage,
}))

vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  uploadImageMaybeWatermark: mocks.mockUploadImageMaybeWatermark,
}))

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { imageAIHandlers } from "../image-ai.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(name: string, data: Record<string, unknown> = {}) {
  return {
    name,
    data: { jobId: "job-1", ...data },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    jobUserId: "user-1",
    usageLogId: "usage-1",
    shouldWatermark: false,
    ...overrides,
  }
}

const PROVIDER_RESULT = {
  url: "https://provider.example.com/image.png",
  providerUsed: "nano-banana",
  cost: 0.02,
  displayCost: 0.025,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockEditImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockUploadImageMaybeWatermark.mockResolvedValue("https://r2.example.com/images/job-1.png")
})

// ---------------------------------------------------------------------------
// generate-image
// ---------------------------------------------------------------------------

describe("generate-image handler", () => {
  const handler = imageAIHandlers["generate-image"]

  it("happy path: generates, uploads, saves, commits credits", async () => {
    const job = makeJob("generate-image", { prompt: "a cat" })
    const ctx = makeCtx()

    await handler(job as never, ctx)

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a cat", "nano-banana", undefined, undefined)
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(
      PROVIDER_RESULT.url, "job-1", "user-1", false,
    )
    expect(job.updateProgress).toHaveBeenCalledWith(50)
    expect(job.updateProgress).toHaveBeenCalledWith(100)
    expect(mocks.mockFrom).toHaveBeenCalledWith("jobs")
    expect(mocks.mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        progress: 100,
        output_data: { imageUrl: "https://r2.example.com/images/job-1.png" },
        provider: "nano-banana",
        provider_cost: 0.02,
        display_cost: 0.025,
      }),
    )
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("uses default provider 'nano-banana' when none specified", async () => {
    const job = makeJob("generate-image", { prompt: "a dog" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a dog", "nano-banana", undefined, undefined)
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("generate-image", { prompt: "a bird", provider: "flux" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("a bird", "flux", undefined, undefined)
  })

  it("passes referenceImageUrls to provider", async () => {
    const refs = ["https://ref1.png", "https://ref2.png"]
    const job = makeJob("generate-image", { prompt: "style transfer", referenceImageUrls: refs })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("style transfer", "nano-banana", refs, undefined)
  })

  it("converts aspectRatio to extraParams", async () => {
    const job = makeJob("generate-image", { prompt: "wide shot", aspectRatio: "16:9" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "wide shot", "nano-banana", undefined, { aspect_ratio: "16:9" },
    )
  })

  it("returns early when job is cancelled (shouldSaveJobResult returns false)", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("generate-image", { prompt: "cancelled" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockUpdate).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("passes watermark flag through to upload helper", async () => {
    const job = makeJob("generate-image", { prompt: "watermarked" })
    await handler(job as never, makeCtx({ shouldWatermark: true }))

    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(
      PROVIDER_RESULT.url, "job-1", "user-1", true,
    )
  })
})

// ---------------------------------------------------------------------------
// edit-image
// ---------------------------------------------------------------------------

describe("edit-image handler", () => {
  const handler = imageAIHandlers["edit-image"]

  it("happy path: edits, uploads, saves, commits credits", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png", prompt: "upscale" })
    const ctx = makeCtx()

    await handler(job as never, ctx)

    expect(mocks.mockEditImage).toHaveBeenCalledWith("https://input.png", "recraft-upscale", "upscale")
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("uses default provider 'recraft-upscale' when none specified", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png" })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith("https://input.png", "recraft-upscale", undefined)
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png", provider: "recraft-remove-bg" })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith("https://input.png", "recraft-remove-bg", undefined)
  })

  it("handles undefined prompt", async () => {
    const job = makeJob("edit-image", { imageUrl: "https://input.png" })
    await handler(job as never, makeCtx())

    expect(mocks.mockEditImage).toHaveBeenCalledWith("https://input.png", "recraft-upscale", undefined)
  })
})

// ---------------------------------------------------------------------------
// image-to-image
// ---------------------------------------------------------------------------

describe("image-to-image handler", () => {
  const handler = imageAIHandlers["image-to-image"]

  it("happy path: combines imageUrl with referenceImageUrls and generates", async () => {
    const refs = ["https://ref1.png"]
    const job = makeJob("image-to-image", {
      imageUrl: "https://main.png",
      referenceImageUrls: refs,
      prompt: "transform",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith(
      "transform", "nano-banana", ["https://main.png", "https://ref1.png"],
    )
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })

  it("uses default provider 'nano-banana' when none specified", async () => {
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "edit" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("edit", "nano-banana", ["https://main.png"])
  })

  it("uses custom provider when specified", async () => {
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "edit", provider: "flux-i2i" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("edit", "flux-i2i", ["https://main.png"])
  })

  it("works without referenceImageUrls", async () => {
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "solo" })
    await handler(job as never, makeCtx())

    expect(mocks.mockGenerateImage).toHaveBeenCalledWith("solo", "nano-banana", ["https://main.png"])
  })

  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("image-to-image", { imageUrl: "https://main.png", prompt: "cancelled" })
    await handler(job as never, makeCtx())

    expect(mocks.mockUpdate).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})
