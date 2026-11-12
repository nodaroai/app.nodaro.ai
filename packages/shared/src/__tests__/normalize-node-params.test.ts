import { describe, it, expect } from "vitest"
import { normalizeNodeModelParams, MODEL_PARAM_NODE_TYPES } from "../normalize-node-params.js"

/**
 * Write-boundary guard for agent/import-authored graphs. The config panel's
 * provider-aware dropdown and its stale-value snap are React effects — they
 * only run for a node whose panel or hover strip is mounted, so a node written
 * straight into workflow JSON never meets either.
 */

const node = (id: string, type: string, data: Record<string, unknown>) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
})

describe("normalizeNodeModelParams", () => {
  it("heals the exact node that aborted the 2026-08-09 run", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      node("node_8", "generate-image", { provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" }),
    ])
    const d = nodes[0].data as Record<string, unknown>
    expect(d.aspectRatio).not.toBe("16:9")
    expect(d.resolution).toBeUndefined() // GPT Image 1.5 has no resolution lever
    expect(adjustments.map((a) => a.field).sort()).toEqual(["aspectRatio", "resolution"])
    expect(adjustments[0].nodeId).toBe("node_8")
    expect(adjustments[0].provider).toBe("gpt-image")
  })

  it("leaves the sibling nodes that were already valid completely alone", () => {
    // Same workflow, the five nodes that generated fine — must be untouched,
    // and returned BY REFERENCE so a delta/CAS save sees no spurious change.
    const input = [
      node("a", "generate-image", { provider: "gpt-image-2", aspectRatio: "16:9", resolution: "2K" }),
      node("b", "generate-image", { provider: "grok", aspectRatio: "16:9" }),
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    expect(nodes[0]).toBe(input[0])
    expect(nodes[1]).toBe(input[1])
  })

  it("never mutates the caller's node objects", () => {
    const input = [node("n1", "generate-image", { provider: "gpt-image", aspectRatio: "16:9" })]
    const before = JSON.parse(JSON.stringify(input))
    normalizeNodeModelParams(input)
    expect(input).toEqual(before)
  })

  it("ignores node types that carry no catalog-governed params", () => {
    const input = [
      node("t1", "text-prompt", { provider: "gpt-image", aspectRatio: "16:9" }),
      node("v1", "image-to-video", { provider: "veo3", aspectRatio: "21:9" }),
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    expect(nodes).toEqual(input)
    expect(MODEL_PARAM_NODE_TYPES.has("image-to-video")).toBe(false)
  })

  // The write boundary has to cover every image node an agent can author, not
  // just the two that shipped first: `modify-image` carries the same
  // provider/aspectRatio/resolution/quality trio, and `edit-image` carries
  // provider + aspectRatio (its `targetResolution` is an upscale target, a
  // DIFFERENT field the normalizer never reads, so there is no conflation).
  it("covers every image node type whose data carries catalog-governed params", () => {
    expect([...MODEL_PARAM_NODE_TYPES].sort()).toEqual([
      "edit-image",
      "generate-image",
      "image-to-image",
      "modify-image",
    ])
  })

  it("heals a modify-image node written straight into workflow JSON", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      node("m9", "modify-image", { provider: "gpt-image", aspectRatio: "16:9", quality: "basic" }),
    ])
    const d = nodes[0].data as Record<string, unknown>
    expect(d.aspectRatio).not.toBe("16:9")
    expect(d.quality).toBe("medium") // gpt-image declares ["medium", "high"]
    expect(adjustments.map((a) => a.field).sort()).toEqual(["aspectRatio", "quality"])
    expect(adjustments[0].nodeId).toBe("m9")
  })

  it("heals an edit-image node's ratio without touching its targetResolution", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      node("e1", "edit-image", { provider: "recraft-upscale", aspectRatio: "16:9", targetResolution: "4K" }),
    ])
    const d = nodes[0].data as Record<string, unknown>
    // The upscalers declare no aspectRatios at all -> the lever is dropped.
    expect(d.aspectRatio).toBeUndefined()
    expect(d.targetResolution).toBe("4K")
    expect(adjustments.map((a) => a.field)).toEqual(["aspectRatio"])
  })

  it("skips multi-provider nodes rather than guessing an intersection", () => {
    const input = [
      node("m1", "generate-image", {
        providers: ["gpt-image", "gpt-image-2"],
        provider: "gpt-image",
        aspectRatio: "16:9",
      }),
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    expect(nodes[0]).toBe(input[0])
  })

  it("survives malformed nodes without throwing", () => {
    const input = [
      { id: "x", type: "generate-image" },
      { id: "y", type: "generate-image", data: null },
      { id: "z", type: "generate-image", data: { provider: 42 } },
      { type: "generate-image", data: { provider: "gpt-image", aspectRatio: "16:9" } },
    ] as Array<{ id?: unknown; type?: unknown; data?: unknown }>
    expect(() => normalizeNodeModelParams(input)).not.toThrow()
    const { adjustments } = normalizeNodeModelParams(input)
    // The last entry has no id but IS healable — it reports under a placeholder.
    expect(adjustments.every((a) => typeof a.nodeId === "string")).toBe(true)
  })

  it("is idempotent — a second pass reports nothing", () => {
    const first = normalizeNodeModelParams([
      node("n1", "generate-image", { provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" }),
    ])
    const second = normalizeNodeModelParams(first.nodes)
    expect(second.adjustments).toEqual([])
  })
})

describe("normalizeNodeModelParams — Motion Transfer (decided 2026-11-12)", () => {
  it("a Wan Animate node at a size it does not have is written at 720p, the size it runs at", () => {
    const { nodes, adjustments } = normalizeNodeModelParams([
      { id: "m1", type: "motion-transfer", data: { provider: "wan-animate-move", resolution: "1080p", prompt: "dance" } },
    ])
    expect(nodes[0]!.data).toEqual({ provider: "wan-animate-move", resolution: "720p", prompt: "dance" })
    expect(adjustments.map(({ nodeId, provider, field, from, to }) => ({ nodeId, provider, field, from, to }))).toEqual([
      { nodeId: "m1", provider: "wan-animate-move", field: "resolution", from: "1080p", to: "720p" },
    ])
  })

  it("leaves a Wan Animate size it has, an unset size, and every Kling node as it came", () => {
    const input = [
      { id: "a", type: "motion-transfer", data: { provider: "wan-animate-replace", resolution: "580p" } },
      { id: "b", type: "motion-transfer", data: { provider: "wan-animate-replace" } },
      { id: "c", type: "motion-transfer", data: { provider: "kling", resolution: "480p" } },
      { id: "d", type: "motion-transfer", data: { resolution: "580p" } },
      { id: "e", type: "motion-transfer", data: { provider: "kling-3.0", resolution: "1080p" } },
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    nodes.forEach((n, i) => expect(n).toBe(input[i]))
  })
})
