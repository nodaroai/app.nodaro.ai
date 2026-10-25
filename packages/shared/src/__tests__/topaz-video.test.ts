import { describe, it, expect } from "vitest"
import { resolveTopazVideoTarget, topazVideoOutputSize, topazVideoResolutionNearest } from "../topaz-video.js"

const HD = { width: 1280, height: 720, fps: 24 }
const PORTRAIT_1080 = { width: 1080, height: 1920, fps: 30 }

describe("resolveTopazVideoTarget", () => {
  it("defaults to 1080p at the source's own frame rate", () => {
    expect(resolveTopazVideoTarget({ source: HD })).toEqual({ resolution: "1080p", fps: 24, adjustments: [] })
  })

  it("takes an explicit target as sent", () => {
    expect(resolveTopazVideoTarget({ targetResolution: "4k", targetFps: 60, source: HD })).toMatchObject({ resolution: "4k", fps: 60 })
  })

  it("clamps the frame rate into 15–60 and says so", () => {
    const r = resolveTopazVideoTarget({ targetResolution: "720p", targetFps: 120, source: HD })
    expect(r.fps).toBe(60)
    expect(r.adjustments).toHaveLength(1)
    expect(resolveTopazVideoTarget({ targetFps: 8 }).fps).toBe(15)
  })

  it("reads a string frame rate, and \"source\" as the source's rate", () => {
    expect(resolveTopazVideoTarget({ targetFps: "50", source: HD }).fps).toBe(50)
    expect(resolveTopazVideoTarget({ targetFps: "source", source: HD }).fps).toBe(24)
  })

  it("falls back to 30 fps when neither the caller nor the source names a rate", () => {
    expect(resolveTopazVideoTarget({ source: { width: 1280, height: 720 } }).fps).toBe(30)
    expect(resolveTopazVideoTarget({}).fps).toBe(30)
  })

  it("maps a legacy factor over the source's SHORT side, to the nearest target", () => {
    expect(resolveTopazVideoTarget({ upscaleFactor: "1", source: HD }).resolution).toBe("720p")
    expect(resolveTopazVideoTarget({ upscaleFactor: "2", source: HD }).resolution).toBe("1080p") // 1440 → 1080p
    expect(resolveTopazVideoTarget({ upscaleFactor: "4", source: HD }).resolution).toBe("4k") // 2880 → 4k
    expect(resolveTopazVideoTarget({ upscaleFactor: "2", source: { width: 640, height: 360 } }).resolution).toBe("720p")
    expect(resolveTopazVideoTarget({ upscaleFactor: "2", source: PORTRAIT_1080 }).resolution).toBe("4k") // 2160
    expect(resolveTopazVideoTarget({ upscaleFactor: "1", source: PORTRAIT_1080 }).resolution).toBe("1080p")
  })

  it("a valid target resolution beats a legacy factor", () => {
    expect(resolveTopazVideoTarget({ targetResolution: "720p", upscaleFactor: "4", source: HD }).resolution).toBe("720p")
  })

  it("a factor with no readable source, or an unknown target, lands on 1080p and says so", () => {
    const noSource = resolveTopazVideoTarget({ upscaleFactor: "4" })
    expect(noSource.resolution).toBe("1080p")
    expect(noSource.adjustments).toHaveLength(1)
    const unknown = resolveTopazVideoTarget({ targetResolution: "8k", source: HD })
    expect(unknown.resolution).toBe("1080p")
    expect(unknown.adjustments).toHaveLength(1)
  })
})

describe("topazVideoResolutionNearest", () => {
  it("is the target whose short side is nearest, 720p below and 4k above the range", () => {
    expect(topazVideoResolutionNearest(360)).toBe("720p")
    expect(topazVideoResolutionNearest(900)).toBe("1080p") // a tie takes the larger
    expect(topazVideoResolutionNearest(1440)).toBe("1080p")
    expect(topazVideoResolutionNearest(1621)).toBe("4k")
    expect(topazVideoResolutionNearest(5000)).toBe("4k")
  })
})

describe("topazVideoOutputSize", () => {
  it("keeps the source's orientation and aspect, the short side at the target", () => {
    expect(topazVideoOutputSize("1080p", HD)).toEqual({ width: 1920, height: 1080 })
    expect(topazVideoOutputSize("1080p", { width: 1072, height: 1928 })).toEqual({ width: 1080, height: 1942 })
    expect(topazVideoOutputSize("4k")).toEqual({ width: 3840, height: 2160 })
  })
})
