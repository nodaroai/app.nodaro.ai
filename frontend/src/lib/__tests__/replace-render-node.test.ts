import { describe, it, expect } from "vitest"
import { RENDER_NODE_TYPE_IDS, renderTranscriptOutputOf } from "@nodaro/shared"
import { NODE_DEFINITIONS, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"
import {
  planRenderSwap,
  renderMediaHandleOf,
  rendersNeedingSpeakerView,
  replaceRenderNode,
  SPEAKER_VIEW_TYPE,
} from "../replace-render-node"

// The render types under test come from the registry, never a literal of the
// node they replace (the render-node census keeps `apply-edl` literals out of
// any site that is not its own registration).
const SV = SPEAKER_VIEW_TYPE
const AE = RENDER_NODE_TYPE_IDS.find((t) => t !== SV)!

/** The name a type's node is created with (its `defaultData.label`). */
const defaultLabelOf = (type: string): string =>
  (NODE_DEFINITIONS.find((d) => d.type === type)?.defaultData as { label?: string } | undefined)?.label ?? ""

const node = (id: string, type: string, data: Record<string, unknown> = {}, extra: Partial<WorkflowNode> = {}) =>
  ({ id, type, position: { x: 10, y: 20 }, data: { label: id, ...data }, ...extra }) as unknown as WorkflowNode
const edge = (id: string, source: string, sourceHandle: string | null, target: string, targetHandle: string | null, data?: Record<string, unknown>) =>
  ({ id, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) }) as WorkflowEdge

const edlOf = (url: string) => ({
  version: 1,
  clock: "master",
  sources: [{ id: "camA", url, kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: 60_000, video: "camA" }],
})

/** Camera Switch → (edl) render (transcript) ← Transcribe; Cam A → (sources);
 *  the render's media → Combine Videos, its transcript json → Add Captions. */
function graph(renderType: string, renderData: Record<string, unknown> = {}, edlUrl = "https://cdn/a.mp4") {
  const cs = node("cs", "camera-switch", { generatedJson: { edl: edlOf(edlUrl) } })
  const tr = node("tr", "transcribe")
  const cam = node("cam", "upload-video", { url: "https://cdn/cam.mp4" })
  const r = node("r", renderType, { quality: "proxy", crossfadeMs: 200, generatedVideoUrl: "https://cdn/out.mp4", generatedResults: [{ url: "x" }], activeResultIndex: 0, ...renderData }, { selected: true, parentId: "g" })
  const cv = node("cv", "combine-videos", { clipOrder: ["other", "r"], fieldMappings: { prompt: { sourceNodeId: "r" } } })
  const ac = node("ac", "add-captions")
  const nodes = [cs, tr, cam, r, cv, ac]
  const transcriptOut = renderTranscriptOutputOf(renderType)!.handle
  const edges = [
    edge("e-edl", "cs", "edl", "r", "edl"),
    edge("e-tr", "tr", "json", "r", "transcript"),
    edge("e-src", "cam", null, "r", "sources"),
    edge("e-media", "r", renderMediaHandleOf(renderType)!, "cv", "in", { outputMode: "each" }),
    edge("e-cap", "r", transcriptOut, "ac", "transcript"),
  ]
  return { nodes, edges }
}

const swapTo = (g: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, from: string, to: string, data: Record<string, unknown> = { label: "Default", quality: "final", fieldMappings: {} }) =>
  replaceRenderNode(g, from, to, { id: "node_99", data })

