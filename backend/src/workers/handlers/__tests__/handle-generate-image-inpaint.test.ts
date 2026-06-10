import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() for variables used inside vi.mock()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockGenerateImage = vi.fn()
  const mockEditImage = vi.fn()
  const mockFinalizeJobWithMedia = vi.fn().mockResolvedValue({ ok: true })
  const mockAttach = vi.fn().mockResolvedValue(true)

  // composite service
  const mockCompositeInpaint = vi.fn()
  const mockMaskBoundingBoxFromUrl = vi.fn()
  const mockImageDimensions = vi.fn()
  const mockMaskBoundingBox = vi.fn()

  // Supabase chain (reconcile persistence update path).
  const mockEqUpdate = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEqUpdate })
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockEqSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEqSelect })
  const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate, select: mockSelect })

  return {
    mockGenerateImage,
    mockEditImage,
    mockFinalizeJobWithMedia,
    mockAttach,
    mockCompositeInpaint,
    mockMaskBoundingBoxFromUrl,
    mockImageDimensions,
    mockMaskBoundingBox,
    mockFrom,
    mockUpdate,
    mockEqUpdate,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mocks.mockFrom },
}))

vi.mock("@/providers/index.js", () => ({
  generateImage: mocks.mockGenerateImage,
  editImage: mocks.mockEditImage,
}))

vi.mock("@/lib/character-auto-attach.js", () => ({
  attachAssetToCharacter: mocks.mockAttach,
  resolveAssetColumn: (v: string) => v,
}))

vi.mock("../../../lib/job-finalize.js", () => ({
  finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia,
}))

vi.mock("../../../services/inpaint/composite.js", () => ({
  compositeInpaint: mocks.mockCompositeInpaint,
  maskBoundingBoxFromUrl: mocks.mockMaskBoundingBoxFromUrl,
  imageDimensions: mocks.mockImageDimensions,
  maskBoundingBox: mocks.mockMaskBoundingBox,
}))

vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    setJobProgress: vi.fn().mockResolvedValue(undefined),
    startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
  }
})

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------

import { imageAIHandlers } from "../image-ai.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "generate-image",
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
  url: "https://r2/raw.png",
  providerUsed: "gpt-image-2",
  cost: 0.06,
}

const COMPOSITE_URL = "https://r2/inpaint/job-1.png"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const handler = imageAIHandlers["generate-image"]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockGenerateImage.mockResolvedValue(PROVIDER_RESULT)
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  mocks.mockCompositeInpaint.mockResolvedValue(COMPOSITE_URL)
  // Prompt-tier hint path mocks — resolve a box + dims so it doesn't throw.
  mocks.mockMaskBoundingBoxFromUrl.mockResolvedValue({ x: 10, y: 10, width: 40, height: 40 })
  mocks.mockImageDimensions.mockResolvedValue({ width: 100, height: 100 })
})

