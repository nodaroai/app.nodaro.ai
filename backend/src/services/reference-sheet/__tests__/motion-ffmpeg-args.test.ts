import { describe, it, expect } from "vitest"
import { buildMotionFfmpegArgs } from "../motion-compositor.js"
import type { Slot } from "../types.js"

const slot = (x: number, y: number, w = 100, h = 100): Slot => ({ x, y, w, h })

describe("buildMotionFfmpegArgs", () => {
  it("loops the bg, scales+overlays each clip at its slot, bounds to duration", () => {
    const args = buildMotionFfmpegArgs("/t/bg.png", [
      { path: "/t/c0.mp4", slot: slot(10, 20) },
      { path: "/t/c1.mp4", slot: slot(120, 20) },
    ], 5, "/t/out.mp4")
    const s = args.join(" ")
    expect(s).toContain("-loop 1 -t 5 -i /t/bg.png")
    expect(s).toContain("-i /t/c0.mp4")
    expect(s).toContain("-i /t/c1.mp4")
    expect(s).toContain("overlay=10:20")
    expect(s).toContain("overlay=120:20")
    expect(s).toContain("force_original_aspect_ratio=increase")
    expect(s).toContain("[outv]")
    expect(args).toContain("-an")
    expect(args[args.length - 1]).toBe("/t/out.mp4")
  })
  it("even-rounds odd slot dimensions for yuv420p", () => {
    const args = buildMotionFfmpegArgs("/t/bg.png", [{ path: "/t/c.mp4", slot: slot(0, 0, 101, 99) }], 3, "/t/o.mp4")
    expect(args.join(" ")).toContain("scale=100:98")
  })
  it("with zero clips, outputs the static bg as a video (no filter_complex)", () => {
    const args = buildMotionFfmpegArgs("/t/bg.png", [], 4, "/t/o.mp4")
    expect(args.join(" ")).not.toContain("-filter_complex")
    expect(args.join(" ")).toContain("-map 0:v")
  })
})