describe("replaceRenderNode — Apply EDL to Speaker View (SV16 b, outgoing edges option iii)", () => {
  it("swaps in place: a new id, the same position and parent, the label and quality carried, nothing else", () => {
    const g = graph(AE)
    const out = swapTo(g, "r", SV)
    if (!out.ok) throw new Error(out.reason)
    const idx = g.nodes.findIndex((n) => n.id === "r")
    const swapped = out.nodes[idx]!
    expect(swapped.id).toBe("node_99")
    expect(swapped.type).toBe(SV)
    expect(swapped.position).toEqual({ x: 10, y: 20 })
    expect(swapped.parentId).toBe("g")
    expect(swapped.selected).toBe(true)
    // Run history is NOT carried: those renders are on the old node's clock.
    expect(swapped.data).toEqual({ label: "r", quality: "proxy", fieldMappings: {} })
    expect(out.nodes.some((n) => n.id === "r")).toBe(false)
    expect(out.nodes).toHaveLength(g.nodes.length)
  })

  it("keeps the edl and transcript input wires, on the new node", () => {
    const out = swapTo(graph(AE), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.find((e) => e.id === "e-edl")).toMatchObject({ source: "cs", target: "node_99", targetHandle: "edl" })
    expect(out.edges.find((e) => e.id === "e-tr")).toMatchObject({ source: "tr", target: "node_99", targetHandle: "transcript" })
  })

  it("drops the sources wire and lists it", () => {
    const out = swapTo(graph(AE), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.some((e) => e.id === "e-src")).toBe(false)
    expect(out.plan.dropped).toEqual([{ edgeId: "e-src", direction: "in", handle: "sources", nodeId: "cam" }])
  })

  it("moves the media wire onto Speaker View's video, the edge's own settings kept", () => {
    const out = swapTo(graph(AE), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.find((e) => e.id === "e-media")).toMatchObject({
      source: "node_99", sourceHandle: renderMediaHandleOf(SV), target: "cv", targetHandle: "in", data: { outputMode: "each" },
    })
  })

  it("moves the json → Add Captions wire onto Speaker View's transcript output (decided 2026-10-08, option iii)", () => {
    const out = swapTo(graph(AE), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.find((e) => e.id === "e-cap")).toMatchObject({
      source: "node_99", sourceHandle: renderTranscriptOutputOf(SV)!.handle, target: "ac", targetHandle: "transcript",
    })
    expect(out.plan.moved).toContainEqual({ edgeId: "e-cap", direction: "out", handle: "json", nodeId: "ac", to: "transcript" })
  })

  it("a media wire saved with no handle (the default pip) moves too", () => {
    const g = graph(AE)
    const edges = g.edges.map((e) => (e.id === "e-media" ? { ...e, sourceHandle: null } : e))
    const out = swapTo({ nodes: g.nodes, edges }, "r", SV)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.find((e) => e.id === "e-media")).toMatchObject({ source: "node_99", sourceHandle: renderMediaHandleOf(SV) })
  })

  it("renames the old id where a downstream node names its producer (an order list, a field mapping)", () => {
    const out = swapTo(graph(AE), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    const cv = out.nodes.find((n) => n.id === "cv")!.data as Record<string, unknown>
    expect(cv.clipOrder).toEqual(["other", "node_99"])
    expect(cv.fieldMappings).toEqual({ prompt: { sourceNodeId: "node_99" } })
  })

  it("a List column on a moved wire follows it — id and handle", () => {
    const g = graph(AE)
    const list = node("l", "list", { columns: [{ id: "c1", connectedSourceId: "r", connectedSourceHandle: "json" }, { id: "c2", connectedSourceId: "cam" }] })
    const out = swapTo({ nodes: [...g.nodes, list], edges: [...g.edges, edge("e-l", "r", "json", "l", "c1")] }, "r", SV)
    if (!out.ok) throw new Error(out.reason)
    const cols = (out.nodes.find((n) => n.id === "l")!.data as { columns: unknown[] }).columns
    expect(cols).toEqual([{ id: "c1", connectedSourceId: "node_99", connectedSourceHandle: "transcript" }, { id: "c2", connectedSourceId: "cam" }])
  })

  it("a label that is only the old type's default name is not carried: the new node takes its own default", () => {
    const aeDefault = defaultLabelOf(AE)
    const svDefault = defaultLabelOf(SV)
    expect(aeDefault).toBeTruthy()
    expect(svDefault).toBeTruthy()
    const out = swapTo(graph(AE, { label: aeDefault }), "r", SV, { label: svDefault, fieldMappings: {} })
    if (!out.ok) throw new Error(out.reason)
    expect(out.nodes.find((n) => n.id === "node_99")!.data).toMatchObject({ label: svDefault })
  })

  it("and back: a Speaker View nobody renamed becomes an Apply EDL with Apply EDL's name", () => {
    const out = swapTo(graph(SV, { label: defaultLabelOf(SV) }), "r", AE, { label: defaultLabelOf(AE), fieldMappings: {} })
    if (!out.ok) throw new Error(out.reason)
    expect(out.nodes.find((n) => n.id === "node_99")!.data).toMatchObject({ label: defaultLabelOf(AE) })
  })

  it("a label the person changed is carried, even when it is another type's default name", () => {
    const out = swapTo(graph(AE, { label: defaultLabelOf(SV) }), "r", SV, { label: defaultLabelOf(SV), fieldMappings: {} })
    if (!out.ok) throw new Error(out.reason)
    expect(out.nodes.find((n) => n.id === "node_99")!.data).toMatchObject({ label: defaultLabelOf(SV) })
    const renamed = swapTo(graph(AE, { label: `${defaultLabelOf(AE)} (wide)` }), "r", SV, { label: defaultLabelOf(SV), fieldMappings: {} })
    if (!renamed.ok) throw new Error(renamed.reason)
    expect(renamed.nodes.find((n) => n.id === "node_99")!.data).toMatchObject({ label: `${defaultLabelOf(AE)} (wide)` })
  })

  it("leaves every untouched node and edge as the same object", () => {
    const g = graph(AE)
    const out = swapTo(g, "r", SV)
    if (!out.ok) throw new Error(out.reason)
    for (const id of ["cs", "tr", "cam", "ac"]) expect(out.nodes.find((n) => n.id === id)).toBe(g.nodes.find((n) => n.id === id))
  })
})

