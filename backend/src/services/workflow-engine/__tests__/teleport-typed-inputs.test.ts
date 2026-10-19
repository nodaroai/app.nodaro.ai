/**
 * A Teleport pair passes on EXACTLY what entered it (decided 2026-10-13): a wire
 * leaving a Receive is read as the wire leaving the node and pip that feeds its
 * Send. The orchestrator applies `bypassTeleports` where it loads the graph;
 * these cases hold the engine to "through the pair = the direct wire" for every
 * kind of value, fan-out included.
 */
import { describe, it, expect } from "vitest"
import { bypassTeleports, carriedNodeSettings } from "@nodaro/render-rules"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSourceNodeOutputAsList } from "../output-extractor.js"
import { computeRouterGatedIds } from "../execution-graph.js"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}

function edge(source: string, sourceHandle: string | null, target: string, targetHandle: string, data?: Record<string, unknown>): SimpleEdge {
  return { id: `${source}->${target}`, source, sourceHandle, target, targetHandle, data }
}

const LIST = node("o", "list", {
  columns: [{ id: "c1", handleId: "col_c1", type: "text", label: "Items" }],
  rows: [["a red fox"], ["a blue whale"], ["a green frog"]],
})

const CASES: Array<{ name: string; origin: SimpleNode; handle: string | null; consumer: string; input: string; states?: Record<string, NodeExecutionState> }> = [
  { name: "audio", origin: node("o", "upload-audio", { url: "https://cdn.example/a.mp3" }), handle: "audio", consumer: "lip-sync", input: "audio" },
  { name: "audio (mix)", origin: node("o", "upload-audio", { url: "https://cdn.example/a.mp3" }), handle: "audio", consumer: "mix-audio", input: "in" },
  { name: "image", origin: node("o", "upload-image", { url: "https://cdn.example/i.png" }), handle: "image", consumer: "generate-image", input: "references" },
  { name: "video", origin: node("o", "upload-video", { url: "https://cdn.example/v.mp4" }), handle: "video", consumer: "trim-video", input: "in" },
  { name: "text", origin: node("o", "text-prompt", { text: "a quiet harbour at dawn" }), handle: "text", consumer: "generate-image", input: "prompt" },
  { name: "list", origin: LIST, handle: "col_c1", consumer: "generate-image", input: "prompt" },
]

/** origin → send ⇢ receive → consumer, as the store keeps it. */
function teleported(c: (typeof CASES)[number]): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
  const consumer = node("c", c.consumer)
  const nodes = [c.origin, node("s", "teleport-send"), node("r", "teleport-receive"), consumer]
  const edges = [
    edge("o", c.handle, "s", "in"),
    edge("s", "out", "r", "in", { teleporter: true }),
    { ...edge("r", "out", "c", c.input), id: "o->c" },
  ]
  return { nodes, edges: bypassTeleports(nodes, edges) }
}

