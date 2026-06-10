import { describe, it, expect } from "vitest"
import { applyInputOverridesToNodes, applyLocationVariantOverride } from "../apply-input-overrides.js"

describe("applyInputOverridesToNodes — shallow merge", () => {
  it("replaces a STALE motionPlan with the full-plan override (lottie slot exposure pin)", () => {
    // The published-app runtime sends a self-contained plan as a top-level
    // override key (design §Phase 3). The shallow merge must swap the whole stale
    // motionPlan for the override one — planType + slotValues survive, stale plan
    // gone. This is the compatibility invariant the lottie slot feature relies on.
    const stalePlan = {
      planType: "lottie-graphic",
      lottie: { v: "5.7.0", layers: [{ nm: "old" }] },
      slots: { primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } },
      slotValues: { primaryColor: [1, 0, 0, 1] },
    }
    const overridePlan = {
      planType: "lottie-graphic",
      lottie: { v: "5.7.0", layers: [{ nm: "old" }] },
      slots: { primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } } },
      slotValues: { primaryColor: [0, 1, 0, 1] },
    }
    const nodes = [
      { id: "mg1", type: "motion-graphics", data: { engine: "lottie", motionPlan: stalePlan } },
    ]
    applyInputOverridesToNodes(nodes, { mg1: { motionPlan: overridePlan } })

    const merged = nodes[0].data.motionPlan as Record<string, unknown>
    // The override object replaced the stale plan wholesale.
    expect(merged).toBe(overridePlan)
    expect(merged.planType).toBe("lottie-graphic")
    expect((merged.slotValues as Record<string, unknown>).primaryColor).toEqual([0, 1, 0, 1])
  })

  it("preserves non-overridden node-data keys alongside the swapped motionPlan", () => {
    const nodes = [
      {
        id: "mg1",
        type: "motion-graphics",
        data: { engine: "lottie", fps: 30, motionPlan: { planType: "lottie-graphic", slotValues: {} } },
      },
    ]
    applyInputOverridesToNodes(nodes, {
      mg1: { motionPlan: { planType: "lottie-graphic", slotValues: { nameText: "Hi" } } },
    })
    // fps (not overridden) survives the shallow merge.
    expect(nodes[0].data.fps).toBe(30)
    expect((nodes[0].data.motionPlan as Record<string, unknown>).slotValues).toEqual({ nameText: "Hi" })
  })

  it("clears stale generated* results when an override is applied", () => {
    const nodes = [
      {
        id: "tp1",
        type: "text-prompt",
        data: {
          text: "old",
          generatedResults: [{ url: "stale" }],
          activeResultIndex: 2,
          generatedImageUrl: "stale.png",
          generatedVideoUrl: "stale.mp4",
          generatedAudioUrl: "stale.mp3",
          generatedText: "stale text",
        },
      },
    ]
    applyInputOverridesToNodes(nodes, { tp1: { text: "fresh" } })
    const d = nodes[0].data
    expect(d.text).toBe("fresh")
    expect(d.generatedResults).toBeUndefined()
    expect(d.activeResultIndex).toBeUndefined()
    expect(d.generatedImageUrl).toBeUndefined()
    expect(d.generatedVideoUrl).toBeUndefined()
    expect(d.generatedAudioUrl).toBeUndefined()
    expect(d.generatedText).toBeUndefined()
  })

  it("leaves nodes without an override untouched", () => {
    const original = { text: "keep", generatedResults: [{ url: "keep" }] }
    const nodes = [{ id: "tp1", type: "text-prompt", data: original }]
    applyInputOverridesToNodes(nodes, { other: { text: "x" } })
    // Same reference, generatedResults retained (no override → no cleaning).
    expect(nodes[0].data).toBe(original)
    expect(nodes[0].data.generatedResults).toEqual([{ url: "keep" }])
  })

  it("is a no-op when inputOverrides is undefined", () => {
    const original = { text: "keep" }
    const nodes = [{ id: "tp1", type: "text-prompt", data: original }]
    applyInputOverridesToNodes(nodes, undefined)
    expect(nodes[0].data).toBe(original)
  })
})

describe("applyLocationVariantOverride", () => {
  it("patches sourceImageUrl to the matching variant url", () => {
    const data: Record<string, unknown> = {
      selectedVariant: "weather/light-rain",
      weather: [{ name: "Light Rain", url: "https://cdn/light-rain.png" }],
    }
    applyLocationVariantOverride(data)
    expect(data.sourceImageUrl).toBe("https://cdn/light-rain.png")
  })

  it("is a no-op for an unknown variant", () => {
    const data: Record<string, unknown> = {
      selectedVariant: "weather/blizzard",
      weather: [{ name: "Light Rain", url: "https://cdn/light-rain.png" }],
    }
    applyLocationVariantOverride(data)
    expect(data.sourceImageUrl).toBeUndefined()
  })
})