describe("planRenderSwap — refused up front, nothing changed", () => {
  it("an audio render: Speaker View has no audio-only render", () => {
    const g = graph(AE, { output: "audio" })
    expect(planRenderSwap("r", g.nodes, g.edges, SV)).toEqual({ ok: false, reason: "medium" })
    expect(swapTo(g, "r", SV)).toEqual({ ok: false, reason: "medium" })
  })

  it("cameras that come from the Sources wire (TA1): the EDL's empty url is filled by the wire the swap drops", () => {
    const g = graph(AE, {}, "")
    expect(planRenderSwap("r", g.nodes, g.edges, SV)).toEqual({ ok: false, reason: "cameras-from-sources" })
  })

  it("a Sources wire over cameras the EDL already names is dropped, not refused", () => {
    const g = graph(AE)
    expect(planRenderSwap("r", g.nodes, g.edges, SV)).toMatchObject({ ok: true })
  })

  it("an empty url with no Sources wire is not the TA1 case (the render rule already refuses it)", () => {
    const g = graph(AE, {}, "")
    const edges = g.edges.filter((e) => e.id !== "e-src")
    expect(planRenderSwap("r", g.nodes, edges, SV)).toMatchObject({ ok: true })
  })

  it("a node that is not a render, a missing node, and a swap to its own type", () => {
    const g = graph(AE)
    expect(planRenderSwap("cv", g.nodes, g.edges, SV)).toEqual({ ok: false, reason: "not-a-render" })
    expect(planRenderSwap("nope", g.nodes, g.edges, SV)).toEqual({ ok: false, reason: "not-a-render" })
    expect(planRenderSwap("r", g.nodes, g.edges, "combine-videos")).toEqual({ ok: false, reason: "not-a-render" })
    expect(planRenderSwap("r", g.nodes, g.edges, AE)).toEqual({ ok: false, reason: "same-type" })
  })

  it("summarises the swap: what is kept, moved and dropped", () => {
    const g = graph(AE)
    const plan = planRenderSwap("r", g.nodes, g.edges, SV)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.kept.map((w) => w.handle)).toEqual(["edl", "transcript"])
    expect(plan.moved.map((w) => w.edgeId)).toEqual(["e-media", "e-cap"])
    expect(plan.dropped.map((w) => w.edgeId)).toEqual(["e-src"])
  })
})

