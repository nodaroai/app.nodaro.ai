import { describe, it, expect } from "vitest"
import {
  LTX_2_5_DEFAULT_PROMPT,
  LTX_2_5_IMAGE_TO_VIDEO_FIELDS,
  LTX_2_5_TEXT_TO_VIDEO_FIELDS,
  buildLtx25Request,
  ltx25Endpoint,
  ltx25Seed,
  resolveLtx25Aspect,
} from "../ltx-2-5.js"

/** LTX 2.5's request bodies: an allow-list per endpoint, picked by the start frame. */
describe("buildLtx25Request", () => {
  it("a start frame → the tier's image endpoint, its keys within the image allow-list", () => {
    const { model, input } = buildLtx25Request({ provider: "ltx-2.5-fast", prompt: "p", durationSec: 6, startFrameUrl: "https://x/a.png", aspectRatio: "9:16", fps: 48, seed: 7 })
    expect(model).toBe("ltx/2-5-fast-image-to-video")
    expect(Object.keys(input).every((k) => (LTX_2_5_IMAGE_TO_VIDEO_FIELDS as readonly string[]).includes(k))).toBe(true)
    expect(input).toEqual({ prompt: "p", image_url: "https://x/a.png", resolution: "1080p", fps: 48, duration: 6, seed: 7 })
  })

  it("no start frame → the tier's text endpoint, with an aspect ratio", () => {
    const { model, input } = buildLtx25Request({ provider: "ltx-2.5-pro", prompt: "p", durationSec: 10, aspectRatio: "3:2", resolution: "720p" })
    expect(model).toBe("ltx/2-5-pro-text-to-video")
    expect(Object.keys(input).every((k) => (LTX_2_5_TEXT_TO_VIDEO_FIELDS as readonly string[]).includes(k))).toBe(true)
    expect(input).toEqual({ prompt: "p", resolution: "720p", fps: 24, duration: 10, aspect_ratio: "3:2" })
  })

  it("holds Fast's long-clip limit on the wire: 1440p or 48 / 50 fps send 10 s at most", () => {
    expect(buildLtx25Request({ provider: "ltx-2.5-fast", prompt: "p", durationSec: 20, resolution: "1440p" }).input.duration).toBe(10)
    expect(buildLtx25Request({ provider: "ltx-2.5-fast", prompt: "p", durationSec: 14, fps: 50 }).input.duration).toBe(10)
    expect(buildLtx25Request({ provider: "ltx-2.5-fast", prompt: "p", durationSec: 14, fps: 25 }).input.duration).toBe(14)
  })

  it("an empty prompt is sent as the default motion text; an @image_N mention loses its @", () => {
    expect(buildLtx25Request({ provider: "ltx-2.5-fast", prompt: "  ", durationSec: 6 }).input.prompt).toBe(LTX_2_5_DEFAULT_PROMPT)
    expect(buildLtx25Request({ provider: "ltx-2.5-fast", prompt: "the woman from @image_1 waves", durationSec: 6 }).input.prompt).not.toContain("@image_1")
  })

  it("refuses an id that is not LTX 2.5 (LTX 2.3 runs on its own provider)", () => {
    expect(() => buildLtx25Request({ provider: "ltx-2.3-fast" as never, prompt: "p", durationSec: 6 })).toThrow()
  })
})

describe("LTX 2.5 request pieces", () => {
  it("endpoints per tier", () => {
    expect(ltx25Endpoint("ltx-2.5-fast", true)).toBe("ltx/2-5-fast-image-to-video")
    expect(ltx25Endpoint("ltx-2.5-fast", false)).toBe("ltx/2-5-fast-text-to-video")
    expect(ltx25Endpoint("ltx-2.5-pro", true)).toBe("ltx/2-5-pro-image-to-video")
    expect(ltx25Endpoint("ltx-2.5-pro", false)).toBe("ltx/2-5-pro-text-to-video")
  })

  it("a ratio it does not take moves to the nearest one; none or a token without a shape is 16:9", () => {
    expect(resolveLtx25Aspect("ltx-2.5-fast", "2:3")).toBe("2:3")
    expect(resolveLtx25Aspect("ltx-2.5-fast", "21:9")).toBe("16:9")
    expect(resolveLtx25Aspect("ltx-2.5-fast", "3:4")).toBe("2:3")
    expect(resolveLtx25Aspect("ltx-2.5-fast", "auto")).toBe("16:9")
    expect(resolveLtx25Aspect("ltx-2.5-fast", undefined)).toBe("16:9")
  })

  it("a seed is a whole number 0-2147483647, else left out", () => {
    expect(ltx25Seed(0)).toBe(0)
    expect(ltx25Seed(2147483647)).toBe(2147483647)
    expect(ltx25Seed(-1)).toBeUndefined()
    expect(ltx25Seed(1.5)).toBeUndefined()
    expect(ltx25Seed("5")).toBeUndefined()
  })
})
