import { describe, it, expect } from "vitest"
import {
  windowAnalysisSchema, videoAnalysisResultSchema,
  deriveSlotRefs, rewriteSlotTokens, unwrapUnresolvedTokens,
  renderAnalyzedScene, isOversizedScene, aspectRatioFromDims,
  type EntitySlot,
} from "../video-analysis.js"

const slot: EntitySlot = { slotId: "hero", label: "Protagonist", source: "wired-character", role: "person", description: "tan man, mustache, black tee" }
const baseScene = { startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "slow push-in", visual: "{slot:hero} juggles a ball", audio: [{ mode: "speech" as const, content: "As a kid…", voice: "male, warm" }] }

describe("windowAnalysisSchema", () => {
  it("accepts a zero-scene window (quiet footage is a VALID result)", () => {
    expect(windowAnalysisSchema.safeParse({ slots: [], scenes: [] }).success).toBe(true)
  })
  it("rejects endSec <= startSec", () => {
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, endSec: 0 }] }).success).toBe(false)
  })
  it("does NOT accept model-emitted oversized/slotRefs (validator-computed)", () => {
    const parsed = windowAnalysisSchema.parse({ slots: [slot], scenes: [{ ...baseScene, oversized: true, slotRefs: ["hero"] }] })
    expect((parsed.scenes[0] as Record<string, unknown>).oversized).toBeUndefined()
    expect((parsed.scenes[0] as Record<string, unknown>).slotRefs).toBeUndefined()
  })
})

describe("videoAnalysisResultSchema", () => {
  it("requires >=1 scene overall", () => {
    const meta = { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" }
    expect(videoAnalysisResultSchema.safeParse({ meta, slots: [], scenes: [] }).success).toBe(false)
  })
})

describe("token helpers", () => {
  it("deriveSlotRefs reads tokens from visual", () => {
    expect(deriveSlotRefs("{slot:hero} kicks; {slot:product-can} glints; {slot:hero} smiles")).toEqual(["hero", "product-can"])
  })
  it("rewriteSlotTokens renames losers to survivors", () => {
    expect(rewriteSlotTokens("{slot:man-2} runs", { "man-2": "hero" })).toBe("{slot:hero} runs")
  })
  it("unwrapUnresolvedTokens unwraps to literal text, never deletes", () => {
    const r = unwrapUnresolvedTokens("{slot:ghost} appears near {slot:hero}", new Set(["hero"]))
    expect(r.text).toBe("ghost appears near {slot:hero}")
    expect(r.unresolved).toEqual(["ghost"])
  })
  it("renderAnalyzedScene substitutes descriptions (uncast) and castMap bindings (cast)", () => {
    expect(renderAnalyzedScene({ visual: "{slot:hero} runs" }, [slot])).toBe("tan man, mustache, black tee runs")
    expect(renderAnalyzedScene({ visual: "{slot:hero} runs" }, [slot], { hero: "the person from @image_1" })).toBe("the person from @image_1 runs")
  })
})

describe("misc", () => {
  it("isOversizedScene flags > 8s only", () => {
    expect(isOversizedScene(0, 8)).toBe(false)
    expect(isOversizedScene(0, 8.5)).toBe(true)
  })
  it("aspectRatioFromDims snaps to nearest standard, else reduces", () => {
    expect(aspectRatioFromDims(1920, 1080)).toBe("16:9")
    expect(aspectRatioFromDims(1080, 1920)).toBe("9:16")
    expect(aspectRatioFromDims(1000, 1000)).toBe("1:1")
    expect(aspectRatioFromDims(2560, 1080)).toBe("21:9")
    expect(aspectRatioFromDims(1000, 400)).toBe("5:2")
  })
})
