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

// S8: the color-transfer/composite engine no longer lives in this repo
// (extracted to @nodaroai/cloud-plugins) — `createSurroundHandlers` takes it
// as an injected `PluginSurroundEngine`, so there's no module path left to
// vi.mock for it. A plain stub object stands in for the plugin.
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

import { createSurroundHandlers } from "../surround.js"
import type { PluginSurroundEngine } from "@/lib/private-plugins/types.js"

const stubEngine: PluginSurroundEngine = {
  buildSurroundComposite: mocks.buildSurroundComposite,
  harmonizeSurround: mocks.harmonizeSurround,
}

const handler = createSurroundHandlers(stubEngine)["generate-surround-continuation"]

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

// S8: when no engine is loaded (community/business, or cloud with
// PRIVATE_MODULES=optional and the plugin unavailable), createSurroundHandlers
// must return a defensive stub rather than crash on an undefined import.
describe("createSurroundHandlers(undefined) — engine not loaded", () => {
  it("exposes exactly the generate-surround-continuation key", () => {
    expect(Object.keys(createSurroundHandlers(undefined))).toEqual(["generate-surround-continuation"])
  })

  it("throws a clear, actionable error instead of touching any dependency", async () => {
    const stubHandler = createSurroundHandlers(undefined)["generate-surround-continuation"]
    await expect(stubHandler(makeJob({}), ctx)).rejects.toThrow(
      "generate-surround-continuation: surround engine not loaded (requires @nodaroai/cloud-plugins on Cloud edition)",
    )
    // Fails fast — no provider call, no credit commit, no location attach.
    expect(mocks.generateImage).not.toHaveBeenCalled()
    expect(mocks.buildSurroundComposite).not.toHaveBeenCalled()
    expect(mocks.harmonizeSurround).not.toHaveBeenCalled()
    expect(mocks.commitJobCredits).not.toHaveBeenCalled()
    expect(mocks.autoAttachLocationAsset).not.toHaveBeenCalled()
  })
})
