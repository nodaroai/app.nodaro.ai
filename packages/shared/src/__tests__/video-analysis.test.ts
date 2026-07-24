import { describe, it, expect } from "vitest"
import {
  windowAnalysisSchema, videoAnalysisResultSchema,
  deriveSlotRefs, rewriteSlotTokens, unwrapUnresolvedTokens,
  renderAnalyzedScene, isOversizedScene, aspectRatioFromDims,
  entitySlotSchema, analyzedSceneSchema,
  rewriteSceneBindings, dropUnknownBindings,
  VIDEO_ANALYSIS_MAX_VARIATIONS, VIDEO_ANALYSIS_VARIATION_SLUGS, VIDEO_ANALYSIS_DEFAULT_VARIATION,
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

const dreamVariation = {
  variationId: "dream",
  label: "Dream self",
  description: "tan man, mustache — flowing white robe, barefoot, hair loose (dream sequences)",
  refImageUrl: "https://cdn.example/frames/hero-dream.jpg",
}

describe("appearance variations (cast-variations spec §4)", () => {
  it("entitySlotSchema round-trips variations[] including refImageUrl", () => {
    const parsed = entitySlotSchema.parse({ ...slot, variations: [dreamVariation] })
    expect(parsed.variations).toEqual([dreamVariation])
  })
  it("absent variations stays absent (no [] materialization)", () => {
    const parsed = entitySlotSchema.parse(slot)
    expect("variations" in parsed && parsed.variations !== undefined).toBe(false)
  })
  it(`rejects more than VIDEO_ANALYSIS_MAX_VARIATIONS (${4}) — window layer rejects, merge folds`, () => {
    expect(VIDEO_ANALYSIS_MAX_VARIATIONS).toBe(4)
    const five = ["dream", "flashback", "disguise", "era", "alt-1"].map((id) => ({ ...dreamVariation, variationId: id }))
    expect(entitySlotSchema.safeParse({ ...slot, variations: five }).success).toBe(false)
  })
  it("rejects the reserved 'default' variationId inside variations[] (D9)", () => {
    expect(VIDEO_ANALYSIS_DEFAULT_VARIATION).toBe("default")
    expect(entitySlotSchema.safeParse({ ...slot, variations: [{ ...dreamVariation, variationId: "default" }] }).success).toBe(false)
  })
  it("rejects a malformed variationId (slug charset only; vocabulary is doctrine-enforced)", () => {
    expect(entitySlotSchema.safeParse({ ...slot, variations: [{ ...dreamVariation, variationId: "Dream Look" }] }).success).toBe(false)
    expect(VIDEO_ANALYSIS_VARIATION_SLUGS).toContain("dream")
    expect(VIDEO_ANALYSIS_VARIATION_SLUGS).toContain("alt-2")
  })
  it("windowAnalysisSchema scenes round-trip slotVariations; absent stays absent", () => {
    const bound = { ...baseScene, slotVariations: { hero: "dream" } }
    const parsed = windowAnalysisSchema.parse({ slots: [{ ...slot, variations: [dreamVariation] }], scenes: [bound, baseScene] })
    expect(parsed.scenes[0].slotVariations).toEqual({ hero: "dream" })
    expect(parsed.scenes[1].slotVariations).toBeUndefined()
  })
  it("analyzedSceneSchema inherits slotVariations from the same base", () => {
    const parsed = analyzedSceneSchema.parse({
      ...baseScene, sceneNumber: 1, visualResolved: "a man juggles", slotRefs: ["hero"], slotVariations: { hero: "dream" },
    })
    expect(parsed.slotVariations).toEqual({ hero: "dream" })
  })
  it("videoAnalysisResultSchema full-document round-trip with both fields", () => {
    const meta = { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" }
    const doc = {
      meta,
      slots: [{ ...slot, variations: [dreamVariation] }],
      scenes: [{ ...baseScene, sceneNumber: 1, visualResolved: "a man juggles", slotRefs: ["hero"], slotVariations: { hero: "dream" } }],
    }
    expect(videoAnalysisResultSchema.parse(doc)).toEqual(doc)
  })
})

describe("binding rewrite helpers (merge consumes — spec §4)", () => {
  it("rewriteSceneBindings renames slot keys and per-slot variation values", () => {
    expect(rewriteSceneBindings({ "man-2": "dream", other: "era" }, { "man-2": "hero" }, { hero: { dream: "flashback" } }))
      .toEqual({ hero: "flashback", other: "era" })
  })
  it("rewriteSceneBindings passes undefined through", () => {
    expect(rewriteSceneBindings(undefined, { a: "b" })).toBeUndefined()
  })
  it("dropUnknownBindings drops unknown (slot, variation) pairs and reports them", () => {
    const valid = new Map([["hero", new Set(["dream"])]])
    const r = dropUnknownBindings({ hero: "dream", hero2: "dream", other: "ghost" }, valid)
    expect(r.kept).toEqual({ hero: "dream" })
    expect(r.dropped).toEqual([{ slotId: "hero2", variationId: "dream" }, { slotId: "other", variationId: "ghost" }])
  })
  it("dropUnknownBindings treats 'default' as always valid for a known slot", () => {
    const valid = new Map([["hero", new Set<string>()]])
    const r = dropUnknownBindings({ hero: "default" }, valid)
    expect(r.kept).toEqual({ hero: "default" })
    expect(r.dropped).toEqual([])
  })
  it("dropUnknownBindings returns kept: undefined when nothing survives (no {} materialization)", () => {
    const r = dropUnknownBindings({ ghost: "dream" }, new Map())
    expect(r.kept).toBeUndefined()
    expect(r.dropped).toEqual([{ slotId: "ghost", variationId: "dream" }])
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
