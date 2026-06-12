import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — hoisted before the handler import. Verifies the refine money-path:
// success commits base+addon; failure keeps the un-refined output, refunds the
// addon, and never commits (mutually exclusive branch).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  buildSurroundComposite: vi.fn(),
  harmonizeSurround: vi.fn(),
  generateImage: vi.fn(),
  editImage: vi.fn(),
  commitJobCredits: vi.fn(),
  refundSurroundRefineAddon: vi.fn(),
  shouldSaveJobResult: vi.fn(),
  markJobCompleted: vi.fn(),
  setJobProgress: vi.fn(),
  autoAttachLocationAsset: vi.fn(),
  makeOnTaskCreated: vi.fn(() => vi.fn()),
  providerKindForImageModel: vi.fn(() => "image"),
  getModelCreditBaseCost: vi.fn(),
}))

vi.mock("@/services/surround/index.js", () => ({
  buildSurroundComposite: mocks.buildSurroundComposite,
  harmonizeSurround: mocks.harmonizeSurround,
}))
vi.mock("@/providers/index.js", () => ({
  generateImage: mocks.generateImage,
  editImage: mocks.editImage,
}))
vi.mock("@/workers/shared.js", () => ({
  commitJobCredits: mocks.commitJobCredits,
  refundSurroundRefineAddon: mocks.refundSurroundRefineAddon,
  shouldSaveJobResult: mocks.shouldSaveJobResult,
  markJobCompleted: mocks.markJobCompleted,
  setJobProgress: mocks.setJobProgress,
}))
vi.mock("@/lib/location-auto-attach.js", () => ({ autoAttachLocationAsset: mocks.autoAttachLocationAsset }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: mocks.makeOnTaskCreated }))
vi.mock("@/lib/reconcile/provider-kind.js", () => ({ providerKindForImageModel: mocks.providerKindForImageModel }))
vi.mock("@/ee/billing/credits.js", () => ({ getModelCreditBaseCost: mocks.getModelCreditBaseCost }))

import { surroundHandlers } from "../surround.js"

const handler = surroundHandlers["generate-surround-continuation"]

function makeJob(data: Record<string, unknown>) {
  return {
    data: {
      jobId: "job-1",
      prompt: "p",
      referenceImageUrl: "https://r/ref.png",
      direction: "right",
      provider: "nano-banana",
      carriedFraction: 0.5,
      ...data,
    },
    updateProgress: vi.fn(),
  } as never
}
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false } as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.buildSurroundComposite.mockResolvedValue("https://r/composite.png")
  mocks.generateImage.mockResolvedValue({ url: "https://r/painted.png", providerUsed: "nano-banana", cost: 0.02, displayCost: 0.025 })
  mocks.harmonizeSurround.mockResolvedValue("https://r/final.png")
  mocks.shouldSaveJobResult.mockResolvedValue(true)
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.editImage.mockResolvedValue({ url: "https://r/refined.png", cost: 0.01 })
  mocks.getModelCreditBaseCost.mockResolvedValue({ creditCost: 1 })
})

describe("generate-surround-continuation handler", () => {
  it("no refine: harmonizes the painted output and commits (never refunds)", async () => {
    await handler(makeJob({}), ctx)
    expect(mocks.editImage).not.toHaveBeenCalled()
    expect(mocks.harmonizeSurround).toHaveBeenCalledWith(expect.objectContaining({ paintedUrl: "https://r/painted.png" }))
    expect(mocks.commitJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.refundSurroundRefineAddon).not.toHaveBeenCalled()
    expect(mocks.autoAttachLocationAsset).toHaveBeenCalledWith(expect.objectContaining({ url: "https://r/final.png" }))
  })

  it("refine success: harmonizes the REFINED output and commits base+addon (never refunds)", async () => {
    await handler(makeJob({ refine: true, refineProvider: "topaz-image-upscale" }), ctx)
    expect(mocks.editImage).toHaveBeenCalledWith("https://r/painted.png", "topaz-image-upscale")
    expect(mocks.harmonizeSurround).toHaveBeenCalledWith(expect.objectContaining({ paintedUrl: "https://r/refined.png" }))
    expect(mocks.commitJobCredits).toHaveBeenCalledTimes(1)
    expect(mocks.refundSurroundRefineAddon).not.toHaveBeenCalled()
  })

  it("refine failure: keeps the un-refined output, refunds the addon, does NOT commit", async () => {
    mocks.editImage.mockRejectedValueOnce(new Error("KIE upscale failed"))
    await handler(makeJob({ refine: true, refineProvider: "recraft-upscale" }), ctx)
    // the un-refined painted output flows into harmonize (carried byte-exact preserved)
    expect(mocks.harmonizeSurround).toHaveBeenCalledWith(expect.objectContaining({ paintedUrl: "https://r/painted.png" }))
    // addon refunded (base only committed inside it); commitJobCredits NOT called
    expect(mocks.refundSurroundRefineAddon).toHaveBeenCalledWith("job-1", "log-1", 1)
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
    // result is still delivered + attached
    expect(mocks.markJobCompleted).toHaveBeenCalled()
    expect(mocks.autoAttachLocationAsset).toHaveBeenCalled()
  })

  it("resolves the per-direction carried fraction (tilt up → 0.12) when the payload omits it", async () => {
    await handler(makeJob({ direction: "up", carriedFraction: undefined }), ctx)
    expect(mocks.buildSurroundComposite).toHaveBeenCalledWith(expect.objectContaining({ direction: "up", carriedFraction: 0.12 }))
  })
})
