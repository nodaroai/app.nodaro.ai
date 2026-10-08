/**
 * The write-boundary guard for Speaker View nodes (SV4 a): what an agent writes
 * straight into workflow JSON is coerced into settings the renderer draws, never
 * rejected, so the run cannot fail after credits are reserved.
 */
import { describe, it, expect } from "vitest"
import { normalizeSpeakerViewNodes } from "../normalize-speaker-view-nodes.js"

const sv = (data: Record<string, unknown>, id = "sv") => ({ id, type: "speaker-view", data })

describe("normalizeSpeakerViewNodes", () => {
  it("snaps a layout the aspect rules out, to its twin", () => {
    const [n] = normalizeSpeakerViewNodes([sv({ layout: "side-by-side", targetAspect: "9:16" })])
    expect(n!.data).toMatchObject({ layout: "stacked", targetAspect: "9:16" })
    expect(normalizeSpeakerViewNodes([sv({ layout: "stacked", targetAspect: "16:9" })])[0]!.data).toMatchObject({ layout: "side-by-side" })
  })

  it("replaces unknown ids with defaults instead of rejecting", () => {
    const [n] = normalizeSpeakerViewNodes([sv({ layout: "carousel", switchType: "swirl", emphasisStyle: "glow", accentColor: "red", targetAspect: "21:9" })])
    expect(n!.data).toEqual({ layout: "auto", switchType: "cut", emphasisStyle: "none" })
  })

  it("returns a node that needs nothing by reference, and every other node type untouched", () => {
    const fine = sv({ layout: "grid", targetAspect: "16:9" })
    const other = { id: "g", type: "generate-image", data: { layout: "side-by-side", targetAspect: "9:16" } }
    const out = normalizeSpeakerViewNodes([fine, other])
    expect(out[0]).toBe(fine)
    expect(out[1]).toBe(other)
  })

  it("never mutates its input, and skips a node whose data is not an object", () => {
    const input = Object.freeze(sv({ layout: "side-by-side", targetAspect: "9:16" }))
    const out = normalizeSpeakerViewNodes([input])
    expect((input.data as { layout: string }).layout).toBe("side-by-side")
    expect(out[0]).not.toBe(input)
    const odd = { id: "x", type: "speaker-view", data: null }
    expect(normalizeSpeakerViewNodes([odd])[0]).toBe(odd)
  })
})
