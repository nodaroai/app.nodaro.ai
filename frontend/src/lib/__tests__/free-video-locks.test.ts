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
    expect(lockedVideoModel(LIMITS, "seedance-2-5-extend")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "seedance-2-0-extend")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "topaz")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "seedance-2-fast")).toBeNull()
  })

  it("a model asked to extend is locked as an extension, even one that extends under its generation id (LTX 2.3 Pro)", () => {
    const extension = lockedVideoModel(LIMITS, "seedance-2-5-extend")
    // As a generation model LTX is locked only by its shortest clip (6 s): open once a free clip may be 10 s.
    const ROOMY = { enabled: true, maxSeconds: 10 }
    expect(lockedVideoModel(ROOMY, "ltx-2.3-pro")).toBeNull()
    expect(lockedVideoModel(ROOMY, "ltx-2.3-pro", { extend: true })).toBe(extension)
    expect(lockedVideoModel(LIMITS, "ltx-2.3-pro", { extend: true })).toBe(extension)
    expect(lockedVideoModel(null, "ltx-2.3-pro", { extend: true })).toBeNull()
  })

  it("Kling 4.0 Flash is the one open Kling model: its 3-4 s at 720p are open, longer is locked", () => {
    expect(lockedVideoModel(LIMITS, "kling-4-flash")).toBeNull()
    expect(lockedVideoModel(LIMITS, "kling-4")).not.toBeNull()
    expect(lockedVideoModel(LIMITS, "kling-4-keyframes")).not.toBeNull()
    expect(lockedVideoDuration(LIMITS, "kling-4-flash", 4)).toBeNull()
    expect(lockedVideoDuration(LIMITS, "kling-4-flash", 5)).not.toBeNull()
    expect(lockedVideoResolution(LIMITS, "kling-4-flash", "720p")).toBeNull()
    // Open as a generation model, still locked when asked to extend.
    expect(lockedVideoModel(LIMITS, "kling-4-flash", { extend: true })).toBe(lockedVideoModel(LIMITS, "seedance-2-5-extend"))
  })

  it("PixVerse V6 Max is open within the limits: 360p for 1-4 s, every other quality and length locked", () => {
    expect(lockedVideoModel(LIMITS, "pixverse-v6-max")).toBeNull()
    for (const d of [1, 2, 3, 4]) expect(lockedVideoDuration(LIMITS, "pixverse-v6-max", d), `${d}s`).toBeNull()
    expect(lockedVideoDuration(LIMITS, "pixverse-v6-max", 5)).not.toBeNull()
    expect(lockedVideoResolution(LIMITS, "pixverse-v6-max", "360p")).toBeNull()
    for (const r of ["540p", "720p", "1080p"]) expect(lockedVideoResolution(LIMITS, "pixverse-v6-max", r), r).not.toBeNull()
    // A snap on free credits lands on what is open, never the locked 720p default.
    expect(openVideoResolution(LIMITS, "pixverse-v6-max", ["720p", "360p", "540p", "720p", "1080p"])).toBe("360p")
    expect(openVideoDuration(LIMITS, "pixverse-v6-max", [5, 1, 2, 3, 4, 5])).toBe(1)
  })

  it("a length of 0 or below that is not Auto is the model's default (5 s on Flash, 8 s on Seedance 2 Fast): locked", () => {
    for (const d of [0, -2]) {
      expect(lockedVideoDuration(LIMITS, "kling-4-flash", d)).not.toBeNull()
      expect(lockedVideoDuration(LIMITS, "seedance-2-fast", d)).not.toBeNull()
    }
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
