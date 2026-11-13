import { describe, it, expect } from "vitest"
import { describeNodeAdjustments, normalizeNodeModelParams, withListedReferenceTaskTypes, MODEL_PARAM_NODE_TYPES } from "../normalize-node-params.js"

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

/**
 * A video node's stored reference task type (decided 2026-11-13): kept only
 * while a model the node runs lists it (`MODEL_CATALOG[id].referenceTaskTypes`,
 * read through `listedSeedanceTaskType`), else removed — never left hidden on
 * a model that ignores it, to come back when the node is later switched to one
 * that reads it.
 */
describe("normalizeNodeModelParams — a stored reference task type (decided 2026-11-13)", () => {
  const VIDEO_TYPES = ["generate-video", "image-to-video", "text-to-video", "video-to-video"] as const
  const brief = (a: { nodeId: string; provider: string; field: string; from: unknown; to: unknown }) =>
    ({ nodeId: a.nodeId, provider: a.provider, field: a.field, from: a.from, to: a.to })

  it.each(VIDEO_TYPES)("%s on Kling, written with edit: the key is removed, and the removal reported", (type) => {
    const input = [node("k", type, { provider: "kling-3.0", prompt: "a cat", referenceTaskType: "edit" })]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(nodes[0]!.data).toStrictEqual({ provider: "kling-3.0", prompt: "a cat" })
    expect(nodes[0]!.data).not.toHaveProperty("referenceTaskType")
    expect(adjustments.map(brief)).toEqual([{ nodeId: "k", provider: "kling-3.0", field: "referenceTaskType", from: "edit", to: undefined }])
    // The caller's node is never mutated.
    expect(input[0]!.data.referenceTaskType).toBe("edit")
  })

  it.each(VIDEO_TYPES)("%s on Seedance 2.5 keeps every value it lists, the node returned as it came", (type) => {
    for (const value of ["reference", "edit", "extend"]) {
      const input = [node("s", type, { provider: "seedance-2-5", referenceTaskType: value })]
      const { nodes, adjustments } = normalizeNodeModelParams(input)
      expect(adjustments).toEqual([])
      expect(nodes[0]).toBe(input[0])
    }
  })

  it("\"auto\", a wrong case, a number and any other value no model lists are removed, even on Seedance 2.5", () => {
    for (const value of ["auto", "Edit", "bogus", 3, null, true]) {
      const { nodes, adjustments } = normalizeNodeModelParams([node("s", "generate-video", { provider: "seedance-2-5", referenceTaskType: value })])
      expect(nodes[0]!.data, String(value)).toStrictEqual({ provider: "seedance-2-5" })
      expect(adjustments.map(brief), String(value)).toEqual([
        { nodeId: "s", provider: "seedance-2-5", field: "referenceTaskType", from: typeof value === "number" ? value : String(value), to: undefined },
      ])
    }
  })

  it("a node of another type is untouched, whatever it stores", () => {
    const input = [
      node("img", "generate-image", { provider: "gpt-image-2", aspectRatio: "16:9", resolution: "2K", referenceTaskType: "edit" }),
      node("ext", "extend-video", { provider: "seedance-2-5-extend", referenceTaskType: "auto" }),
      node("txt", "text-prompt", { text: "hi", referenceTaskType: "edit" }),
      node("up", "upload-video", { url: "https://cdn.example/a.mp4", referenceTaskType: "bogus" }),
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    nodes.forEach((n, i) => expect(n).toBe(input[i]))
  })

  it("a video node with no task type stored (or the editor's in-memory undefined for Auto) is returned as it came", () => {
    const input = [
      ...VIDEO_TYPES.map((type) => node(type, type, { provider: "kling-3.0", aspectRatio: "21:9", duration: 5 })),
      node("auto", "generate-video", { provider: "kling-3.0", referenceTaskType: undefined }),
    ]
    const { nodes, adjustments } = normalizeNodeModelParams(input)
    expect(adjustments).toEqual([])
    nodes.forEach((n, i) => expect(n).toBe(input[i]))
  })

  it("a node naming no model is judged on the model its run uses (none of today's defaults lists one)", () => {
    for (const type of VIDEO_TYPES) {
      const { nodes, adjustments } = normalizeNodeModelParams([node("d", type, { referenceTaskType: "edit" })])
      expect(nodes[0]!.data, type).toStrictEqual({})
      expect(adjustments.map((a) => a.field), type).toEqual(["referenceTaskType"])
    }
  })

  it("a node naming several models keeps it while any of them lists it", () => {
    const kept = [node("m", "image-to-video", { providers: ["kling-3.0", "seedance-2-5"], provider: "kling-3.0", referenceTaskType: "extend" })]
    expect(normalizeNodeModelParams(kept).nodes[0]).toBe(kept[0])
    const dropped = normalizeNodeModelParams([node("m", "image-to-video", { providers: ["kling-3.0", "seedance-2-fast"], provider: "kling-3.0", referenceTaskType: "extend" })])
    expect(dropped.nodes[0]!.data).not.toHaveProperty("referenceTaskType")
  })

  it("is idempotent — a second pass reports nothing", () => {
    const first = normalizeNodeModelParams([node("k", "generate-video", { provider: "kling-3.0", referenceTaskType: "edit" })])
    const second = normalizeNodeModelParams(first.nodes)
    expect(second.adjustments).toEqual([])
    expect(second.nodes[0]).toBe(first.nodes[0])
  })

  it("describes a removal as one line", () => {
    const { adjustments } = normalizeNodeModelParams([node("k", "generate-video", { provider: "kling-3.0", referenceTaskType: "edit" })])
    expect(describeNodeAdjustments(adjustments)).toEqual([
      expect.stringMatching(/^k \(kling-3\.0\): referenceTaskType "edit" → removed — /),
    ])
  })
})

/**
 * `withListedReferenceTaskTypes` (decided 2026-11-13): the one rule for a
 * stored reference task type that every workflow write runs — the editor's
 * saves, the REST writes, imports, copies, clones, published snapshots — and
 * `normalizeNodeModelParams` runs for that field. It removes that one key and
 * coerces nothing else.
 */
describe("withListedReferenceTaskTypes — the write paths' rule", () => {
  const GRAPH = [
    node("kling", "generate-video", { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", resolution: "4K", referenceTaskType: "edit" }),
    node("sd25", "generate-video", { provider: "seedance-2-5", prompt: "a cat", referenceTaskType: "edit" }),
    // An image ratio the catalog normalizer WOULD snap: the write paths leave it as stored.
    node("img", "generate-image", { provider: "gpt-image", aspectRatio: "16:9", resolution: "2K" }),
    node("t", "text-prompt", { text: "hi" }),
  ]

  it("removes only that key: the whole graph is otherwise exactly as written", () => {
    const out = withListedReferenceTaskTypes(GRAPH)
    expect(out).toStrictEqual([
      node("kling", "generate-video", { provider: "kling-3.0", prompt: "a cat", aspectRatio: "21:9", resolution: "4K" }),
      GRAPH[1],
      GRAPH[2],
      GRAPH[3],
    ])
    expect(out[1]).toBe(GRAPH[1])
    expect(out[2]).toBe(GRAPH[2])
    expect(JSON.stringify(out[0])).toBe(JSON.stringify(GRAPH[0]).replace(',"referenceTaskType":"edit"', ""))
    // The caller's graph is never mutated.
    expect(GRAPH[0]!.data).toHaveProperty("referenceTaskType", "edit")
  })

  it("a graph without such a value comes back as the SAME array (written byte for byte as before)", () => {
    const clean = [GRAPH[1], GRAPH[2], GRAPH[3]]
    expect(withListedReferenceTaskTypes(clean)).toBe(clean)
    expect(withListedReferenceTaskTypes([])).toStrictEqual([])
  })

  it("takes the stored value as it comes: anything that is not an array, or a malformed entry, is left as it came", () => {
    for (const v of [undefined, null, "nodes", 3, { id: "x" }]) expect(withListedReferenceTaskTypes(v)).toBe(v)
    const odd = [null, 7, "x", [], { type: "generate-video" }, { type: "generate-video", data: null }]
    expect(withListedReferenceTaskTypes(odd)).toBe(odd)
  })

  it("is the rule normalizeNodeModelParams runs for the field: the same nodes and the same reports", () => {
    const videoOnly = GRAPH.filter((n) => n.type !== "generate-image")
    const adjustments: Parameters<typeof withListedReferenceTaskTypes>[1] = []
    const viaWrites = withListedReferenceTaskTypes(videoOnly, adjustments)
    const viaNormalizer = normalizeNodeModelParams(videoOnly)
    expect(viaWrites).toStrictEqual(viaNormalizer.nodes)
    expect(adjustments).toStrictEqual(viaNormalizer.adjustments)
  })
})
