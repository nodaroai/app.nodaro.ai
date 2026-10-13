/**
 * At publish, the "My photo" UGC Creators — at any depth of the workflow and the
 * sub-workflow graphs it references — a MiniApp or component gives no way to
 * receive the runner's photo: every run of it would be refused (publishing
 * empties every value that can flow into a creator's photo input). The same
 * reading as the run's refusal: an input in the creator's photo influence set,
 * or the creator itself as an app input. Placeholders only.
 */
import { describe, expect, it, vi } from "vitest"
import { ugcComposedKey, ugcComposedOf, type UgcComposedGraph, type UgcGraphPart, type UgcPartLoad } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { appInputNodeIds, readUgcComposedGraph, ugcCreatorsWithoutPhotoInput } from "../ugc-publish-photo"

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const wire = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null) =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge
const photo = (from: string) => wire(from, "creator", "photo")
const CREATOR = n("creator", "ugc-creator", { source: "photo", gender: "woman" })
const missing = (nodes: WorkflowNode[], edges: WorkflowEdge[], inputs: string[] = []) =>
  ugcCreatorsWithoutPhotoInput(ugcComposedOf(nodes as never, edges as never), new Set(inputs)).map((x) => x.node.id)
/** A composed graph from parts given by sub-workflow path. */
const composed = (parts: Array<[string[], { nodes: WorkflowNode[]; edges: WorkflowEdge[] }]>): UgcComposedGraph =>
  new Map(parts.map(([path, part]) => [ugcComposedKey(path), part as unknown as UgcGraphPart]))

describe("a My photo creator with no way to receive the runner's photo", () => {
  it("is named when the app shows neither it nor anything that feeds its photo", () => {
    expect(missing([CREATOR], [])).toEqual(["creator"])
  })
  it("is not, when the app shows the creator: the runner gives the photo there", () => {
    expect(missing([CREATOR], [], ["creator"])).toEqual([])
  })
  it("is not, when an Upload Image wired into its photo pip is one of the app's inputs, whatever it holds", () => {
    const empty = n("up", "upload-image")
    expect(missing([CREATOR, empty], [photo("up")], ["up"])).toEqual([])
    expect(missing([CREATOR, n("up", "upload-image", { url: "https://cdn.example/author.png" })], [photo("up")], ["up"])).toEqual([])
    // An upload the app does not show gives nothing.
    expect(missing([CREATOR, empty], [photo("up")])).toEqual(["creator"])
  })
  it("is named when the only upload wired into its photo pip holds the author's image: it ships empty", () => {
    expect(missing([CREATOR, n("up", "upload-image", { url: "https://cdn.example/author.png", r2Url: "https://cdn.example/author.png" })], [photo("up")])).toEqual(["creator"])
  })
  it("reads an upload wired through a teleport pair as wired into its photo pip", () => {
    const nodes = [CREATOR, n("up", "upload-image", { url: "https://cdn.example/author.png" }), n("send", "teleport-send", { channel: "P" }), n("recv", "teleport-receive", { channel: "P" })]
    const edges = [wire("up", "send", "in"), wire("recv", "creator", "photo")]
    expect(missing(nodes, edges)).toEqual(["creator"])
    expect(missing(nodes, edges, ["up"])).toEqual([])
  })
  it("is named when a node makes the photo in the run from nothing the runner gives; not when one of the app's inputs feeds it", () => {
    expect(missing([CREATOR, n("gen", "generate-image")], [photo("gen")])).toEqual(["creator"])
    const nodes = [CREATOR, n("brief", "text-prompt"), n("gen", "generate-image")]
    const edges = [wire("brief", "gen", "prompt"), photo("gen")]
    expect(missing(nodes, edges)).toEqual(["creator"])
    expect(missing(nodes, edges, ["brief"])).toEqual([])
  })
  it("reads every step on the way: an upload behind an upscale, as one of the app's inputs or not", () => {
    const nodes = [CREATOR, n("up", "upload-image", { url: "https://cdn.example/author.png" }), n("step", "upscale-image")]
    const edges = [wire("up", "step", "image"), photo("step")]
    expect(missing(nodes, edges)).toEqual(["creator"])
    expect(missing(nodes, edges, ["up"])).toEqual([])
  })
  it("an input that feeds only another of its inputs is no photo", () => {
    expect(missing([CREATOR, n("up", "upload-image")], [wire("up", "creator", "category")], ["up"])).toEqual(["creator"])
  })
  it("a Text node or a picker setting up a step whose image is the upload gives no photo, as an input of the app or not; the upload does", () => {
    const nodes = [CREATOR, n("up", "upload-image"), n("brief", "text-prompt"), n("lens", "lens"), n("step", "modify-image")]
    const edges = [wire("up", "step", "image"), wire("brief", "step", "prompt"), wire("lens", "step", "cinematography"), photo("step")]
    expect(missing(nodes, edges, ["brief", "lens"])).toEqual(["creator"])
    expect(missing(nodes, edges, ["up", "lens"])).toEqual([])
  })
  it("an AI creator, or the author's own stored photo (emptied at publish), changes nothing", () => {
    expect(missing([n("creator", "ugc-creator", { source: "sampled" })], [])).toEqual([])
    expect(missing([n("creator", "ugc-creator", { source: "photo", photoUrl: "https://cdn.example/author.png" })], [])).toEqual(["creator"])
  })
})