describe("replaceRenderNode — swapping back (decided 2026-10-08)", () => {
  it("Speaker View's transcript wire moves back to Apply EDL's json; its EDL json wire is dropped and listed", () => {
    const g = graph(SV)
    const withEdl = { nodes: [...g.nodes, node("sv2", SV)], edges: [...g.edges.filter((e) => e.id !== "e-src"), edge("e-edlout", "r", "json", "sv2", "edl")] }
    const out = swapTo(withEdl, "r", AE)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.find((e) => e.id === "e-cap")).toMatchObject({ source: "node_99", sourceHandle: "json", target: "ac" })
    expect(out.edges.find((e) => e.id === "e-media")).toMatchObject({ source: "node_99", sourceHandle: renderMediaHandleOf(AE) })
    expect(out.edges.some((e) => e.id === "e-edlout")).toBe(false)
    expect(out.plan.dropped).toEqual([{ edgeId: "e-edlout", direction: "out", handle: "json", nodeId: "sv2" }])
  })

  it("a node whose only wire was the dropped EDL json loses its field mapping to the render, as deleting that wire does", () => {
    const g = graph(SV)
    const sv2 = node("sv2", SV, { fieldMappings: { edl: { sourceNodeId: "r" }, transcript: { sourceNodeId: "tr" } } })
    const withEdl = { nodes: [...g.nodes, sv2], edges: [...g.edges.filter((e) => e.id !== "e-src"), edge("e-edlout", "r", "json", "sv2", "edl")] }
    const out = swapTo(withEdl, "r", AE)
    if (!out.ok) throw new Error(out.reason)
    expect(out.edges.some((e) => e.target === "sv2")).toBe(false)
    expect((out.nodes.find((n) => n.id === "sv2")!.data as Record<string, unknown>).fieldMappings).toEqual({ transcript: { sourceNodeId: "tr" } })
  })

  it("a node still wired to the render by a moved wire keeps its field mapping, renamed, when another of its wires is dropped", () => {
    const g = graph(SV)
    const cv = g.nodes.find((n) => n.id === "cv")!
    const withEdl = { nodes: g.nodes, edges: [...g.edges.filter((e) => e.id !== "e-src"), edge("e-edlout", "r", "json", cv.id, "prompt")] }
    const out = swapTo(withEdl, "r", AE)
    if (!out.ok) throw new Error(out.reason)
    expect(out.plan.dropped.map((w) => w.edgeId)).toEqual(["e-edlout"])
    expect((out.nodes.find((n) => n.id === "cv")!.data as Record<string, unknown>).fieldMappings).toEqual({ prompt: { sourceNodeId: "node_99" } })
  })

  it("there and back: the Add Captions wire is on Apply EDL's json again, nothing dropped but the sources wire", () => {
    const g = graph(AE)
    const there = swapTo(g, "r", SV)
    if (!there.ok) throw new Error(there.reason)
    const back = replaceRenderNode(there, "node_99", AE, { id: "node_100", data: { label: "Default", fieldMappings: {} } })
    if (!back.ok) throw new Error(back.reason)
    expect(back.edges.find((e) => e.id === "e-cap")).toMatchObject({ source: "node_100", sourceHandle: "json", target: "ac", targetHandle: "transcript" })
    expect(back.plan.dropped).toEqual([])
  })
})

describe("renderMediaHandleOf — the one media pip, derived from the node definitions", () => {
  it("every render has exactly one", () => {
    for (const t of RENDER_NODE_TYPE_IDS) expect(renderMediaHandleOf(t)).toEqual(expect.any(String))
  })
})

