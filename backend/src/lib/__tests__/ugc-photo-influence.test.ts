/**
 * The photo influence set (`ugcPhotoInfluence`, @nodaro/render-rules): every node, in a workflow
 * and every sub-workflow graph it references, whose value can flow into a UGC Creator's photo
 * input. Read upstream from each photo input over every way one node feeds another, across
 * teleport pairs, and across sub-workflow ports both ways: a sub-workflow node reads from where
 * its graph's output comes from, and a sub-workflow's input node from what feeds that
 * sub-workflow node above it. The ids are placeholders.
 */
import { describe, expect, it } from "vitest"
import {
  ugcComposedKey,
  ugcComposedOf,
  ugcCreatorPhotoInfluence,
  ugcPhotoInfluence,
  ugcSubWorkflowsHoldingUgc,
  type UgcComposedGraph,
} from "@nodaro/render-rules"

type N = { id: string; type: string; parentId?: string; data: Record<string, unknown> }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data: { label: id, ...data } })
const e = (source: string, target: string, targetHandle = "in", sourceHandle: string | null = null) => ({ source, target, targetHandle, sourceHandle })
const creator = (id = "creator") => n(id, "ugc-creator", { source: "photo", gender: "woman" })
const sub = (id = "sub", ref = "wf-child", data: Record<string, unknown> = {}) => n(id, "sub-workflow", { referencedWorkflowId: ref, ...data })
const out = (id = "out", data: Record<string, unknown> = {}) => n(id, "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }], ...data })
const input = (id = "in", data: Record<string, unknown> = {}) => n(id, "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }], ...data })

const ROOT = ugcComposedKey([])
const key = (...path: string[]) => ugcComposedKey(path)
/** A composed graph from parts given by path. */
function composed(parts: Array<[string[], { nodes: N[]; edges: unknown[] }]>): UgcComposedGraph {
  return new Map(parts.map(([path, part]) => [ugcComposedKey(path), part as never]))
}
const sorted = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort()
const single = (nodes: N[], edges: unknown[]) => ugcPhotoInfluence(ugcComposedOf(nodes, edges as never)).get(ROOT)

describe("in one graph", () => {
  it("an upload wired straight in, or through a step or a teleport pair (wired or by its channel)", () => {
    expect(sorted(single([creator(), n("up", "upload-image")], [e("up", "creator", "photo")]))).toEqual(["up"])
    expect(sorted(single([creator(), n("up", "upload-image"), n("step", "upscale-image")], [e("up", "step", "image"), e("step", "creator", "photo")]))).toEqual(["step", "up"])
    const teleport = [creator(), n("up", "upload-image"), n("send", "teleport-send", { channel: "P" }), n("recv", "teleport-receive", { channel: "P" })]
    expect(sorted(single(teleport, [e("up", "send"), e("recv", "creator", "photo")]))).toEqual(["recv", "send", "up"])
  })

  it("everything that feeds a node in it: a Text node into an upload's link input, a prompt, a field mapping, a Group's members, a Preview's items, a clone's original", () => {
    const nodes: N[] = [
      creator(),
      n("link", "text-prompt", { text: "https://cdn.example/a.png" }),
      n("up", "upload-image"),
      n("brief", "text-prompt", { text: "a portrait" }),
      n("gen", "generate-image", { fieldMappings: { style: { sourceNodeId: "picker" } } }),
      n("picker", "styling"),
      n("group", "group"),
      { ...n("member", "upload-image"), parentId: "group" },
      n("preview", "preview", { previewItems: [{ sourceNodeId: "shown" }] }),
      n("shown", "upload-image"),
      n("gen_iter_0", "generate-image", { __expandedFrom: "gen" }),
    ]
    const edges = [e("link", "up", "in"), e("up", "gen", "reference"), e("brief", "gen", "prompt"), e("gen_iter_0", "creator", "photo"), e("group", "creator", "photo"), e("preview", "creator", "photo")]
    expect(sorted(single(nodes, edges))).toEqual(["brief", "gen", "gen_iter_0", "group", "link", "member", "picker", "preview", "shown", "up"])
  })

  it("what feeds a creator's other inputs is not in it, and a graph with no creator has none", () => {
    const nodes = [creator(), n("up", "upload-image"), n("script", "ugc-script"), n("shot", "upload-image"), n("person", "person")]
    const edges = [e("up", "creator", "photo"), e("shot", "script", "screenshot"), e("script", "creator", "category"), e("person", "creator", "pickers")]
    expect(sorted(single(nodes, edges))).toEqual(["up"])
    expect(sorted(single([n("up", "upload-image"), n("gen", "generate-image")], [e("up", "gen", "reference")]))).toEqual([])
  })

  it("a sub-workflow whose graph is not loaded, and a component node, are read from what feeds them", () => {
    expect(sorted(single([creator(), sub(), n("up", "upload-image")], [e("up", "sub", "i1"), e("sub", "creator", "photo", "out_p1")]))).toEqual(["sub", "up"])
    expect(sorted(single([creator(), n("comp", "component"), n("up", "upload-image")], [e("up", "comp", "image"), e("comp", "creator", "photo")]))).toEqual(["comp", "up"])
  })
})

describe("across sub-workflows", () => {
  it("a creator fed from a sub-workflow: where its graph's output comes from (a terminal node too: a run hands one out when the output node has nothing), back through its input to what feeds the sub-workflow", () => {
    const graph = composed([
      [[], { nodes: [creator(), sub(), n("up", "upload-image"), n("bg", "upload-image")], edges: [e("up", "sub", "in_i1"), e("sub", "creator", "photo", "out_p1"), e("bg", "creator", "category")] }],
      [["sub"], { nodes: [input(), n("own", "upload-image"), n("mix", "image-collage"), out(), n("aside", "upload-image"), n("note", "generate-image")], edges: [e("in", "mix", "in", "i1"), e("own", "mix", "in"), e("mix", "out", "p1"), e("aside", "note", "reference")] }],
    ])
    const influence = ugcPhotoInfluence(graph)
    expect(sorted(influence.get(ROOT))).toEqual(["sub", "up"])
    expect(sorted(influence.get(key("sub")))).toEqual(["aside", "in", "mix", "note", "out", "own"])
  })

  it("what a run can hand out: every output node and every terminal node it keeps; with the route's input and output named, only those on a path between them", () => {
    // Every output node, whichever route it names, and a terminal node beside them (a run reads the
    // terminal nodes when the output nodes hand out nothing).
    const unrouted = composed([
      [[], { nodes: [creator(), sub("sub", "wf-child", { selectedRouteId: "r2" })], edges: [e("sub", "creator", "photo", "out_p1")] }],
      [["sub"], { nodes: [n("a", "upload-image"), out("outA", { routeId: "r1" }), n("b", "upload-image"), out("outB", { routeId: "r2" }), n("stray", "upload-image")], edges: [e("a", "outA", "p1"), e("b", "outB", "p1")] }],
    ])
    expect(sorted(ugcPhotoInfluence(unrouted).get(key("sub")))).toEqual(["a", "b", "outA", "outB", "stray"])
    // A route the run filters to: only what lies between its input and output node.
    const routed = composed([
      [[], { nodes: [creator(), sub("sub", "wf-child", { routeSnapshot: { inputNodeId: "in", outputNodeId: "outB" } }), n("up", "upload-image")], edges: [e("up", "sub", "in_i1"), e("sub", "creator", "photo", "out_p1")] }],
      [["sub"], { nodes: [input(), n("a", "upscale-image"), out("outA"), n("b", "upscale-image"), out("outB"), n("stray", "upload-image")], edges: [e("in", "a", "image", "i1"), e("a", "outA", "p1"), e("in", "b", "image", "i1"), e("b", "outB", "p1")] }],
    ])
    const influence = ugcPhotoInfluence(routed)
    expect(sorted(influence.get(key("sub")))).toEqual(["b", "in", "outB"])
    expect(sorted(influence.get(ROOT))).toEqual(["sub", "up"])
    // No output node: the graph's terminal nodes.
    const terminal = composed([
      [[], { nodes: [creator(), sub()], edges: [e("sub", "creator", "photo", "out_p1")] }],
      [["sub"], { nodes: [n("up", "upload-image"), n("step", "upscale-image"), n("other", "generate-image")], edges: [e("up", "step", "image")] }],
    ])
    expect(sorted(ugcPhotoInfluence(terminal).get(key("sub")))).toEqual(["other", "step", "up"])
  })

  it("a crossing reads the whole sub-workflow node, never one port: a run hands every value given to it to its input node, and a port with no value reads another's", () => {
    const graph = composed([
      [[], { nodes: [sub(), n("up", "upload-image"), n("brand", "text-prompt")], edges: [e("up", "sub", "in_i1"), e("brand", "sub", "in_i2")] }],
      [["sub"], { nodes: [input("in", { ports: [{ id: "i1", mediaType: "image" }, { id: "i2", mediaType: "text" }] }), creator("inner")], edges: [e("in", "inner", "photo", "i1")] }],
    ])
    expect(sorted(ugcPhotoInfluence(graph).get(ROOT))).toEqual(["brand", "up"])
  })

  it("a creator inside a sub-workflow fed through its input: what feeds the sub-workflow above is in it", () => {
    const graph = composed([
      [[], { nodes: [sub(), n("up", "upload-image"), n("other", "upload-image")], edges: [e("up", "sub", "i1")] }],
      [["sub"], { nodes: [input(), creator("inner")], edges: [e("in", "inner", "photo", "i1")] }],
    ])
    const influence = ugcPhotoInfluence(graph)
    expect(sorted(influence.get(ROOT))).toEqual(["up"])
    expect(sorted(influence.get(key("sub")))).toEqual(["in"])
  })

  it("at any depth, both ways", () => {
    const graph = composed([
      [[], { nodes: [creator(), sub("s1", "wf-1"), n("up", "upload-image")], edges: [e("up", "s1", "i1"), e("s1", "creator", "photo", "out_p1")] }],
      [["s1"], { nodes: [input(), sub("s2", "wf-2"), out()], edges: [e("in", "s2", "i1", "i1"), e("s2", "out", "p1", "out_p1")] }],
      [["s1", "s2"], { nodes: [input(), n("step", "upscale-image"), out()], edges: [e("in", "step", "image", "i1"), e("step", "out", "p1")] }],
    ])
    const influence = ugcPhotoInfluence(graph)
    expect(sorted(influence.get(ROOT))).toEqual(["s1", "up"])
    expect(sorted(influence.get(key("s1")))).toEqual(["in", "out", "s2"])
    expect(sorted(influence.get(key("s1", "s2")))).toEqual(["in", "out", "step"])
  })

  it("one creator's own set leaves out what feeds only another's", () => {
    const graph = composed([[[], { nodes: [creator("a"), creator("b"), n("ua", "upload-image"), n("ub", "upload-image")], edges: [e("ua", "a", "photo"), e("ub", "b", "photo")] }]])
    expect(sorted(ugcCreatorPhotoInfluence(graph, ROOT, "a").get(ROOT))).toEqual(["ua"])
    expect(sorted(ugcPhotoInfluence(graph).get(ROOT))).toEqual(["ua", "ub"])
  })
})

describe("the sub-workflows that hold a UGC video", () => {
  it("one whose graph holds a UGC node at any depth, frozen or not; one that holds none is not", () => {
    const graph = composed([
      [[], { nodes: [sub("a", "wf-a"), sub("b", "wf-b", { skipped: true }), sub("c", "wf-c")], edges: [] }],
      [["a"], { nodes: [sub("inner", "wf-inner")], edges: [] }],
      [["a", "inner"], { nodes: [n("clip", "ugc-clip")], edges: [] }],
      [["b"], { nodes: [n("script", "ugc-script")], edges: [] }],
      [["c"], { nodes: [n("gen", "generate-video")], edges: [] }],
    ])
    const holding = ugcSubWorkflowsHoldingUgc(graph)
    expect(sorted(holding.get(ROOT))).toEqual(["a", "b"])
    expect(sorted(holding.get(key("a")))).toEqual(["inner"])
  })
})