describe("generate-image inpaint", () => {
  it("base + mask: composites once and finalizes with the composite mediaUrl", async () => {
    const job = makeJob({
      prompt: "a red hat",
      provider: "gpt-image-2",
      baseImageUrl: "https://r2/base.png",
      maskUrl: "https://r2/mask.png",
      strength: 0.8,
      guidanceScale: 4,
    })

    await handler(job as never, makeCtx())

    // i2i swap: gpt-image-2 → gpt-image-2-i2i, base prepended to refs.
    expect(mocks.mockGenerateImage).toHaveBeenCalledTimes(1)
    const [, model, refs] = mocks.mockGenerateImage.mock.calls[0]!
    expect(model).toBe("gpt-image-2-i2i")
    expect(refs).toEqual(["https://r2/base.png"])

    // Composite runs once, conditioned on base + raw provider result.
    expect(mocks.mockCompositeInpaint).toHaveBeenCalledTimes(1)
    expect(mocks.mockCompositeInpaint).toHaveBeenCalledWith({
      baseUrl: "https://r2/base.png",
      resultUrl: "https://r2/raw.png",
      maskUrl: "https://r2/mask.png",
      jobId: "job-1",
    })

    // Finalize receives the composite output as mediaUrl.
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith({
      jobId: "job-1",
      jobType: "generate-image",
      result: PROVIDER_RESULT,
      mediaUrl: COMPOSITE_URL,
    })
  })

  it("base + mask (prompt-tier provider): prepends the region hint to the prompt", async () => {
    // Concrete box + dims so describeMaskRegion yields a deterministic fragment.
    // (10,5)+(30,40) on a 100×100 image → center (0.25,0.25) → "the upper-left region".
    mocks.mockMaskBoundingBoxFromUrl.mockResolvedValueOnce({ x: 10, y: 5, width: 30, height: 40 })
    mocks.mockImageDimensions.mockResolvedValueOnce({ width: 100, height: 100 })

    const job = makeJob({
      prompt: "a red hat",
      provider: "gpt-image-2", // IMAGE_MASK_MODE["gpt-image-2"] === "prompt"
      baseImageUrl: "https://r2/base.png",
      maskUrl: "https://r2/mask.png",
    })

    await handler(job as never, makeCtx())

    // The FIRST positional arg to generateImage is the prompt — it must carry the
    // region fragment PREPENDED ahead of the user's instruction.
    const promptArg = mocks.mockGenerateImage.mock.calls[0]![0] as string
    expect(promptArg).toContain("leaving everything else unchanged")
    expect(promptArg).toContain("the upper-left region")
    expect(promptArg).toContain("a red hat")
  })

  it("base + mask (composite-tier provider): does NOT inject a region hint", async () => {
    const job = makeJob({
      prompt: "a red hat",
      provider: "flux", // IMAGE_MASK_MODE["flux"] === "composite"
      baseImageUrl: "https://r2/base.png",
      maskUrl: "https://r2/mask.png",
    })

    await handler(job as never, makeCtx())

    // Composite floor still runs — inpaint happens regardless of tier.
    expect(mocks.mockCompositeInpaint).toHaveBeenCalledTimes(1)

    // But the prompt is the untouched user prompt: composite-tier providers get
    // no region fragment (only "prompt"-tier providers do).
    const promptArg = mocks.mockGenerateImage.mock.calls[0]![0] as string
    expect(promptArg).toBe("a red hat")
  })

  it("plain T2I (no mask): does not composite and finalizes WITHOUT mediaUrl", async () => {
    const job = makeJob({ prompt: "a cat", provider: "gpt-image-2" })

    await handler(job as never, makeCtx())

    expect(mocks.mockCompositeInpaint).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith({
      jobId: "job-1",
      jobType: "generate-image",
      result: PROVIDER_RESULT,
    })
    // No mediaUrl key at all on the non-inpaint path.
    const finalizeArg = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown>
    expect("mediaUrl" in finalizeArg).toBe(false)
  })

  it("full-image i2i refine: baseImageUrl without mask conditions on the base but does NOT composite", async () => {
    const job = makeJob({
      prompt: "a red hat",
      provider: "gpt-image-2",
      baseImageUrl: "https://r2/base.png",
      // no maskUrl → isInpaint=false but isI2I=true (explicit base)
    })

    await handler(job as never, makeCtx())

    // No mask → no composite: the i2i result IS the final image.
    expect(mocks.mockCompositeInpaint).not.toHaveBeenCalled()

    // The base still drives i2i: model swapped to the i2i variant, base prepended.
    expect(mocks.mockGenerateImage).toHaveBeenCalledTimes(1)
    const [promptArg, model, refs] = mocks.mockGenerateImage.mock.calls[0]!
    expect(model).toBe("gpt-image-2-i2i")
    expect((refs as string[])[0]).toBe("https://r2/base.png")

    // No mask → no region hint: the prompt is the untouched user prompt.
    expect(promptArg).toBe("a red hat")

    // Finalize gets the raw provider result, WITHOUT a mediaUrl (no composite).
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledWith({
      jobId: "job-1",
      jobType: "generate-image",
      result: PROVIDER_RESULT,
    })
    const finalizeArg = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0] as Record<string, unknown>
    expect("mediaUrl" in finalizeArg).toBe(false)
  })

  it("composite rejects (plain Error): handler rejects and finalize is NOT called (refund-before-completion)", async () => {
    const boom = new Error("compositeInpaint: failed to fetch base (500)")
    mocks.mockCompositeInpaint.mockRejectedValueOnce(boom)

    const job = makeJob({
      prompt: "a red hat",
      provider: "gpt-image-2",
      baseImageUrl: "https://r2/base.png",
      maskUrl: "https://r2/mask.png",
    })

    await expect(handler(job as never, makeCtx())).rejects.toThrow(boom)
    // Proves the composite floor runs BEFORE finalize: a failure means the job
    // is never marked completed, so the charge-for-nothing guard refunds.
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
