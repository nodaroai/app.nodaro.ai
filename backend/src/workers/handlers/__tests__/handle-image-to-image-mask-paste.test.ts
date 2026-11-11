/**
 * The image-to-image handler's paste-back: a model that redraws the whole
 * picture around a mask (GPT Image 2.6 Flare and Sunburst, whose provider
 * answers `maskEditSourceUrl`) gets the source pasted back everywhere outside
 * the mask BEFORE finalize, and a failed paste fails the job (refund) rather
 * than delivering the redraw. Every other run is finalized as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  editImage: vi.fn(),
  finalize: vi.fn().mockResolvedValue({ ok: true }),
  paste: vi.fn(),
  compositeInpaint: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) }) },
}))
vi.mock("@/providers/index.js", () => ({ generateImage: mocks.generateImage, editImage: mocks.editImage }))
vi.mock("@/lib/character-auto-attach.js", () => ({ attachAssetToCharacter: vi.fn(), resolveAssetColumn: () => null }))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))
vi.mock("../../../services/inpaint/composite.js", () => ({
  compositeInpaint: mocks.compositeInpaint,
  maskBoundingBoxFromUrl: vi.fn(),
  imageDimensions: vi.fn(),
  pasteSourceOutsideMask: mocks.paste,
}))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  setJobProgress: vi.fn().mockResolvedValue(undefined),
  startProgressRamp: vi.fn().mockReturnValue({ stop: vi.fn() }),
}))

import { imageAIHandlers } from "../image-ai.js"

const handler = imageAIHandlers["image-to-image"]!
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const job = (data: Record<string, unknown>) => ({ name: "image-to-image", data: { jobId: "job-1", ...data }, id: "bull-1", updateProgress: vi.fn() })

const REDRAWN = {
  url: "https://kie.example.com/result.png",
  providerUsed: "kie",
  cost: 0.05,
  displayCost: 0.05,
  maskEditSourceUrl: "https://src.example.com/source.png",
}
const MASKED = { imageUrl: "https://src.example.com/source.png", prompt: "paint it green", provider: "gpt-image-2-6-flare-i2i", maskUrl: "https://m.example.com/mask.png" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.finalize.mockResolvedValue({ ok: true })
})

describe("image-to-image: the source pasted back outside a mask", () => {
  it("sends the mask to the model as the caller's mask_url", async () => {
    mocks.generateImage.mockResolvedValue(REDRAWN)
    mocks.paste.mockResolvedValue("https://scratch.example.com/mask-composite.png")
    await handler(job(MASKED) as never, ctx as never)
    const [, model, images, extra] = mocks.generateImage.mock.calls[0]!
    expect(model).toBe("gpt-image-2-6-flare-i2i")
    expect(images).toEqual(["https://src.example.com/source.png"])
    expect(extra).toMatchObject({ mask_url: "https://m.example.com/mask.png" })
  })

  it("pastes the source the model was sent back over the result, then finalizes that picture", async () => {
    mocks.generateImage.mockResolvedValue({ ...REDRAWN, extraUrls: ["https://kie.example.com/variant.png"] })
    mocks.paste.mockResolvedValue("https://scratch.example.com/mask-composite.png")
    await handler(job(MASKED) as never, ctx as never)

    expect(mocks.paste).toHaveBeenCalledWith({
      sourceUrl: "https://src.example.com/source.png",
      resultUrl: "https://kie.example.com/result.png",
      maskUrl: "https://m.example.com/mask.png",
      jobId: "job-1",
      transparent: false,
    })
    const input = mocks.finalize.mock.calls[0]![0]
    expect(input.jobType).toBe("image-to-image")
    expect(input.result.url).toBe("https://scratch.example.com/mask-composite.png")
    expect(input.result.extraUrls).toBeUndefined()
    expect(input.extraOutputData).toEqual({ maskComposited: true })
    expect(mocks.paste.mock.invocationCallOrder[0]).toBeLessThan(mocks.finalize.mock.invocationCallOrder[0]!)
    expect(mocks.compositeInpaint).not.toHaveBeenCalled()
  })

  it("a run that asked for a transparent background keeps the result's transparency in the paste-back", async () => {
    mocks.generateImage.mockResolvedValue(REDRAWN)
    mocks.paste.mockResolvedValue("https://scratch.example.com/mask-composite.png")
    await handler(job({ ...MASKED, background: "transparent" }) as never, ctx as never)
    expect(mocks.paste).toHaveBeenCalledWith(expect.objectContaining({ transparent: true }))
  })

  it("a failed paste fails the job before finalize (refund, not a redraw delivered)", async () => {
    mocks.generateImage.mockResolvedValue(REDRAWN)
    mocks.paste.mockRejectedValue(new Error("compositeInpaint: failed to fetch https://src (500)"))
    await expect(handler(job(MASKED) as never, ctx as never)).rejects.toThrow("failed to fetch")
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it("a result that cannot be pasted on (not a PNG, JPEG or WebP) is delivered as it is", async () => {
    mocks.generateImage.mockResolvedValue(REDRAWN)
    mocks.paste.mockResolvedValue(undefined)
    await handler(job(MASKED) as never, ctx as never)
    const input = mocks.finalize.mock.calls[0]![0]
    expect(input.result.url).toBe("https://kie.example.com/result.png")
    expect(input.extraOutputData).toBeUndefined()
  })

  it("a model that keeps the outside itself (no maskEditSourceUrl: FLUX Fill, Ideogram) is finalized as before", async () => {
    const raw = { url: "https://replicate.example.com/out.png", providerUsed: "replicate", cost: 0.05, displayCost: 0.05 }
    mocks.generateImage.mockResolvedValue(raw)
    await handler(job({ ...MASKED, provider: "flux-fill" }) as never, ctx as never)
    expect(mocks.paste).not.toHaveBeenCalled()
    const input = mocks.finalize.mock.calls[0]![0]
    expect(input.result).toBe(raw)
    expect(input).not.toHaveProperty("extraOutputData")
  })

  it("no mask, no paste-back, even if a provider says it redrew", async () => {
    mocks.generateImage.mockResolvedValue(REDRAWN)
    await handler(job({ ...MASKED, maskUrl: undefined }) as never, ctx as never)
    expect(mocks.paste).not.toHaveBeenCalled()
    expect((mocks.generateImage.mock.calls[0]![3] as Record<string, unknown> | undefined)?.mask_url).toBeUndefined()
  })
})
