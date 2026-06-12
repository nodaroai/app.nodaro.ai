import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  mockProbeVideoSource: vi.fn(),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  probeVideoSource: mocks.mockProbeVideoSource,
}))

import { closestAspectRatio, resolveSourceMatchedAspect } from "../source-matched-aspect.js"

const CANDIDATES = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const

describe("closestAspectRatio", () => {
  it("maps landscape / portrait / square exactly", () => {
    expect(closestAspectRatio(1920, 1080, CANDIDATES)).toBe("16:9")
    expect(closestAspectRatio(720, 1280, CANDIDATES)).toBe("9:16")
    expect(closestAspectRatio(1080, 1080, CANDIDATES)).toBe("1:1")
  })

  it("snaps off-catalog ratios to the nearest candidate (4:5 social crop → 3:4)", () => {
    expect(closestAspectRatio(1080, 1350, CANDIDATES)).toBe("3:4")
  })

  it("skips non-ratio candidates like VEO's 'Auto'", () => {
    expect(closestAspectRatio(1920, 1080, ["Auto", "16:9", "9:16"])).toBe("16:9")
  })

  it("returns undefined for degenerate dims or empty candidates", () => {
    expect(closestAspectRatio(0, 1080, CANDIDATES)).toBeUndefined()
    expect(closestAspectRatio(1920, 1080, [])).toBeUndefined()
  })
})

describe("resolveSourceMatchedAspect", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockProbeVideoSource.mockResolvedValue({ width: 720, height: 1280, durationSeconds: 4 })
  })

  it("native-adaptive providers get their token WITHOUT a probe round-trip", async () => {
    await expect(resolveSourceMatchedAspect("seedance-2", "https://cdn/x.mp4")).resolves.toBe("adaptive")
    await expect(resolveSourceMatchedAspect("seedance-2-fast", "https://cdn/x.mp4")).resolves.toBe("adaptive")
    expect(mocks.mockProbeVideoSource).not.toHaveBeenCalled()
  })

  it("fallback providers probe the source and snap to their catalog ratios", async () => {
    const result = await resolveSourceMatchedAspect("veo3", "https://cdn/x.mp4")
    expect(mocks.mockProbeVideoSource).toHaveBeenCalledWith("https://cdn/x.mp4")
    expect(result).toBe("9:16")
  })

  it("returns undefined for providers with no catalog aspect list (provider default applies)", async () => {
    await expect(resolveSourceMatchedAspect("kling-3.0", "https://cdn/x.mp4")).resolves.toBeUndefined()
  })

  it("probe failures propagate (pre-provider — job fails before billing)", async () => {
    mocks.mockProbeVideoSource.mockRejectedValue(new Error("ffprobe failed: 404"))
    await expect(resolveSourceMatchedAspect("veo3", "https://cdn/x.mp4")).rejects.toThrow("ffprobe")
  })
})
