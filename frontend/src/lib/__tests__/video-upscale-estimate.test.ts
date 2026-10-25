/**
 * Video Upscale on Topaz is metered: every estimate quotes its one-unit row
 * (`topaz-video:per-unit`) × the Topaz units its target renders at the length
 * the graph gives — `topazVideoEstimateUnits`, the rule the server's run
 * estimate reads — and marks the figure an estimate (≈). Every other provider
 * keeps its flat row, one unit, no marker.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-model-credit-cost", () => ({
  isModelRefused: () => false,
  isModelEstimate: () => false,
  refusedModelMessage: () => undefined,
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: vi.fn(async () => {}),
  isModelUnpriced: () => false,
  useModelCreditCost: vi.fn(),
  useModelCredits: () => 0,
  fetchModelCredits: vi.fn(),
}))

import { TOPAZ_VIDEO_UNIT_CREDIT_ID, topazVideoEstimateUnits } from "@nodaro/render-rules"
import { topazVideoQuotedResolution, videoUpscalePricingUnits } from "@/lib/video-utility-estimate"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { estimateRunCreditLines } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getExactPricingUnits, NO_RERUNS } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const upscale = (data: Record<string, unknown>): WorkflowNode =>
  ({ id: "x", type: "video-upscale", position: { x: 0, y: 0 }, data: { label: "x", ...data } }) as WorkflowNode
const upload = (sec: number): WorkflowNode =>
  ({ id: "v", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "v", url: "https://m.test/v.mp4", duration: sec, videoDurationSec: sec } }) as WorkflowNode
const wire: WorkflowEdge = { id: "v-x", source: "v", target: "x", targetHandle: "video" } as WorkflowEdge

describe("Topaz Video Upscale units", () => {
  it("its target at the wired clip's length: 8 s to 4K60 is 40 units", () => {
    const x = upscale({ provider: "topaz", targetResolution: "4k", targetFps: 60 })
    expect(videoUpscalePricingUnits(x, [x, upload(8)], [wire])).toBe(40)
    expect(getExactPricingUnits(x, [x, upload(8)], [wire], NO_RERUNS)).toBe(40)
  })

  it("nothing wired: 1080p at 30 fps over the 10 s fallback", () => {
    const x = upscale({ provider: "topaz", targetResolution: "1080p" })
    expect(videoUpscalePricingUnits(x, [x], [])).toBe(topazVideoEstimateUnits({}))
    expect(videoUpscalePricingUnits(x, [x], [])).toBe(7)
  })

  it("a saved node with only the old factor quotes the default target, as the server's estimate does", () => {
    const x = upscale({ provider: "topaz", upscaleFactor: "4" })
    expect(videoUpscalePricingUnits(x, [x], [])).toBe(7)
  })

  describe("a saved node with only the old factor, over a wired clip whose size is known", () => {
    // A clip the editor has measured: its result row records the pixel size.
    const sized = (width: number, height: number, sec = 8): WorkflowNode =>
      ({
        id: "v",
        type: "upload-video",
        position: { x: 0, y: 0 },
        data: {
          label: "v",
          url: "https://m.test/v.mp4",
          duration: sec,
          videoDurationSec: sec,
          generatedResults: [{ url: "https://m.test/v.mp4", jobId: "u", timestamp: "t", width, height, duration: sec }],
        },
      }) as WorkflowNode
    const units = (resolution: "720p" | "1080p" | "4k") => topazVideoEstimateUnits({ resolution, durationSec: 8 })

    it("1280×720 at 2× renders at 1080p, and is quoted there", () => {
      const x = upscale({ provider: "topaz", upscaleFactor: "2" })
      expect(topazVideoQuotedResolution(x, [x, sized(1280, 720)], [wire])).toBe("1080p")
      expect(videoUpscalePricingUnits(x, [x, sized(1280, 720)], [wire])).toBe(units("1080p"))
    })

    it("1920×1080 at 2× renders at 4K, and is quoted there", () => {
      const x = upscale({ provider: "topaz", upscaleFactor: "2" })
      expect(topazVideoQuotedResolution(x, [x, sized(1920, 1080)], [wire])).toBe("4k")
      expect(videoUpscalePricingUnits(x, [x, sized(1920, 1080)], [wire])).toBe(units("4k"))
      expect(getExactPricingUnits(x, [x, sized(1920, 1080)], [wire], NO_RERUNS)).toBe(units("4k"))
      expect(units("4k")).toBeGreaterThan(units("1080p"))
    })

    it("a portrait clip maps by its short side: 720×1280 at 4× → 4K", () => {
      const x = upscale({ provider: "topaz", upscaleFactor: "4" })
      expect(topazVideoQuotedResolution(x, [x, sized(720, 1280)], [wire])).toBe("4k")
    })

    it("an upload with no result row reads its upload metadata, while that upload is the file it hands on", () => {
      const x = upscale({ provider: "topaz", upscaleFactor: "2" })
      const meta = (extra: Record<string, unknown>): WorkflowNode =>
        ({ id: "v", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "v", url: "https://m.test/v.mp4", duration: 8, metadata: { width: 1920, height: 1080 }, ...extra } }) as WorkflowNode
      expect(topazVideoQuotedResolution(x, [x, meta({})], [wire])).toBe("4k")
      expect(topazVideoQuotedResolution(x, [x, meta({ externalUrl: "https://m.test/other.mp4" })], [wire])).toBe("1080p")
    })

    it("a target, once set, wins over the factor and the size", () => {
      const x = upscale({ provider: "topaz", targetResolution: "720p", upscaleFactor: "4" })
      expect(topazVideoQuotedResolution(x, [x, sized(1920, 1080)], [wire])).toBe("720p")
    })
  })

  it("a saved node with only the old factor and a clip of unknown size quotes 1080p", () => {
    const x = upscale({ provider: "topaz", upscaleFactor: "2" })
    // A length but no measured size (and a row for a different file): not a size.
    const v = { ...upload(8), data: { ...upload(8).data, aspectRatio: "16:9", generatedResults: [{ url: "https://m.test/old.mp4", jobId: "u", timestamp: "t", width: 1920, height: 1080 }] } } as WorkflowNode
    expect(topazVideoQuotedResolution(x, [x, v], [wire])).toBe("1080p")
    expect(videoUpscalePricingUnits(x, [x, v], [wire])).toBe(topazVideoEstimateUnits({ resolution: "1080p", durationSec: 8 }))
  })

  it("a frame rate out of range is quoted clamped (120 → 60)", () => {
    const at120 = upscale({ provider: "topaz", targetResolution: "4k", targetFps: 120 })
    const at60 = upscale({ provider: "topaz", targetResolution: "4k", targetFps: 60 })
    expect(videoUpscalePricingUnits(at120, [at120, upload(8)], [wire])).toBe(videoUpscalePricingUnits(at60, [at60, upload(8)], [wire]))
  })

  it("a node naming no provider runs — and is quoted — on Topaz", () => {
    const x = upscale({ targetResolution: "720p" })
    expect(getModelIdentifier(x, [], [x])).toBe(TOPAZ_VIDEO_UNIT_CREDIT_ID)
    expect(videoUpscalePricingUnits(x, [x], [])).toBe(topazVideoEstimateUnits({ resolution: "720p" }))
  })

  it("VEO keeps its flat row: one unit", () => {
    const x = upscale({ provider: "veo-4k", targetResolution: "4k" })
    expect(getModelIdentifier(x, [], [x])).toBe("veo-4k")
    expect(videoUpscalePricingUnits(x, [x, upload(8)], [wire])).toBe(1)
  })
})

describe("the run estimate", () => {
  it("prices Topaz at its unit row × the units, marked as an estimate", () => {
    const x = upscale({ provider: "topaz", targetResolution: "4k", targetFps: 60 })
    const prices: Record<string, number> = { [TOPAZ_VIDEO_UNIT_CREDIT_ID]: 45 }
    const [line] = estimateRunCreditLines([x], [x, upload(8)], [wire], (id) => prices[id])
    expect(line!.credits).toBe(45 * 40)
    expect(line!.estimate).toBe(true)
  })

  it("does not mark a VEO upscale", () => {
    const x = upscale({ provider: "veo-1080p" })
    const [line] = estimateRunCreditLines([x], [x], [], (id) => (id === "veo-1080p" ? 3 : undefined))
    expect(line!.credits).toBe(3)
    expect(line!.estimate).toBeUndefined()
  })
})
