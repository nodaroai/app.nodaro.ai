import { describe, it, expect } from "vitest"
import { imageFormatBody } from "../_image-format-args.js"

describe("the image tools' format arguments, as the routes' body", () => {
  it("a format in any case, jpg as jpeg; an unknown one is left out", () => {
    expect(imageFormatBody({ output_format: "PNG" })).toEqual({ outputFormat: "png" })
    expect(imageFormatBody({ output_format: " jpg " })).toEqual({ outputFormat: "jpeg" })
    expect(imageFormatBody({ output_format: "webp" })).toEqual({ outputFormat: "webp" })
    expect(imageFormatBody({ output_format: "tiff" })).toEqual({})
    expect(imageFormatBody({})).toEqual({})
  })

  it("a GIF's frames and speed, moved inside their range, only with a GIF", () => {
    expect(imageFormatBody({ output_format: "gif", gif_frames: 40, gif_frame_duration_ms: 155 })).toEqual({ outputFormat: "gif", gifFrames: 16, gifFrameDurationMs: 160 })
    expect(imageFormatBody({ output_format: "gif", gif_frames: 0.4, gif_frame_duration_ms: 1 })).toEqual({ outputFormat: "gif", gifFrames: 2, gifFrameDurationMs: 20 })
    expect(imageFormatBody({ output_format: "gif" })).toEqual({ outputFormat: "gif" })
    expect(imageFormatBody({ output_format: "png", gif_frames: 9, gif_frame_duration_ms: 200 })).toEqual({ outputFormat: "png" })
  })

  it("an SVG's level, only with an SVG and only a level there is", () => {
    expect(imageFormatBody({ output_format: "svg", svg_level: "Detailed" })).toEqual({ outputFormat: "svg", svgLevel: "detailed" })
    expect(imageFormatBody({ output_format: "svg", svg_level: "ultra" })).toEqual({ outputFormat: "svg" })
    expect(imageFormatBody({ output_format: "gif", svg_level: "max" })).toEqual({ outputFormat: "gif" })
  })
})