describe("the orchestrator's graph through a Teleport pair", () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.origin.type} → ${c.consumer}.${c.input} resolves as the direct wire does`, () => {
      const consumer = node("c", c.consumer)
      const directEdges = [edge("o", c.handle, "c", c.input)]
      const direct = resolveNodeInputs(consumer, directEdges, c.states ?? {}, [c.origin, consumer])
      const t = teleported(c)
      const through = resolveNodeInputs(consumer, t.edges, c.states ?? {}, t.nodes)
      expect(Object.keys(direct).length).toBeGreaterThan(0)
      expect(through).toEqual(direct)
    })
  }

  it("a list fans the consumer out through the pair, row for row, as it does directly", () => {
    const listCase = CASES.find((c) => c.name === "list")!
    const consumer = node("c", "generate-image")
    const direct = getListFanOutForNode(consumer, [edge("o", "col_c1", "c", "prompt")], {}, [LIST, consumer])
    const t = teleported(listCase)
    const through = getListFanOutForNode(consumer, t.edges, {}, t.nodes)
    expect(direct?.items).toEqual(["a red fox", "a blue whale", "a green frog"])
    expect(through).toEqual(direct)
  })

  it("merge-video-audio track settings saved for the Receive reach the payload", () => {
    const audio = node("o", "upload-audio", { url: "https://cdn.example/a.mp3" })
    const consumer = node("c", "merge-video-audio", { trackSettings: { r: { startTime: 2.5, volume: 40 } } })
    const nodes = [audio, node("s", "teleport-send"), node("r", "teleport-receive"), consumer]
    const edges = bypassTeleports(nodes, [
      edge("o", "audio", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "in"), id: "r->c" },
    ])
    const inputs = resolveNodeInputs(consumer, edges, {}, nodes)
    // The run names the origin; the saved setting names the Receive.
    expect(inputs.audioSources).toEqual([{ url: "https://cdn.example/a.mp3", sourceNodeId: "o" }])
    const { payload } = buildPayload(consumer, "job-1", { ...inputs, videoUrl: "https://cdn.example/v.mp4" }, undefined, { nodes, edges, nodeStates: {} })
    expect((payload.audioTracks as Array<Record<string, unknown>>)[0]).toMatchObject({ startTime: 2.5, volume: 40 })
  })

  /** `x` wired in directly, `o` through a pair (its Receive is `r`), into consumer `c`. */
  function mixedAudioPair(consumer: SimpleNode): { nodes: SimpleNode[]; edges: SimpleEdge[] } {
    const nodes = [
      node("x", "upload-audio", { url: "https://cdn.example/x.mp3" }),
      node("o", "upload-audio", { url: "https://cdn.example/o.mp3" }),
      node("s", "teleport-send"),
      node("r", "teleport-receive"),
      consumer,
    ]
    const edges = bypassTeleports(nodes, [
      edge("x", "audio", "c", "in"),
      edge("o", "audio", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "in"), id: "r->c" },
    ])
    return { nodes, edges }
  }

  it("mix-audio volumes and the duck key saved for the Receive reach the payload", () => {
    const consumer = node("c", "mix-audio", { trackVolumes: { x: 80, r: 40 }, duckUnder: "r", duckAmount: 50 })
    const { nodes, edges } = mixedAudioPair(consumer)
    const inputs = resolveNodeInputs(consumer, edges, {}, nodes)
    expect(inputs.audioUrlsWithSourceIds?.map((e) => e.nodeId)).toEqual(["x", "o"])
    const { payload } = buildPayload(consumer, "job-1", inputs, undefined, { nodes, edges, nodeStates: {} })
    expect(payload.trackVolumes).toEqual([80, 40])
    expect(payload.duck).toEqual({ under: 1, amount: 50 })
  })

  it("combine-audio segment settings saved for the Receive reach the payload", () => {
    const consumer = node("c", "combine-audio", { segmentSettings: { r: { startTime: 1.5, endTime: 4 } } })
    const { nodes, edges } = mixedAudioPair(consumer)
    const inputs = resolveNodeInputs(consumer, edges, {}, nodes)
    const { payload } = buildPayload(consumer, "job-1", inputs, undefined, { nodes, edges, nodeStates: {} })
    expect(payload.segments).toEqual([
      { url: "https://cdn.example/x.mp3" },
      { url: "https://cdn.example/o.mp3", startTime: 1.5, endTime: 4 },
    ])
  })

  it("carriedNodeSettings maps every per-wire field shape from the Receive's id to the origin's", () => {
    const nodes: SimpleNode[] = [node("o", "upload-image"), node("x", "upload-image"), node("s", "teleport-send"), node("r", "teleport-receive")]
    const consumer = node("c", "image-collage", {
      // keyed by the wired node's id
      trackVolumes: { r: 40 },
      segmentSettings: { r: { startTime: 1 } },
      imageSizeBySource: { r: 2, x: 3 },
      imageLabelBySource: { r: "Hero" },
      referenceRoles: { r: "appearance" },
      referenceObjectIds: { r: "obj-1" },
      sourceConfig: { r: { role: "camera" } },
      // orders / lists of wired node ids
      assetOrder: ["x", "r"],
      connectedImageOrder: ["r"],
      excludeSourceIds: ["r"],
      // one wired node's id
      duckUnder: "r",
      reference: "r",
      selectedStartFrameNodeId: "r",
      selectedEndFrameNodeId: "x",
      selectedAudioNodeId: "r",
      selectedImageNodeId: "r",
      selectedVideoNodeId: "r",
      masterSourceId: "r",
      wideSourceId: "x",
      // entries naming a wired node
      assetInjections: [{ sourceNodeId: "r", facet: "hair" }, { sourceNodeId: "x" }],
    })
    const edges = bypassTeleports([...nodes, consumer], [
      edge("o", "image", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "in"), id: "r->c" },
      edge("x", "image", "c", "in"),
    ])
    const data = carriedNodeSettings(consumer, edges).data as Record<string, unknown>
    expect(data).toMatchObject({
      trackVolumes: { r: 40, o: 40 },
      segmentSettings: { r: { startTime: 1 }, o: { startTime: 1 } },
      imageSizeBySource: { r: 2, x: 3, o: 2 },
      imageLabelBySource: { r: "Hero", o: "Hero" },
      referenceRoles: { r: "appearance", o: "appearance" },
      referenceObjectIds: { r: "obj-1", o: "obj-1" },
      sourceConfig: { r: { role: "camera" }, o: { role: "camera" } },
      assetOrder: ["x", "o"],
      connectedImageOrder: ["o"],
      excludeSourceIds: ["o"],
      duckUnder: "o",
      reference: "o",
      selectedStartFrameNodeId: "o",
      selectedEndFrameNodeId: "x",
      selectedAudioNodeId: "o",
      selectedImageNodeId: "o",
      selectedVideoNodeId: "o",
      masterSourceId: "o",
      wideSourceId: "x",
      assetInjections: [{ sourceNodeId: "o", facet: "hair" }, { sourceNodeId: "x" }],
    })
  })

  it("Collect orders a Receive-fed input by the Receive's id in data.order", () => {
    const nodes: SimpleNode[] = [
      node("c", "collect", { order: ["r", "a"] }),
      node("a", "text-prompt", { text: "first wired" }),
      node("b", "text-prompt", { text: "through the pair" }),
      node("s", "teleport-send"),
      node("r", "teleport-receive"),
    ]
    const raw: SimpleEdge[] = [
      edge("a", "text", "c", "in"),
      edge("b", "text", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "in"), id: "r->c" },
    ]
    const edges = bypassTeleports(nodes, raw)
    const out = extractSourceNodeOutputAsList(nodes[0], undefined, "out-text", { nodes, edges, nodeStates: {} })
    expect(out).toEqual(["through the pair", "first wired"])
  })

  it("a Router's inactive route sent through a pair gates the consumer, as a direct wire does", () => {
    const nodes: SimpleNode[] = [
      node("router", "router"),
      node("s", "teleport-send"),
      node("r", "teleport-receive"),
      node("c", "generate-image"),
    ]
    const raw: SimpleEdge[] = [
      edge("router", "route-b", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "prompt"), id: "r->c" },
    ]
    const states: Record<string, NodeExecutionState> = {
      router: { status: "completed", output: { routeOutputs: { "route-a": "go", "route-b": undefined } } } as unknown as NodeExecutionState,
    }
    expect(computeRouterGatedIds(nodes, bypassTeleports(nodes, raw), states).has("c")).toBe(true)
  })

  it("carriedNodeSettings maps saved orders and per-source settings from the Receive's id to the origin's, nothing else", () => {
    const nodes: SimpleNode[] = [node("o", "upload-image"), node("x", "upload-image"), node("s", "teleport-send"), node("r", "teleport-receive")]
    const consumer = node("c", "generate-image", {
      referenceOrder: ["wired:x", "wired:r", "char-canonical:kira"],
      imageOrder: ["r", "x"],
      trackSettings: { r: { volume: 10 }, x: { volume: 20 } },
      prompt: "r stays r",
    })
    const edges = bypassTeleports([...nodes, consumer], [
      edge("o", "image", "s", "in"),
      edge("s", "out", "r", "in", { teleporter: true }),
      { ...edge("r", "out", "c", "references"), id: "r->c" },
      edge("x", "image", "c", "references"),
    ])
    const out = carriedNodeSettings(consumer, edges)
    expect(out.data).toEqual({
      label: "c",
      referenceOrder: ["wired:x", "wired:o", "char-canonical:kira"],
      imageOrder: ["o", "x"],
      trackSettings: { r: { volume: 10 }, x: { volume: 20 }, o: { volume: 10 } },
      prompt: "r stays r",
    })
    // A node with no re-pointed wire is returned as it is.
    expect(carriedNodeSettings(nodes[1], edges)).toBe(nodes[1])
  })
})
