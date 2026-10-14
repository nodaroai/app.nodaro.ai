import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { freeVideoEntry } from "@nodaro/render-rules"
import {
  EXTEND_VIDEO_MODELS,
  VIDEO_GEN_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
} from "@/components/editor/config-panels/model-options"
import {
  lockedVideoDuration,
  lockedVideoModel,
  lockedVideoResolution,
  openVideoDuration,
  openVideoResolution,
} from "../free-video-locks"

const LIMITS = { enabled: true, maxSeconds: 4 }

describe("free-credit video locks in the editor", () => {
  it("every model a video picker offers is a model the rule can judge (no unseen alias such as Grok's t2v id)", () => {
    for (const m of [...VIDEO_GEN_MODELS, ...VIDEO_I2V_MODELS, ...VIDEO_T2V_MODELS, ...EXTEND_VIDEO_MODELS]) {
      expect(freeVideoEntry(m.value), m.value).not.toBeNull()
    }
  })

  it("Grok Imagine text-to-video is locked like its image-to-video twin", () => {
    expect(lockedVideoModel(LIMITS, "grok")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "grok-i2v")).not.toBeNull()
  })

  it("Kling, extension and upscaling are locked; the default model is open", () => {
    expect(lockedVideoModel(LIMITS, "kling-3.0")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "seedance-2-extend")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "topaz")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "seedance-2-fast")).toBeNull()
  })

  it("no limits (the account paid) locks nothing", () => {
    expect(lockedVideoModel(null, "kling-3.0")).toBeNull()
    expect(lockedVideoDuration(null, "seedance-2-fast", 10)).toBeNull()
    expect(lockedVideoResolution(null, "seedance-2-fast", "720p")).toBeNull()
  })

  it("a fail-safe writes the first OPEN value: Wan 3.0 gets 480p / 4 s, not its 720p / 5 s default", () => {
    const res = MODEL_CATALOG["wan-3"]!.resolutions ?? []
    const durs = MODEL_CATALOG["wan-3"]!.durations ?? []
    expect(openVideoResolution(LIMITS, "wan-3", ["720p", ...res])).toBe("480p")
    expect(openVideoDuration(LIMITS, "wan-3", [5, ...durs])).toBeLessThanOrEqual(4)
    expect(openVideoResolution(LIMITS, "minimax-h3", ["2K", "768P"])).toBe("768P")
  })

  it("without limits the fail-safe keeps its own first choice", () => {
    expect(openVideoResolution(null, "wan-3", ["720p", "480p"])).toBe("720p")
    expect(openVideoDuration(null, "wan-3", [5, 2])).toBe(5)
  })
})
