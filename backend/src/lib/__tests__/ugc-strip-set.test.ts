/**
 * The ONE strip set (`ugcStripSet`, @nodaro/render-rules) over a composed graph, and the read that
 * composes it (`ugcReadComposedGraph`): (a) what can flow into a UGC Creator's photo, and (b)
 * everything downstream of it or of a root — a UGC node, a graph holding one, a graph the read could
 * not open — across sub-workflow ports both ways. The ids are placeholders.
 */
import { describe, expect, it, vi } from "vitest"
import {
  UGC_COMPOSED_MAX_PARTS,
  ugcComposedKey,
  ugcReadComposedGraph,
  ugcStripSet,
  type UgcComposedGraph,
  type UgcGraphPart,
  type UgcPartLoad,
} from "@nodaro/render-rules"

type N = { id: string; type: string; parentId?: string; data: Record<string, unknown> }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle = "in", sourceHandle: string | null = null) => ({ source, target, targetHandle, sourceHandle })
const creator = (id = "creator") => n(id, "ugc-creator", { source: "photo", gender: "woman" })
const sub = (id: string, ref: string, data: Record<string, unknown> = {}) => n(id, "sub-workflow", { workflowId: ref, ...data })
const input = (id = "in") => n(id, "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }] })
const out = (id = "out") => n(id, "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] })
const ROOT = ugcComposedKey([])
const key = (...path: string[]) => ugcComposedKey(path)
const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort()
const composed = (parts: Array<[string[], { nodes: N[]; edges: unknown[]; component?: boolean }]>): UgcComposedGraph =>
  new Map(parts.map(([path, part]) => [ugcComposedKey(path), part as unknown as UgcGraphPart]))

describe("(b): what is made from the photo's path or from a root ships empty too", () => {
  it("a Preview of the photo upload, an upscale of it on another branch, a second Receive on its channel — and what they feed", () => {
    const graph = composed([[[], {
      nodes: [creator(), n("up", "upload-image"), n("preview", "preview", { previewItems: [{ sourceNodeId: "up" }] }), n("side", "upscale-image"), n("after", "video-overlay"), n("ts", "teleport-send", { channel: "P" }), n("tr", "teleport-receive", { channel: "P" }), n("tr2", "teleport-receive", { channel: "P" }), n("lone", "generate-image")],
      edges: [e("up", "creator", "photo"), e("up", "side", "image"), e("side", "after", "image"), e("up", "ts"), e("tr", "creator", "photo")],
    }]])
    const { strip, photo } = ugcStripSet(graph)
    expect(sorted(photo.get(ROOT))).toEqual(["tr", "ts", "up"])
    expect(sorted(strip.get(ROOT))).toEqual(["after", "creator", "preview", "side", "tr", "tr2", "ts", "up"])
  })

  it("across a sub-workflow's ports: what a node in the set feeds a sub-workflow reaches its input nodes, and what its output comes from reaches the sub-workflow node", () => {
    const graph = composed([
      [[], { nodes: [n("seed", "ugc-clip"), sub("s", "wf"), n("after", "combine-videos")], edges: [e("seed", "s", "in_i1"), e("s", "after", "in", "out_p1")] }],
      [["s"], { nodes: [input(), n("step", "upscale-image"), out(), n("aside", "upload-image")], edges: [e("in", "step", "image", "i1"), e("step", "out", "p1")] }],
    ])
    const { strip } = ugcStripSet(graph)
    // In the child: the input and what it feeds, out to the output — and a terminal node beside them (a run may hand it out).
    expect(sorted(strip.get(key("s")))).toEqual(["in", "out", "step"])
    expect(sorted(strip.get(ROOT))).toEqual(["after", "s", "seed"])
  })

  it("a root inside a child reaches the parent only through what the child hands out", () => {
    const inside = composed([
      [[], { nodes: [sub("s", "wf"), n("after", "combine-videos"), n("elsewhere", "generate-image")], edges: [e("s", "after", "in", "out_p1")] }],
      [["s"], { nodes: [n("clip", "ugc-clip"), out()], edges: [e("clip", "out", "p1")] }],
    ])
    expect(sorted(ugcStripSet(inside).strip.get(ROOT))).toEqual(["after", "s"])
  })

  it("every part of the composition has an entry, an empty one included: a part the set does not know is told apart", () => {
    const graph = composed([[[], { nodes: [sub("s", "wf")], edges: [] }], [["s"], { nodes: [n("x", "generate-image")], edges: [] }]])
    const { strip } = ugcStripSet(graph)
    expect([...strip.keys()].sort()).toEqual([ROOT, key("s")].sort())
    expect(sorted(strip.get(key("s")))).toEqual([])
  })
})

describe("roots and photo inputs the walk does not open", () => {
  it("a node whose graph could not be read is a root, and what feeds it is on a photo's path", () => {
    const graph = composed([[[], { nodes: [n("up", "upload-image"), sub("s", "wf-gone", { outputResults: { p1: "x" } }), n("after", "upscale-image"), n("lone", "upload-image")], edges: [e("up", "s", "in_i1"), e("s", "after", "image", "out_p1")] }]])
    const { strip, photo } = ugcStripSet(graph, new Map([[ROOT, new Set(["s"])]]))
    expect(sorted(photo.get(ROOT))).toEqual(["up"])
    expect(sorted(strip.get(ROOT))).toEqual(["after", "s", "up"])
  })

  it("a component holding a UGC video is a root and a photo input; its snapshot is never walked into", () => {
    const graph = composed([
      [[], { nodes: [n("up", "upload-image"), n("comp", "component", { appSlug: "ugc-maker" }), n("after", "combine-videos")], edges: [e("up", "comp", "photo"), e("comp", "after", "in")] }],
      [["comp"], { nodes: [n("in", "upload-image"), n("c", "ugc-creator", { source: "photo" })], edges: [e("in", "c", "photo")], component: true }],
    ])
    const { strip, photo } = ugcStripSet(graph)
    expect(sorted(photo.get(ROOT))).toEqual(["up"])
    expect(sorted(strip.get(ROOT))).toEqual(["after", "comp", "up"])
    // Its snapshot was stripped at its own publish: nothing in it is named.
    expect(sorted(strip.get(key("comp")))).toEqual([])
  })

  it("a component that holds no UGC video is a node like any other", () => {
    const graph = composed([
      [[], { nodes: [n("up", "upload-image"), n("comp", "component", { appSlug: "plain" }), n("after", "combine-videos")], edges: [e("up", "comp", "image"), e("comp", "after", "in")] }],
      [["comp"], { nodes: [n("g", "generate-image")], edges: [], component: true }],
    ])
    expect(sorted(ugcStripSet(graph).strip.get(ROOT))).toEqual([])
  })

  it("a fan-out clone of a sub-workflow node holding a UGC video is made from it", () => {
    const graph = composed([
      [[], { nodes: [sub("s", "wf"), n("s_iter_0", "sub-workflow", { workflowId: "wf", __expandedFrom: "s" }), n("after", "combine-videos")], edges: [e("s_iter_0", "after", "in", "out_p1")] }],
      [["s"], { nodes: [n("clip", "ugc-clip")], edges: [] }],
    ])
    expect(sorted(ugcStripSet(graph).strip.get(ROOT))).toEqual(["after", "s", "s_iter_0"])
  })
})

describe("the read that composes the graph (ugcReadComposedGraph)", () => {
  const loaded = (nodes: N[], edges: unknown[] = []): UgcPartLoad => ({ kind: "loaded", part: { nodes, edges } as unknown as UgcGraphPart })

  it("each distinct graph is loaded once per read, however many nodes reference it, at whatever depth", async () => {
    const child = [sub("x", "wf-leaf"), sub("y", "wf-leaf")]
    const subWorkflow = vi.fn(async (ref: string): Promise<UgcPartLoad> => (ref === "wf-mid" ? loaded(child) : ref === "wf-leaf" ? loaded([n("clip", "ugc-clip")]) : { kind: "missing" }))
    const top = [sub("a", "wf-mid"), sub("b", "wf-mid"), sub("c", "wf-mid"), sub("d", "wf-leaf")]
    const read = await ugcReadComposedGraph(top, [], { subWorkflow }, { maxDepth: 5, ownerId: "owner" })
    expect(read.loads).toBe(2)
    expect(subWorkflow.mock.calls.map(([ref]) => ref).sort()).toEqual(["wf-leaf", "wf-mid"])
    // Every place is still read: a node two levels down under each parent.
    expect(read.graph.has(key("c", "y"))).toBe(true)
    expect(sorted(ugcStripSet(read.graph, read.opaque).strip.get(ROOT))).toEqual(["a", "b", "c", "d"])
  })

  it("a graph found deep and then shallow is still read at its shallow place: the deep visit's depth limit never hides it", async () => {
    const parts: Record<string, N[]> = {
      "wf-a": [sub("toB", "wf-b"), sub("toX", "wf-x")],
      "wf-b": [sub("toC", "wf-c")],
      "wf-c": [sub("toD", "wf-d")],
      "wf-d": [sub("toX", "wf-x")],
      "wf-x": [sub("toU", "wf-u")],
      "wf-u": [n("clip", "ugc-clip")],
    }
    const subWorkflow = async (ref: string): Promise<UgcPartLoad> => (parts[ref] ? loaded(parts[ref]!) : { kind: "missing" })
    const read = await ugcReadComposedGraph([sub("p", "wf-a")], [], { subWorkflow }, { maxDepth: 5, ownerId: "owner" })
    expect(sorted(ugcStripSet(read.graph, read.opaque).strip.get(ROOT))).toEqual(["p"])
  })

  it("a cycle, the depth limit, the read's cap, a missing graph and a failed one each leave the node opaque — and a failure is told apart", async () => {
    const subWorkflow = vi.fn(async (ref: string): Promise<UgcPartLoad> => {
      if (ref === "wf-self") return loaded([sub("again", "wf-self")])
      if (ref === "wf-error") return { kind: "error" }
      if (ref === "wf-x" || ref === "wf-y") return loaded([n("g", "generate-image")])
      return { kind: "missing" }
    })
    const read = await ugcReadComposedGraph([sub("self", "wf-self"), sub("gone", "wf-gone"), sub("broken", "wf-error")], [], { subWorkflow }, { maxDepth: 5, ownerId: "owner" })
    expect(sorted(read.opaque.get(ROOT))).toEqual(["broken", "gone"])
    expect(sorted(read.opaque.get(key("self")))).toEqual(["again"])
    expect(read.failed).toBe(true)
    // The cap counts distinct graphs: the second distinct one is past a cap of one; a graph met again costs nothing.
    subWorkflow.mockClear()
    const capped = await ugcReadComposedGraph([sub("a", "wf-x"), sub("a2", "wf-x"), sub("b", "wf-y")], [], { subWorkflow }, { maxDepth: 5, ownerId: "owner", maxParts: 1 })
    expect(sorted(capped.opaque.get(ROOT))).toEqual(["b"])
    expect(subWorkflow.mock.calls.map(([ref]) => ref)).toEqual(["wf-x"])
    expect(UGC_COMPOSED_MAX_PARTS).toBeGreaterThan(50)
  })

  it("a node that names no graph is a plain node; one that names none but holds outputs is opaque", async () => {
    const subWorkflow = vi.fn(async (): Promise<UgcPartLoad> => ({ kind: "missing" }))
    const read = await ugcReadComposedGraph([n("unset", "sub-workflow"), n("bare", "component"), n("leftover", "sub-workflow", { generatedResults: [{ url: "https://cdn.example/old.mp4" }] })], [], { subWorkflow }, { maxDepth: 5, ownerId: "owner" })
    expect(sorted(read.opaque.get(ROOT))).toEqual(["leftover"])
    expect(subWorkflow).not.toHaveBeenCalled()
  })

  it("a level's new graphs load together, and no graph past the cap is ever asked for: a tree of 363 distinct graphs costs 200 loads", async () => {
    let inFlight = 0
    let most = 0
    const subWorkflow = vi.fn(async (ref: string): Promise<UgcPartLoad> => {
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      const depth = ref.split("-").length - 1
      return loaded(depth < 5 ? [0, 1, 2].map((i) => sub(`s${i}`, `${ref}-${i}`)) : [n("g", "generate-image")])
    })
    const read = await ugcReadComposedGraph([0, 1, 2].map((i) => sub(`s${i}`, `wf-${i}`)), [], { subWorkflow }, { maxDepth: 5, ownerId: "owner" })
    expect(subWorkflow.mock.calls.length).toBeLessThanOrEqual(UGC_COMPOSED_MAX_PARTS)
    expect(read.loads).toBeLessThanOrEqual(UGC_COMPOSED_MAX_PARTS)
    expect(most).toBeGreaterThan(1)
  })

  it("a component's snapshot is read by its slug and pinned version, its own sub-workflows as its creator's", async () => {
    const subWorkflow = vi.fn(async (_ref: string, owner: string | undefined): Promise<UgcPartLoad> => (owner === "component-creator" ? loaded([n("clip", "ugc-clip")]) : { kind: "missing" }))
    const component = vi.fn(async (): Promise<UgcPartLoad> => ({ kind: "loaded", part: { nodes: [sub("inner", "wf-inner")], edges: [], ownerId: "component-creator" } as unknown as UgcGraphPart }))
    const read = await ugcReadComposedGraph([n("comp", "component", { appSlug: "maker", pinnedVersion: 3 })], [], { subWorkflow, component }, { maxDepth: 5, ownerId: "author" })
    expect(component).toHaveBeenCalledWith("maker", 3)
    expect(subWorkflow).toHaveBeenCalledWith("wf-inner", "component-creator")
    expect(read.graph.get(key("comp"))?.component).toBe(true)
    expect(sorted(ugcStripSet(read.graph, read.opaque).strip.get(ROOT))).toEqual(["comp"])
  })
})
