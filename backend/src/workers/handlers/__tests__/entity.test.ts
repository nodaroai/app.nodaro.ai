import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  const mockGenerateImage = vi.fn()
  const mockImageToVideo = vi.fn()
  const mockGenerateScript = vi.fn()
  const mockCommitJobCredits = vi.fn().mockResolvedValue(undefined)
  const mockShouldSaveJobResult = vi.fn().mockResolvedValue(true)
  const mockMarkJobCompleted = vi.fn().mockResolvedValue(true)
  const mockUploadImageMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/images/job-1.png")
  const mockUploadVideoMaybeWatermark = vi.fn().mockResolvedValue("https://r2.example.com/videos/job-1.mp4")
  const mockAttach = vi.fn().mockResolvedValue(true)
  const mockSetPortrait = vi.fn().mockResolvedValue(true)

  const mockEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate })

  return {
    mockGenerateImage,
    mockImageToVideo,
    mockGenerateScript,
    mockCommitJobCredits,
    mockShouldSaveJobResult,
    mockMarkJobCompleted,
    mockUploadImageMaybeWatermark,
    mockUploadVideoMaybeWatermark,
    mockAttach,
    mockSetPortrait,
    mockFrom,
    mockUpdate,
    mockEq,
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mocks.mockFrom } }))
vi.mock("@/providers/index.js", () => ({ generateImage: mocks.mockGenerateImage, imageToVideo: mocks.mockImageToVideo }))
vi.mock("@/providers/script/script-generator.js", () => ({ generateScript: mocks.mockGenerateScript }))
vi.mock("@/lib/character-auto-attach.js", () => ({
  attachAssetToCharacter: mocks.mockAttach,
  setCharacterPortrait: mocks.mockSetPortrait,
  resolveAssetColumn: (v: string) => {
    const normalized = v === "lighting" ? "lighting_variations" : v
    const valid = new Set(["expressions", "poses", "lighting_variations", "angles", "motions"])
    return valid.has(normalized) ? normalized : null
  },
}))
vi.mock("../../shared.js", () => ({
  commitJobCredits: mocks.mockCommitJobCredits,
  shouldSaveJobResult: mocks.mockShouldSaveJobResult,
  markJobCompleted: mocks.mockMarkJobCompleted,
  uploadImageMaybeWatermark: mocks.mockUploadImageMaybeWatermark,
  uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
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

const VIDEO_PROVIDER_RESULT = {
  url: "https://provider.example.com/video.mp4",
  providerUsed: "kling",
  cost: 0.5,
  displayCost: 0.6,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockImageToVideo.mockResolvedValue(VIDEO_PROVIDER_RESULT)
  mocks.mockGenerateScript.mockResolvedValue({ title: "My Script", scenes: [{ description: "Scene 1" }] })
  mocks.mockShouldSaveJobResult.mockResolvedValue(true)
  mocks.mockMarkJobCompleted.mockResolvedValue(true)
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
  const TEST_CHARACTER_ID = "00000000-0000-0000-0000-000000000abc"

  it("includes assetType in output", async () => {
    const job = makeJob("generate-character-asset", { prompt: "a sword", assetType: "weapon" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { imageUrl: "https://r2.example.com/images/job-1.png", assetType: "weapon" },
    }))
  })

  it("passes description / motionDescription / realLifeRefs through to attachAssetToCharacter", async () => {
    const job = makeJob("generate-character-asset", {
      prompt: "smile prompt",
      assetType: "expressions",
      variant: "smile",
      provider: "nano-banana-pro",
      attachToCharacterId: TEST_CHARACTER_ID,
      attachToColumn: "expressions",
      attachName: "smile",
      description: "warm closed-mouth smile, slight eye crinkle",
      realLifeRefs: ["https://example.com/me-smiling.jpg"],
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({
          description: "warm closed-mouth smile, slight eye crinkle",
          realLifeRefs: ["https://example.com/me-smiling.jpg"],
        }),
      }),
    )
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
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
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { script: { title: "My Script", scenes: [{ description: "Scene 1" }] } },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1")
  })
})

describe("generate-character-motion handler", () => {
  const handler = entityHandlers["generate-character-motion"]

  it("calls imageToVideo with (sourceImageUrl, provider, prompt) and stores videoUrl", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Alex, walking. realistic style.",
      sourceImageUrl: "https://x/p.png",
      provider: "kling",
    })
    await handler(job as never, makeCtx())

    expect(mocks.mockImageToVideo).toHaveBeenCalledWith("https://x/p.png", "kling", "Alex, walking. realistic style.")
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(VIDEO_PROVIDER_RESULT.url, "job-1", "user-1", false)
    expect(mocks.mockMarkJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
      output_data: { videoUrl: "https://r2.example.com/videos/job-1.mp4" },
    }))
    expect(mocks.mockCommitJobCredits).toHaveBeenCalledWith("usage-1", "job-1", VIDEO_PROVIDER_RESULT.cost)
  })

  it("defaults provider to kling when omitted", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Sam, dancing.",
      sourceImageUrl: "https://x/q.png",
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith("https://x/q.png", "kling", "Sam, dancing.")
  })

  it("passes watermark flag through", async () => {
    const job = makeJob("generate-character-motion", {
      prompt: "Riley, jumping.",
      sourceImageUrl: "https://x/r.png",
      provider: "minimax",
    })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockImageToVideo).toHaveBeenCalledWith("https://x/r.png", "minimax", "Riley, jumping.")
    expect(mocks.mockUploadVideoMaybeWatermark).toHaveBeenCalledWith(VIDEO_PROVIDER_RESULT.url, "job-1", "user-1", true)
  })

  it("returns early when cancelled (no markJobCompleted, no credits)", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const job = makeJob("generate-character-motion", {
      prompt: "cancelled",
      sourceImageUrl: "https://x/c.png",
    })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })
})

describe("shared entity handler behavior", () => {
  it("returns early when cancelled", async () => {
    mocks.mockShouldSaveJobResult.mockResolvedValueOnce(false)
    const handler = entityHandlers["generate-character"]
    const job = makeJob("generate-character", { prompt: "cancelled" })
    await handler(job as never, makeCtx())
    expect(mocks.mockMarkJobCompleted).not.toHaveBeenCalled()
    expect(mocks.mockCommitJobCredits).not.toHaveBeenCalled()
  })

  it("passes watermark flag", async () => {
    const handler = entityHandlers["generate-character"]
    const job = makeJob("generate-character", { prompt: "watermarked" })
    await handler(job as never, makeCtx({ shouldWatermark: true }))
    expect(mocks.mockUploadImageMaybeWatermark).toHaveBeenCalledWith(PROVIDER_RESULT.url, "job-1", "user-1", true)
  })
})