describe("a My photo creator across sub-workflows", () => {
  const sub = (data: Record<string, unknown> = {}) => n("sub", "sub-workflow", { referencedWorkflowId: "wf-child", ...data })
  const input = () => n("in", "sub-workflow-input", { ports: [{ id: "i1", mediaType: "image" }] })
  const out = () => n("out", "sub-workflow-output", { ports: [{ id: "p1", mediaType: "image" }] })
  const named = (graph: UgcComposedGraph, inputs: string[] = []) => ugcCreatorsWithoutPhotoInput(graph, new Set(inputs)).map((x) => `${x.key}:${x.node.id}`)

  it("a creator inside a sub-workflow, fed through its input: named until one of the app's inputs feeds the sub-workflow node", () => {
    const graph = composed([
      [[], { nodes: [sub(), n("up", "upload-image")], edges: [wire("up", "sub", "in_i1")] }],
      [["sub"], { nodes: [input(), n("inner", "ugc-creator", { source: "photo" })], edges: [wire("in", "inner", "photo", "i1")] }],
    ])
    expect(named(graph)).toEqual([`${ugcComposedKey(["sub"])}:inner`])
    expect(named(graph, ["up"])).toEqual([])
  })

  it("a creator inside a sub-workflow fed only an upload in there: named — the upload is the author's, and no app input reaches it", () => {
    const graph = composed([
      [[], { nodes: [sub(), n("up", "upload-image")], edges: [] }],
      [["sub"], { nodes: [n("own", "upload-image", { url: "https://cdn.example/author.png" }), n("inner", "ugc-creator", { source: "photo" })], edges: [wire("own", "inner", "photo")] }],
    ])
    expect(named(graph, ["up"])).toEqual([`${ugcComposedKey(["sub"])}:inner`])
  })

  it("a creator inside a frozen sub-workflow does not run: not named", () => {
    const graph = composed([
      [[], { nodes: [sub({ skipped: true })], edges: [] }],
      [["sub"], { nodes: [n("inner", "ugc-creator", { source: "photo" })], edges: [] }],
    ])
    expect(named(graph)).toEqual([])
  })

  it("a creator fed from a sub-workflow's output: named when the output comes from inside it; not when one of the app's inputs reaches it through the sub-workflow's input", () => {
    const parent = { nodes: [sub(), CREATOR, n("up", "upload-image")], edges: [wire("up", "sub", "in_i1"), wire("sub", "creator", "photo", "out_p1")] }
    const own = composed([[[], parent], [["sub"], { nodes: [n("own", "upload-image"), out()], edges: [wire("own", "out", "p1")] }]])
    expect(named(own, ["up"])).toEqual([`${ugcComposedKey([])}:creator`])
    const through = composed([[[], parent], [["sub"], { nodes: [input(), n("step", "upscale-image"), out()], edges: [wire("in", "step", "image", "i1"), wire("step", "out", "p1")] }]])
    expect(named(through)).toEqual([`${ugcComposedKey([])}:creator`])
    expect(named(through, ["up"])).toEqual([])
  })
})

