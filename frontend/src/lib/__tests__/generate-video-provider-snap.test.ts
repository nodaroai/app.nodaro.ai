import { describe, it, expect } from "vitest"
import { generateVideoProviderSnap } from "../generate-video-provider-snap"
import {
  VIDEO_GEN_MODELS,
  VIDEO_DURATION_OPTIONS,
  VIDEO_FPS_OPTIONS,
  getAspectRatiosForVideoModel,
  getVideoResolutionOptions,
} from "@/components/editor/config-panels/model-options"
import { isSeedanceDraftCapable } from "@nodaro/shared/model-catalog"
import { supportsReferenceTaskType } from "@nodaro/shared/models"

/** Stale states a node can carry from ANOTHER model (or an import / agent write). */
const STALE: ReadonlyArray<Record<string, unknown>> = [
  { resolution: "480p", aspectRatio: "21:9", duration: 4, draft: true, referenceTaskType: "edit" },
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
        if (!supportsReferenceTaskType(provider)) expect(after.referenceTaskType, `${provider} referenceTaskType`).toBeUndefined()
      }
    })
  }

  it("Gemini Omni Flash 1.2 opens on 8s at 720p, never its 360p first tier", () => {
    expect(generateVideoProviderSnap({}, "gemini-omni-flash-1-2")).toMatchObject({ duration: 8, resolution: "720p" })
  })

  it("PixVerse V6 Max opens on 5s at 720p, never its 1s / 360p first entries", () => {
    expect(generateVideoProviderSnap({}, "pixverse-v6-max")).toMatchObject({ duration: 5, resolution: "720p" })
    // A value it offers is kept; a stale one is moved onto what it renders.
    expect(generateVideoProviderSnap({ resolution: "540p", duration: 9 }, "pixverse-v6-max")).toEqual({})
    expect(generateVideoProviderSnap({ resolution: "4k", duration: 9 }, "pixverse-v6-max")).toMatchObject({ resolution: "720p" })
    // A ratio the text-to-video endpoint does not take is snapped; 21:9 and 2:3 are kept.
    expect(generateVideoProviderSnap({ resolution: "720p", duration: 5, aspectRatio: "21:9" }, "pixverse-v6-max")).toEqual({})
    expect(generateVideoProviderSnap({ resolution: "720p", duration: 5, aspectRatio: "2:3" }, "pixverse-v6-max")).toEqual({})
    expect(generateVideoProviderSnap({ resolution: "720p", duration: 5, aspectRatio: "adaptive" }, "pixverse-v6-max")).toMatchObject({ aspectRatio: "16:9" })
  })

  it("narrows a 15 s source trim for the Omni models that allow 10 s, and only then", () => {
    expect(generateVideoProviderSnap({ videoTrimStart: 2, videoTrimEnd: 17 }, "gemini-omni-flash")).toMatchObject({ videoTrimEnd: 12 })
    expect(generateVideoProviderSnap({ videoTrimStart: 2, videoTrimEnd: 17 }, "gemini-omni-flash-1-2")).not.toHaveProperty("videoTrimEnd")
    expect(generateVideoProviderSnap({ videoTrimStart: 2, videoTrimEnd: 8 }, "gemini-omni-flash")).not.toHaveProperty("videoTrimEnd")
  })

  it("is a no-op on a node that already fits", () => {
    expect(generateVideoProviderSnap({ resolution: "720p", aspectRatio: "16:9", duration: 8 }, "seedance-2-5")).toEqual({})
  })

  it("MiniMax H3 takes 480p onto its 2K default", () => {
    expect(generateVideoProviderSnap({ resolution: "480p" }, "minimax-h3").resolution).toBe("2K")
  })

  // Seedance 2.5's reference task type: a model that takes none clears it, so a
  // stale Edit never rides a later switch back unnoticed.
  it("clears a reference task type when the new model takes none", () => {
    const snap = generateVideoProviderSnap({ resolution: "720p", aspectRatio: "16:9", duration: 5, referenceTaskType: "edit" }, "kling-3.0")
    expect(snap).toHaveProperty("referenceTaskType")
    expect(snap.referenceTaskType).toBeUndefined()
  })

  it("keeps a reference task type on a model that takes it", () => {
    expect(generateVideoProviderSnap({ resolution: "720p", aspectRatio: "16:9", duration: 8, referenceTaskType: "edit" }, "seedance-2-5")).toEqual({})
  })
})

/**
 * Under the free-credit video limits a fail-safe writes an OPEN value — never
 * one the run would refuse (the rule #2246 gave the panel; the strip shares it).
 */
describe("generateVideoProviderSnap — free-credit limits", () => {
  const LIMITS = { enabled: true, maxSeconds: 4 }
  it("Wan 3.0's unset defaults land on open values, not 5 s / 720p", async () => {
    const { lockedVideoDuration, lockedVideoResolution } = await import("@/lib/free-video-locks")
    const snap = generateVideoProviderSnap({}, "wan-3", LIMITS)
    expect(lockedVideoDuration(LIMITS, "wan-3", snap.duration as number)).toBeNull()
    expect(lockedVideoResolution(LIMITS, "wan-3", snap.resolution as string)).toBeNull()
  })
  it("without limits the defaults are unchanged", () => {
    expect(generateVideoProviderSnap({}, "wan-3")).toMatchObject({ duration: 5, resolution: "720p" })
  })
  it("Vidu Q4 persists its declared 5 s / 720p defaults, never the 3 s / 540p first rungs", () => {
    expect(generateVideoProviderSnap({}, "vidu-q4")).toMatchObject({ duration: 5, resolution: "720p" })
    // A stale resolution from another model snaps to the declared 720p; a stale
    // off-menu duration takes the generic first-rung snap (Wan 3.0 parity) —
    // either way the persisted value is the one the badge quotes and the run bills.
    expect(generateVideoProviderSnap({ resolution: "480p", duration: 30 }, "vidu-q4")).toMatchObject({ resolution: "720p", duration: 3 })
    // A legal value is left alone, and no aspect ratio is invented.
    const kept = generateVideoProviderSnap({ resolution: "2k", duration: 9 }, "vidu-q4")
    expect(kept).not.toHaveProperty("resolution")
    expect(kept).not.toHaveProperty("duration")
    expect(kept).not.toHaveProperty("aspectRatio")
  })
})