describe("rendersNeedingSpeakerView — a hinted edit Apply EDL refuses (U6)", () => {
  const hinted = {
    ...edlOf("https://cdn/a.mp4"),
    sources: [{ id: "camA", url: "https://cdn/a.mp4", kind: "video" }, { id: "camB", url: "https://cdn/b.mp4", kind: "video" }],
    segments: [{ id: "s0", inMs: 0, outMs: 60_000, video: "camA", layout: { mode: "side-by-side", slots: [{ source: "camA" }, { source: "camB" }] } }],
  }
  const settings = { output: "video" as const, crossfadeMs: 0 }

  it("true when a render has a layout or region issue", () => {
    expect(rendersNeedingSpeakerView([{ edl: hinted, sources: [] }], settings)).toBe(true)
    expect(rendersNeedingSpeakerView([{ edl: JSON.stringify(hinted), sources: [] }], settings)).toBe(true)
  })

  it("false for a cut-only edit, an unparseable one and none", () => {
    expect(rendersNeedingSpeakerView([{ edl: edlOf("https://cdn/a.mp4"), sources: [] }], settings)).toBe(false)
    expect(rendersNeedingSpeakerView([{ edl: "{nope", sources: [] }], settings)).toBe(false)
    expect(rendersNeedingSpeakerView([], settings)).toBe(false)
  })
})

describe("planRenderSwap — the edit is not known yet (Round 2, decided 2026-10-08)", () => {
  it("before Camera Switch has run: allowed, the Sources wire dropped, and the plan says the cameras may need re-wiring", () => {
    const g = graph(AE)
    const nodes = g.nodes.map((n) => (n.id === "cs" ? node("cs", "camera-switch") : n))
    const plan = planRenderSwap("r", nodes, g.edges, SV)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.dropped.map((w) => w.edgeId)).toEqual(["e-src"])
    expect(plan.camerasUnjudged).toBe(true)
  })

  it("while the wired upload is empty and the edit leaves a camera's url to it: allowed, with the same warning", () => {
    const g = graph(AE, {}, "")
    const nodes = g.nodes.map((n) => (n.id === "cam" ? node("cam", "upload-video") : n))
    const plan = planRenderSwap("r", nodes, g.edges, SV)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.camerasUnjudged).toBe(true)
  })

  it("no warning when the edit is known and its cameras do not come from the wire", () => {
    const g = graph(AE)
    const plan = planRenderSwap("r", g.nodes, g.edges, SV)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.camerasUnjudged).toBe(false)
  })

  it("no warning when no input wire is dropped, edit known or not", () => {
    const g = graph(AE)
    const nodes = g.nodes.map((n) => (n.id === "cs" ? node("cs", "camera-switch") : n))
    const plan = planRenderSwap("r", nodes, g.edges.filter((e) => e.id !== "e-src"), SV)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.camerasUnjudged).toBe(false)
  })
})

