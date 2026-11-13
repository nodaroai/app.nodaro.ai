import { describe, it, expect, vi, beforeEach } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CHARACTER_ASPECT_OPTIONS } from "@nodaro/shared/entities"
import { IMAGE_ASPECT_RATIO_VALUES } from "@nodaro/shared/models"

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

  it("checks Seedream 5.5's ratio, against the edit the composite reaches", async () => {
    const sent = () => (mocks.generateImage.mock.calls.at(-1)?.[3] as Record<string, unknown> | undefined)?.aspect_ratio
    // The composite always goes, so Seedream 5.5 runs on its edit, which takes "auto"
    // (its text-to-image model does not, and would have turned it into 1:1).
    await handler(makeJob({ provider: "seedream-5-5", aspectRatio: "auto" }), ctx)
    expect(sent()).toBe("auto")
    await handler(makeJob({ provider: "seedream-5-5", aspectRatio: "4:5" }), ctx)
    expect(sent()).toBe("3:4")
    await handler(makeJob({ provider: "seedream-5-5", aspectRatio: "21:9" }), ctx)
    expect(sent()).toBe("21:9")
    await handler(makeJob({ provider: "seedream-5-5" }), ctx)
    expect(mocks.generateImage.mock.calls.at(-1)?.[3]).toBeUndefined()
  })

  it("checks FLUX 3 Klein's ratio against its edit, which the composite reaches", async () => {
    const sent = () => (mocks.generateImage.mock.calls.at(-1)?.[3] as Record<string, unknown> | undefined)?.aspect_ratio
    await handler(makeJob({ provider: "flux-3-klein", aspectRatio: "auto" }), ctx)
    expect(sent()).toBe("auto")
    await handler(makeJob({ provider: "flux-3-klein", aspectRatio: "4:5" }), ctx)
    expect(sent()).toBe("3:4")
    await handler(makeJob({ provider: "flux-3-klein", aspectRatio: "9:21" }), ctx)
    expect(sent()).toBe("9:21")
  })

  it("sends every other model's ratio exactly as it came (a catalog list is not what the provider refuses)", async () => {
    // Every ratio the surround route takes, the Scene panel's, every ratio the routes
    // know, and "auto": GPT Image 2 renders 21:9 and 4:5 although its list omits them.
    const sendable = [...new Set(["auto", "16:9", "9:16", "1:1", "4:3", "21:9", "4:5", ...CHARACTER_ASPECT_OPTIONS, ...IMAGE_ASPECT_RATIO_VALUES])]
    const sent = () => (mocks.generateImage.mock.calls.at(-1)?.[3] as Record<string, unknown> | undefined)?.aspect_ratio
    const models = Object.values(MODEL_CATALOG).filter((m) => m.kind === "image" && !m.strictAspectRatios)
    expect(models.length).toBeGreaterThan(30)
    for (const m of models) {
      for (const ratio of sendable) {
        await handler(makeJob({ provider: m.id, aspectRatio: ratio }), ctx)
        expect(sent(), `${m.id} ${ratio}`).toBe(ratio)
      }
    }
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
