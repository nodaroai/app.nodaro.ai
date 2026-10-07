import { describe, it, expect } from "vitest"
import { buildEffectiveEdl, effectiveRenderBasis } from "@nodaro/render-rules"
import { normalizeEdl } from "@nodaro/shared"
import { isFreshTake, renderSettingsBasisOf, showsStaleTake } from "../staleness"

const edl = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "cam" }, { id: "s1", inMs: 2000, outMs: 3000, video: "cam" }],
})
const VIDEO = { output: "video", crossfadeMs: 0 } as const
const P = "0123456789abcdef"
const R = "fedcba9876543210"

describe("the render's own settings, as a take is stamped with them (R19 a)", () => {
  it("is what the route stamps: the effective EDL's sources with the node's settings", () => {
    const render = { edl: JSON.stringify(edl), sources: ["https://cdn.test/other.mp4"] }
    const expected = effectiveRenderBasis(buildEffectiveEdl(edl, { crossfadeMs: 0, sourceOverrides: render.sources }), VIDEO)
    expect(renderSettingsBasisOf(render, VIDEO)).toBe(expected)
  })

  it("changes with the crossfade, the output and a source override", () => {
    const render = { edl, sources: [] }
    const base = renderSettingsBasisOf(render, VIDEO)
    expect(renderSettingsBasisOf(render, { ...VIDEO, crossfadeMs: 200 })).not.toBe(base)
    expect(renderSettingsBasisOf(render, { ...VIDEO, output: "audio" })).not.toBe(base)
    expect(renderSettingsBasisOf({ edl, sources: ["https://cdn.test/other.mp4"] }, VIDEO)).not.toBe(base)
  })

  it("is unknown with no EDL, or one that does not parse", () => {
    expect(renderSettingsBasisOf(undefined, VIDEO)).toBeUndefined()
    expect(renderSettingsBasisOf({ edl: undefined, sources: [] }, VIDEO)).toBeUndefined()
    expect(renderSettingsBasisOf({ edl: "{not json", sources: [] }, VIDEO)).toBeUndefined()
  })
})

describe("is a take fresh? (R1, R19)", () => {
  const now = { planBasis: P, renderBasis: R }

  it("fresh when both of its stamps equal the render's now", () => {
    expect(isFreshTake({ planBasis: P, renderBasis: R }, now)).toBe(true)
  })

  it("stale when either differs: the plan changed, or the render's settings did", () => {
    expect(isFreshTake({ planBasis: R, renderBasis: R }, now)).toBe(false)
    expect(isFreshTake({ planBasis: P, renderBasis: P }, now)).toBe(false)
  })

  it("unknown without a take, a stamp it needs, or a current basis", () => {
    expect(isFreshTake(undefined, now)).toBeUndefined()
    expect(isFreshTake({ planBasis: P }, now)).toBeUndefined()
    expect(isFreshTake({ renderBasis: R }, now)).toBeUndefined()
    expect(isFreshTake({ planBasis: P, renderBasis: R }, { renderBasis: R })).toBeUndefined()
  })
})

describe("the stale banner", () => {
  it("shows for a stale take", () => {
    expect(showsStaleTake(false, true, false)).toBe(true)
  })

  it("an unknown take reads stale only when the plan holds an applied edit (fails open)", () => {
    expect(showsStaleTake(undefined, true, true)).toBe(true)
    expect(showsStaleTake(undefined, true, false)).toBe(false)
  })

  it("never shows for a fresh take, or with no take at all", () => {
    expect(showsStaleTake(true, true, true)).toBe(false)
    expect(showsStaleTake(undefined, false, true)).toBe(false)
  })
})
