import { describe, it, expect } from "vitest"
import { stripDerivedAnalysisFields, videoAnalysisResultSchema } from "../video-analysis.js"

/** A real result shape (validated below) so the strip list is tested against
 *  the canonical schema, not an invented fixture. */
const analysis = {
  meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9", title: "Clip" },
  slots: [
    { slotId: "hero", label: "Hero", source: "wired-character", role: "person", description: "tan man, mustache, black tee", refImageUrl: "https://r2.example/hero.png" },
  ],
  scenes: [
    { sceneNumber: 1, startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "slow push-in", visual: "{slot:hero} waves", visualResolved: "Hero waves", slotRefs: ["hero"], oversized: false, audio: [] },
    { sceneNumber: 2, startSec: 4, endSec: 12, label: "Turn", shotType: "Medium Close-Up", camera: "static", visual: "an empty street", visualResolved: "an empty street", slotRefs: [], oversized: true, audio: [] },
  ],
  variationFolds: [{ slotId: "hero", variationId: "v2", label: "coat" }],
  warnings: ["auto-cast dropped one duplicate line"],
}

describe("stripDerivedAnalysisFields", () => {
  it("the fixture is a real result (the strip list is tested against the canonical shape)", () => {
    expect(videoAnalysisResultSchema.safeParse(analysis).success).toBe(true)
  })

  it("drops the derived top-level and per-scene keys and keeps everything else, refImageUrl included", () => {
    const out = stripDerivedAnalysisFields(analysis) as Record<string, unknown>
    expect(out).not.toHaveProperty("warnings")
    expect(out).not.toHaveProperty("variationFolds")
    expect(out.meta).toEqual(analysis.meta)
    expect((out.slots as Array<Record<string, unknown>>)[0].refImageUrl).toBe("https://r2.example/hero.png")
    const scenes = out.scenes as Array<Record<string, unknown>>
    expect(scenes).toHaveLength(2)
    for (const scene of scenes) {
      expect(scene).not.toHaveProperty("visualResolved")
      expect(scene).not.toHaveProperty("slotRefs")
      expect(scene).not.toHaveProperty("oversized")
      expect(scene).toHaveProperty("visual")
      expect(scene).toHaveProperty("audio")
      expect(scene).toHaveProperty("sceneNumber")
    }
  })

  it("never mutates its input", () => {
    const frozen = JSON.parse(JSON.stringify(analysis))
    stripDerivedAnalysisFields(analysis)
    expect(analysis).toEqual(frozen)
  })

  it("returns a non-object input untouched and tolerates a non-object scene entry", () => {
    expect(stripDerivedAnalysisFields("nope")).toBe("nope")
    expect(stripDerivedAnalysisFields(null)).toBe(null)
    expect(stripDerivedAnalysisFields([1])).toEqual([1])
    const out = stripDerivedAnalysisFields({ scenes: [1, "x", null] }) as { scenes: unknown[] }
    expect(out.scenes).toEqual([1, "x", null])
  })

  it("is roughly half the bytes of the full result on a real-shaped scene", () => {
    const full = JSON.stringify(analysis).length
    const stripped = JSON.stringify(stripDerivedAnalysisFields(analysis)).length
    expect(stripped).toBeLessThan(full)
  })
})