describe("reading the referenced graphs (readUgcComposedGraph)", () => {
  it("every sub-workflow at any depth, by the reference the editor writes or the one a run reads; each reference once on a path, each graph read once", async () => {
    const child = { nodes: [n("inner", "sub-workflow", { workflowId: "wf-inner" })], edges: [] }
    const inner = { nodes: [n("again", "sub-workflow", { referencedWorkflowId: "wf-child" }), n("leaf", "upload-image")], edges: [] }
    const read = vi.fn(async (ref: string): Promise<UgcPartLoad> => {
      const part = ref === "wf-child" ? child : ref === "wf-inner" ? inner : null
      return part ? { kind: "loaded", part: part as unknown as UgcGraphPart } : { kind: "missing" }
    })
    const top = [n("sub", "sub-workflow", { referencedWorkflowId: "wf-child" }), n("twin", "sub-workflow", { referencedWorkflowId: "wf-child" }), n("gone", "sub-workflow", { referencedWorkflowId: "wf-missing" })]
    const graph = await readUgcComposedGraph(top, [], read)
    expect([...graph.keys()].sort()).toEqual([ugcComposedKey([]), ugcComposedKey(["sub"]), ugcComposedKey(["sub", "inner"]), ugcComposedKey(["twin"]), ugcComposedKey(["twin", "inner"])].sort())
    expect(read.mock.calls.map(([ref]) => ref).sort()).toEqual(["wf-child", "wf-inner", "wf-missing"])
  })
})

describe("a component's My photo creator with no way to receive the runner's photo", () => {
  // A component's caller sets only its input handles, and a creator's own handle carries its source, never a photo.
  const missingInComponent = (nodes: WorkflowNode[], edges: WorkflowEdge[], inputs: string[] = []) =>
    ugcCreatorsWithoutPhotoInput(ugcComposedOf(nodes as never, edges as never), new Set(inputs), { creatorTakesPhoto: false }).map((x) => x.node.id)
  it("is named even when the creator is one of the component's inputs", () => {
    expect(missingInComponent([CREATOR], [], ["creator"])).toEqual(["creator"])
  })
  it("is not, when an Upload Image wired into its photo pip is a component input — never one that only holds the author's image", () => {
    const empty = n("up", "upload-image")
    expect(missingInComponent([CREATOR, empty], [photo("up")], ["up"])).toEqual([])
    expect(missingInComponent([CREATOR, n("up", "upload-image", { url: "https://cdn.example/author.png" })], [photo("up")])).toEqual(["creator"])
    expect(missingInComponent([CREATOR, empty], [photo("up")])).toEqual(["creator"])
  })
  it("a sub-workflow input's port feeds it once that port is one of the component's handles; a node that makes the photo in the run does not", () => {
    expect(missingInComponent([CREATOR, n("port", "sub-workflow-input")], [photo("port")], ["port"])).toEqual([])
    expect(missingInComponent([CREATOR, n("port", "sub-workflow-input")], [photo("port")])).toEqual(["creator"])
    expect(missingInComponent([CREATOR, n("gen", "generate-image")], [photo("gen")])).toEqual(["creator"])
  })
  it("a sub-workflow input's port: a handle that takes text gives no photo; one that takes an image does", () => {
    const nodes = [CREATOR, n("in", "sub-workflow-input", { ports: [{ id: "face", mediaType: "image" }, { id: "brand", mediaType: "text" }] })]
    const edges = [wire("in", "creator", "photo", "face")]
    const named = (image: string[], any: string[]) =>
      ugcCreatorsWithoutPhotoInput(ugcComposedOf(nodes as never, edges as never), { image: new Set(image), any: new Set(any) }, { creatorTakesPhoto: false }).map((x) => x.node.id)
    expect(named([], ["in"])).toEqual(["creator"])
    expect(named(["in"], ["in"])).toEqual([])
  })
  it("is named when the only upload behind a step is not a component input; not when it is one", () => {
    const nodes = [CREATOR, n("up", "upload-image"), n("step", "upscale-image")]
    const edges = [wire("up", "step", "image"), photo("step")]
    expect(missingInComponent(nodes, edges)).toEqual(["creator"])
    expect(missingInComponent(nodes, edges, ["up"])).toEqual([])
  })
})

describe("the nodes a published app shows as inputs (the server's own reading)", () => {
  const nodes = [n("a", "text-prompt", { presentationInput: true }), n("b", "upload-image"), n("g", "generate-image", { presentationInput: true })]
  it("its curated list first, groups included; then its input order; then every node of a type an app takes as an input by itself", () => {
    expect([...appInputNodeIds(nodes, { inputItems: [{ type: "group", items: [{ type: "node", nodeId: "b" }] }] } as never)]).toEqual(["b"])
    expect([...appInputNodeIds(nodes, { inputOrder: ["b"] } as never)]).toEqual(["b"])
    expect([...appInputNodeIds(nodes, undefined)]).toEqual(["a", "b"])
  })
})
