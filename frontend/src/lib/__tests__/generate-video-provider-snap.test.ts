import { describe, it, expect } from "vitest"
import { generateVideoProviderSnap } from "../generate-video-provider-snap"
import {
  VIDEO_GEN_MODELS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FPS_OPTIONS,
  getAspectRatiosForVideoModel,
  getVideoResolutionOptions,
} from "@/components/editor/config-panels/model-options"
import { isSeedanceDraftCapable } from "@nodaro/shared"

/** Stale states a node can carry from ANOTHER model (or an import / agent write). */
const STALE: ReadonlyArray<Record<string, unknown>> = [
  { resolution: "480p", aspectRatio: "21:9", duration: 4, draft: true },
  { resolution: "2K", aspectRatio: "adaptive", duration: 30, fps: 50 },
  { resolution: "4k", aspectRatio: "Auto", duration: -1, fps: 24 },
  { resolution: "1080P", aspectRatio: "9:16", duration: 15, draft: false },
]

describe("generateVideoProviderSnap — every model ends on values it accepts", () => {
  for (const { value: provider } of VIDEO_GEN_MODELS) {
    it(provider, () => {
      for (const stale of STALE) {
        const after = { ...stale, ...generateVideoProviderSnap(stale, provider) }
        const res = getVideoResolutionOptions(provider)
        if (after.resolution !== undefined) expect(res?.map((o) => o.value), `${provider} resolution`).toContain(after.resolution)
        const ratios = getAspectRatiosForVideoModel(provider).map((o) => o.value)
        if (after.aspectRatio !== undefined) expect(ratios, `${provider} aspect`).toContain(after.aspectRatio)
        const durations = VIDEO_DURATION_OPTIONS[provider]?.map((o) => o.value)
        if (durations && after.duration !== undefined) expect(durations, `${provider} duration`).toContain(after.duration)
        const fps = VIDEO_FPS_OPTIONS[provider]?.map((o) => o.value)
        if (after.fps !== undefined) expect(fps, `${provider} fps`).toContain(after.fps)
        if (!isSeedanceDraftCapable(provider)) expect(after.draft, `${provider} draft`).toBeUndefined()
      }
    })
  }

  it("is a no-op on a node that already fits", () => {
    expect(generateVideoProviderSnap({ resolution: "720p", aspectRatio: "16:9", duration: 8 }, "seedance-2-5")).toEqual({})
  })

  it("MiniMax H3 takes 480p onto its 2K default", () => {
    expect(generateVideoProviderSnap({ resolution: "480p" }, "minimax-h3").resolution).toBe("2K")
  })
})
