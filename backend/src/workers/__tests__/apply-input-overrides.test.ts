import { describe, it, expect } from "vitest"
import { applyInputOverridesToNodes, applyLocationVariantOverride } from "../apply-input-overrides.js"
import { LockedOverrideError } from "../../lib/input-override-lock.js"

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


// A published app / API-token / MCP run swaps an input node's media by overriding
// its url field. `metadata` was measured FROM the publisher's media — left behind
// it describes a file that is no longer there, and a stale
// `metadata.durationSeconds` outranks the run's own transcript as Edit Plan's
// reserve basis (under-bucketing a caller's longer episode).
describe("applyInputOverridesToNodes — media-bound metadata", () => {
  it("drops a reference-audio node's recorded length when the run swaps its audio", () => {
    const nodes = [{
      id: "ref", type: "reference-audio",
      data: { extractedAudioUrl: "https://cdn/publisher-10min.mp3", extractionStatus: "ready", metadata: { durationSeconds: 600 } },
    }]
    applyInputOverridesToNodes(nodes, { ref: { extractedAudioUrl: "https://cdn/caller-60min.mp3" } })
    expect(nodes[0].data.extractedAudioUrl).toBe("https://cdn/caller-60min.mp3")
    expect("metadata" in nodes[0].data).toBe(false)
  })

  it("covers upload-audio / upload-video the same way (their `url` field)", () => {
    const nodes = [
      { id: "a", type: "upload-audio", data: { url: "https://cdn/old.mp3", metadata: { durationSeconds: 600 } } },
      { id: "v", type: "upload-video", data: { url: "https://cdn/old.mp4", metadata: { durationSeconds: 90 } } },
    ]
    applyInputOverridesToNodes(nodes, { a: { url: "https://cdn/new.mp3" }, v: { url: "https://cdn/new.mp4" } })
    expect("metadata" in nodes[0].data).toBe(false)
    expect("metadata" in nodes[1].data).toBe(false)
  })

  it("keeps the recorded length for a run that does not change the media", () => {
    const nodes = [{
      id: "ref", type: "reference-audio",
      data: { extractedAudioUrl: "https://cdn/ep.mp3", metadata: { durationSeconds: 600 } },
    }]
    applyInputOverridesToNodes(nodes, { ref: { label: "Renamed" } })
    expect(nodes[0].data.metadata).toEqual({ durationSeconds: 600 })
  })
})

describe("applyInputOverridesToNodes — the override lock (issue #1555)", () => {
  const graph = () => [
    { id: "text-1", type: "text-prompt", data: { text: "saved" } },
    { id: "hook-1", type: "webhook-output", data: { url: "https://creator.example/hook", label: "Deliver" } },
  ]

  it("throws a LockedOverrideError when an override re-points an outbound node", () => {
    const nodes = graph()
    expect(() =>
      applyInputOverridesToNodes(nodes, { "hook-1": { url: "https://attacker.example/collect" } }),
    ).toThrow(LockedOverrideError)
  })

  it("checks the WHOLE map first — a throw leaves every node untouched, even the legitimate entries", () => {
    const nodes = graph()
    const before = JSON.stringify(nodes)
    expect(() =>
      applyInputOverridesToNodes(nodes, {
        "text-1": { text: "a legitimate input" },
        "hook-1": { url: "https://attacker.example/collect" },
      }),
    ).toThrow(LockedOverrideError)
    // No partial merge: the text node did not take its override either.
    expect(JSON.stringify(nodes)).toBe(before)
  })

  it("carries a message the orchestrator can fail the execution with — field and node, never the value", () => {
    let message = ""
    try {
      applyInputOverridesToNodes(graph(), { "hook-1": { url: "https://attacker.example/collect" } })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toContain('"url" on webhook-output node "hook-1"')
    expect(message).not.toContain("attacker")
    expect(message).not.toContain("creator.example")
  })

  it("still merges an ordinary field onto an outbound node and a url onto an input node", () => {
    const nodes = [
      { id: "img-1", type: "upload-image", data: { url: "https://cdn.example/old.png" } },
      { id: "scrape-1", type: "web-scrape", data: { target: "https://creator.example", maxItems: 1 } },
    ]
    applyInputOverridesToNodes(nodes, {
      "img-1": { url: "https://cdn.example/new.png" },
      "scrape-1": { maxItems: 5 },
    })
    expect(nodes[0].data.url).toBe("https://cdn.example/new.png")
    expect(nodes[1].data.maxItems).toBe(5)
    expect(nodes[1].data.target).toBe("https://creator.example")
  })
})

describe("applyInputOverridesToNodes — an exposed key that was renamed", () => {
  it("a published app's `similarity` override reaches the text-to-speech node's `similarityBoost`", () => {
    const nodes = [
      { id: "tts1", type: "text-to-speech", data: { provider: "elevenlabs-turbo", stability: 0.5, similarityBoost: 0.75 } },
    ]
    applyInputOverridesToNodes(nodes, { tts1: { similarity: 0.2 } })
    expect(nodes[0].data.similarityBoost).toBe(0.2)
    expect("similarity" in nodes[0].data).toBe(false)
    expect(nodes[0].data.stability).toBe(0.5)
  })

  it("the current key works the same", () => {
    const nodes = [{ id: "tts1", type: "text-to-speech", data: { similarityBoost: 0.75 } }]
    applyInputOverridesToNodes(nodes, { tts1: { similarityBoost: 0.3 } })
    expect(nodes[0].data.similarityBoost).toBe(0.3)
  })

  it("does not touch `similarity` on a node that has it for real (AI Avatar's Fish voice)", () => {
    const nodes = [{ id: "av1", type: "ai-avatar", data: { label: "Avatar" } as Record<string, unknown> }]
    applyInputOverridesToNodes(nodes, { av1: { similarity: 0.4 } })
    expect(nodes[0].data.similarity).toBe(0.4)
  })
})