describe("replaceRenderNode — an inline EDL or transcript carries over both ways (Round 2, decided 2026-10-08)", () => {
  const edl = edlOf("https://cdn/a.mp4")
  const transcript = { words: [{ word: "hi", start: 0, end: 0.4, speaker: "A" }] }

  it("Apply EDL → Speaker View: the typed-in edl and transcript come along, and the plan lists them", () => {
    const g = graph(AE, { edl: JSON.stringify(edl), transcript: JSON.stringify(transcript) })
    const out = swapTo(g, "r", SV)
    if (!out.ok) throw new Error(out.reason)
    const data = out.nodes.find((n) => n.id === "node_99")!.data as Record<string, unknown>
    expect(data.edl).toBe(JSON.stringify(edl))
    expect(data.transcript).toBe(JSON.stringify(transcript))
    expect(out.plan.inline).toEqual(["edl", "transcript"])
  })

  it("Speaker View → Apply EDL: an inline object is carried as its JSON text, the form every render reads an inline value in", () => {
    const g = graph(SV, { edl, transcript })
    const out = swapTo({ nodes: g.nodes, edges: g.edges.filter((e) => e.id !== "e-src") }, "r", AE)
    if (!out.ok) throw new Error(out.reason)
    const data = out.nodes.find((n) => n.id === "node_99")!.data as Record<string, unknown>
    expect(JSON.parse(data.edl as string)).toEqual(edl)
    expect(JSON.parse(data.transcript as string)).toEqual(transcript)
  })

  it("nothing typed in: nothing added", () => {
    const out = swapTo(graph(AE), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    const data = out.nodes.find((n) => n.id === "node_99")!.data as Record<string, unknown>
    expect("edl" in data || "transcript" in data).toBe(false)
    expect(out.plan.inline).toEqual([])
  })
})

describe("replaceRenderNode — the published app's items follow the node (Round 2, decided 2026-10-08)", () => {
  const ps = {
    runTarget: "workflow" as const,
    inputItems: [{ type: "node" as const, nodeId: "cs" }, { type: "node" as const, nodeId: "r" }],
    outputItems: [
      { type: "group" as const, id: "g1", title: "Out", items: [{ type: "output" as const, id: "o1", nodeId: "r", outputKey: "result" }] },
      { type: "node" as const, nodeId: "cv" },
    ],
    cardMeta: { r: { title: "The cut" }, cv: { title: "Reel" } },
    hiddenNodes: ["r"],
    outputDisplayModes: { r: "gallery" as const },
  }

  it("re-points every item, card and setting that names the old node; the rest are untouched", () => {
    const out = replaceRenderNode(graph(AE), "r", SV, { id: "node_99", data: { label: "Default", fieldMappings: {} } }, ps)
    if (!out.ok) throw new Error(out.reason)
    expect(out.presentationSettings).toEqual({
      runTarget: "workflow",
      inputItems: [{ type: "node", nodeId: "cs" }, { type: "node", nodeId: "node_99" }],
      outputItems: [
        { type: "group", id: "g1", title: "Out", items: [{ type: "output", id: "o1", nodeId: "node_99", outputKey: "result" }] },
        { type: "node", nodeId: "cv" },
      ],
      cardMeta: { node_99: { title: "The cut" }, cv: { title: "Reel" } },
      hiddenNodes: ["node_99"],
      outputDisplayModes: { node_99: "gallery" },
    })
    expect(out.presentationSettings!.inputItems![0]).toBe(ps.inputItems[0])
  })

  it("lists them for the confirm, saying which the new type cannot show", () => {
    const g = graph(SV)
    const plan = planRenderSwap("r", g.nodes, g.edges.filter((e) => e.id !== "e-src"), AE, ps)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.appItems).toEqual([
      { section: "input", kind: "node", shown: true },
      { section: "output", kind: "output", key: "result", shown: false },
    ])
    const fwd = planRenderSwap("r", graph(AE).nodes, graph(AE).edges, SV, ps)
    if (!fwd.ok) throw new Error(fwd.reason)
    expect(fwd.appItems).toContainEqual({ section: "output", kind: "output", key: "result", shown: true })
  })

  it("the node's own app flags (shown as an app input or output) come with it", () => {
    const out = swapTo(graph(AE, { presentationInput: true, presentationOutput: true, presentationDisplay: { size: "lg" } }), "r", SV)
    if (!out.ok) throw new Error(out.reason)
    expect(out.nodes.find((n) => n.id === "node_99")!.data).toMatchObject({ presentationInput: true, presentationOutput: true, presentationDisplay: { size: "lg" } })
  })

  it("an app with no items naming the node is returned as the same object", () => {
    const other = { runTarget: "workflow" as const, inputItems: [{ type: "node" as const, nodeId: "cs" }] }
    const out = replaceRenderNode(graph(AE), "r", SV, { id: "node_99", data: {} }, other)
    if (!out.ok) throw new Error(out.reason)
    expect(out.presentationSettings).toBe(other)
    expect(out.plan.appItems).toEqual([])
  })
})
