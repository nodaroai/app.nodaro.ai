/**
 * The one expansion every estimator prices a use-case node with: the chain it
 * builds, wired to the node's real upstream source (decided 2026-10-13).
 */
import { describe, it, expect } from "vitest"
import {
  expandUseCaseNodes,
  usecaseDescriptor,
  usecaseMediaKindOf,
  usecaseRenameInnerIds,
  withUseCaseMembers,
  type UseCaseDescriptor,
  type UseCaseSources,
  type UseCaseSourcesShape,
} from "@nodaro/render-rules"

const rec = { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: 3600 } } }
const bed = { id: "bed", type: "upload-audio", data: { url: "https://r2/bed.mp3" } }
const tighten = { id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", captions: false } }
const after = { id: "post", type: "social-media-format", data: {} }

describe("expandUseCaseNodes", () => {
  it("leaves a graph without use-case nodes untouched", () => {
    const x = expandUseCaseNodes([rec], [])
    expect(x.expanded).toBe(false)
    expect(x.nodes).toEqual([rec])
    expect(x.fees).toEqual([])
  })
  it("replaces the node by its chain, wired to the REAL upstream source and handle", () => {
    const x = expandUseCaseNodes([rec, tighten], [{ source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }])
    expect(x.nodes.map((n) => n.id).sort()).toEqual(["rec", "t1::uc-plan", "t1::uc-render", "t1::uc-silence", "t1::uc-transcribe"])
    expect(x.edges).toContainEqual({ source: "rec", sourceHandle: "video", target: "t1::uc-transcribe", targetHandle: "audio" })
    expect(x.edges).toContainEqual({ source: "rec", sourceHandle: "video", target: "t1::uc-render", targetHandle: "sources" })
    expect(x.fees).toEqual([{ nodeId: "t1", creditId: "use-case-fee:tighten-episode" }])
    expect(x.members.get("t1")).toHaveLength(4)
    expect(x.nodes.find((n) => n.id === "t1::uc-plan")!.data).toMatchObject({ sourceOrder: ["rec"] })
  })
  it("wires the music input's real source and rewires downstream consumers to the mapped output", () => {
    const x = expandUseCaseNodes([rec, bed, tighten, after], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "bed", target: "t1", sourceHandle: "audio", targetHandle: "music" },
      { source: "t1", target: "post", sourceHandle: "media", targetHandle: "in" },
    ])
    expect(x.edges).toContainEqual({ source: "bed", sourceHandle: "audio", target: "t1::uc-mix", targetHandle: "in" })
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-merge", sourceHandle: "video-out", target: "post", targetHandle: "in" }))
    // The mix's own node ids follow the renaming: it ducks under the render, and its music is the real bed.
    expect(x.nodes.find((n) => n.id === "t1::uc-mix")!.data).toMatchObject({ trackOrder: ["t1::uc-render", "bed"], duckUnder: "t1::uc-render" })
  })
  it("the json output leaves from the plan's edit", () => {
    const x = expandUseCaseNodes([rec, tighten, after], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "post", sourceHandle: "json", targetHandle: "in" },
    ])
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-plan", sourceHandle: "edl", target: "post" }))
  })
  it("a review-on node expands to the chain up to its render; consumers read the preview", () => {
    const review = { ...tighten, data: { ...tighten.data, captions: true, reviewBeforeRender: true } }
    const x = expandUseCaseNodes([rec, review, after], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "post", sourceHandle: "media", targetHandle: "in" },
    ])
    expect(x.nodes.map((n) => n.id)).not.toContain("t1::uc-captions")
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-render", sourceHandle: "media", target: "post" }))
  })
  it("whole chain: a review-on node keeps what its Render final runs, after its proxy render", () => {
    const review = { ...tighten, data: { ...tighten.data, captions: true, reviewBeforeRender: true } }
    const x = expandUseCaseNodes([rec, review, after], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "post", sourceHandle: "media", targetHandle: "in" },
    ], { chain: "whole" })
    expect(x.nodes.map((n) => n.id)).toContain("t1::uc-captions")
    expect(x.nodes.find((n) => n.id === "t1::uc-render")!.data).toMatchObject({ quality: "proxy" })
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-captions", sourceHandle: "video-out", target: "post" }))
  })
  it("the outer wire's data (its output mode) rides on every inner wire that replaces it", () => {
    const list = { id: "L", type: "list", data: { items: "a\nb" } }
    const x = expandUseCaseNodes([list, tighten], [{ source: "L", target: "t1", sourceHandle: "text", targetHandle: "media", data: { outputMode: "all" } }])
    const fromList = x.edges.filter((e) => e.source === "L")
    expect(fromList.map((e) => e.target).sort()).toEqual(["t1::uc-plan", "t1::uc-render", "t1::uc-silence", "t1::uc-transcribe"])
    for (const e of fromList) expect(e).toMatchObject({ data: { outputMode: "all" } })
  })
  it("a wire out of the node keeps the mode it had leaving it: none set is the node's own default (\"last\")", () => {
    const x = expandUseCaseNodes([rec, tighten, after, { ...after, id: "post2" }], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "post", sourceHandle: "media", targetHandle: "in" },
      // The plan behind `json` is an Edit Plan, whose own default is "each": the wire keeps the node's.
      { source: "t1", target: "post2", sourceHandle: "json", targetHandle: "in" },
    ])
    expect(x.edges).toContainEqual({ source: "t1::uc-render", sourceHandle: "media", target: "post", targetHandle: "in", data: { outputMode: "last" } })
    expect(x.edges).toContainEqual({ source: "t1::uc-plan", sourceHandle: "edl", target: "post2", targetHandle: "in", data: { outputMode: "last" } })
  })
  it("a mode set on a wire out of the node is kept, with the rest of its data", () => {
    const x = expandUseCaseNodes([rec, tighten, after], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "post", sourceHandle: "media", targetHandle: "in", data: { outputMode: "all", note: "kept" } },
    ])
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-render", target: "post", data: { outputMode: "all", note: "kept" } }))
  })
  it("the chain's own wires carry no data (a Tighten chain has no Each wire)", () => {
    const x = expandUseCaseNodes([rec, bed, tighten], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "bed", target: "t1", sourceHandle: "audio", targetHandle: "music" },
    ])
    for (const e of x.edges) expect(e).not.toHaveProperty("data")
  })
  it("a use-case node wired into another's media starts the inner wires at its mapped output, in the mode it had leaving it", () => {
    const second = { id: "t2", type: "tighten-episode", data: { captions: false } }
    const x = expandUseCaseNodes([rec, tighten, second], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "t2", sourceHandle: "media", targetHandle: "media" },
    ])
    expect(x.edges).toContainEqual({ source: "t1::uc-render", sourceHandle: "media", target: "t2::uc-transcribe", targetHandle: "audio", data: { outputMode: "last" } })
    expect(x.nodes.find((n) => n.id === "t2::uc-plan")!.data).toMatchObject({ sourceOrder: ["t1::uc-render"] })
  })
  it("into another use-case node, the wire's mode is the node's own default, never the inner source's", () => {
    // t1's `json` leaves from its Edit Plan, whose own default is "each": the wire into t2 keeps t1's ("last").
    const second = { id: "t2", type: "tighten-episode", data: { captions: false } }
    const x = expandUseCaseNodes([rec, tighten, second], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "t2", sourceHandle: "json", targetHandle: "media" },
    ])
    const intoT2 = x.edges.filter((e) => e.source === "t1::uc-plan" && e.target.startsWith("t2::"))
    expect(intoT2.length).toBeGreaterThan(0)
    for (const e of intoT2) expect(e).toMatchObject({ sourceHandle: "edl", data: { outputMode: "last" } })
  })
  it("into another use-case node, a mode set on the wire is kept with the rest of its data", () => {
    const second = { id: "t2", type: "tighten-episode", data: { captions: false } }
    const x = expandUseCaseNodes([rec, tighten, second], [
      { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
      { source: "t1", target: "t2", sourceHandle: "media", targetHandle: "media", data: { outputMode: "all", note: "kept" } },
    ])
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-render", target: "t2::uc-transcribe", data: { outputMode: "all", note: "kept" } }))
  })
  it("an audio source builds the audio chain", () => {
    const voice = { id: "v", type: "upload-audio", data: { url: "https://r2/ep.m4a" } }
    const x = expandUseCaseNodes([voice, tighten], [{ source: "v", target: "t1", sourceHandle: "audio", targetHandle: "media" }])
    expect(x.nodes.find((n) => n.id === "t1::uc-render")!.data).toMatchObject({ output: "audio" })
  })
  it("a node that hands on either kind, wired on its video, builds the video chain (never under-quote)", () => {
    const vc = { id: "vc", type: "voice-changer", data: {} }
    const x = expandUseCaseNodes([vc, { ...tighten, data: {} }], [{ source: "vc", target: "t1", sourceHandle: "video", targetHandle: "media" }])
    expect(x.nodes.find((n) => n.id === "t1::uc-render")!.data).toMatchObject({ output: "video" })
    expect(x.nodes.map((n) => n.id)).toContain("t1::uc-captions")
  })
  it("an unwired node prices its own placeholder source (the 180-minute ceiling)", () => {
    const x = expandUseCaseNodes([tighten], [])
    expect(x.nodes.map((n) => n.id)).toContain("t1::uc-source")
    expect(x.nodes.find((n) => n.id === "t1::uc-source")!.data).not.toHaveProperty("metadata")
  })
  it("run subsets that name the node name its members", () => {
    const x = expandUseCaseNodes([rec, tighten], [{ source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }])
    expect([...withUseCaseMembers(new Set(["t1"]), x.members)].sort()).toEqual(["t1", "t1::uc-plan", "t1::uc-render", "t1::uc-silence", "t1::uc-transcribe"])
    expect([...withUseCaseMembers(new Set(["rec"]), x.members)]).toEqual(["rec"])
  })
  it("never mutates its inputs", () => {
    const nodes = [rec, tighten]
    const edges = [{ source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }]
    const before = JSON.stringify({ nodes, edges })
    expandUseCaseNodes(nodes, edges)
    expect(JSON.stringify({ nodes, edges })).toBe(before)
  })
})

describe("expandUseCaseNodes: a Trailer (one delivery per format)", () => {
  const trailer = (data: Record<string, unknown> = {}) => ({ id: "tr", type: "episode-trailer", data: { label: "Trailer", ...data } })
  const cap = { id: "cap", type: "add-captions", data: {} }
  const recWire = { source: "rec", target: "tr", sourceHandle: "video", targetHandle: "media" }
  const capWire = { source: "tr", target: "cap", sourceHandle: "media", targetHandle: "in" }

  it("its deliveries leave from a stand-in List of its formats, newline-joined, on an Each wire (priced once per format)", () => {
    const x = expandUseCaseNodes([rec, trailer(), cap], [recWire, capWire])
    const list = x.nodes.find((n) => n.id === "tr::uc-deliveries")
    expect(list).toEqual({ id: "tr::uc-deliveries", type: "list", data: { items: "tr::uc-format-9x16\ntr::uc-format-1x1\ntr::uc-format-4x5" } })
    expect(x.edges).toContainEqual({ ...capWire, source: "tr::uc-deliveries", sourceHandle: "text", data: { outputMode: "each" } })
    // The stand-in runs whenever the node does, and costs nothing (a List): one fee.
    expect(x.members.get("tr")).toContain("tr::uc-deliveries")
    expect(x.fees).toEqual([{ nodeId: "tr", creditId: "use-case-fee:episode-trailer" }])
  })
  it("one format: no stand-in, the wire leaves from that format", () => {
    const x = expandUseCaseNodes([rec, trailer({ formats: ["16:9"] }), cap], [recWire, capWire])
    expect(x.nodes.map((n) => n.id)).not.toContain("tr::uc-deliveries")
    expect(x.edges).toContainEqual({ ...capWire, source: "tr::uc-format-16x9", sourceHandle: "media", data: { outputMode: "each" } })
  })
  it("its json leaves from the plan, one value", () => {
    const x = expandUseCaseNodes([rec, trailer(), cap], [recWire, { ...capWire, sourceHandle: "json" }])
    expect(x.edges).toContainEqual({ ...capWire, sourceHandle: "edl", source: "tr::uc-plan", data: { outputMode: "last" } })
  })
  it("review on: its consumers read the preview until its Render final", () => {
    const x = expandUseCaseNodes([rec, trailer({ reviewBeforeRender: true }), cap], [recWire, capWire])
    expect(x.nodes.map((n) => n.id)).not.toContain("tr::uc-format-9x16")
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "tr::uc-render", sourceHandle: "media", target: "cap" }))
  })
  it("a wired intro card is replaced by its real source, and Combine Videos plays it first", () => {
    const card = { id: "card", type: "upload-video", data: { url: "https://r2/card.mp4" } }
    const x = expandUseCaseNodes([rec, card, trailer()], [recWire, { source: "card", target: "tr", sourceHandle: "video", targetHandle: "introCard" }])
    expect(x.nodes.map((n) => n.id)).not.toContain("tr::uc-intro")
    expect(x.edges).toContainEqual({ source: "card", sourceHandle: "video", target: "tr::uc-combine", targetHandle: "in" })
    expect(x.nodes.find((n) => n.id === "tr::uc-combine")!.data).toMatchObject({ clipOrder: ["card", "tr::uc-render"] })
  })
})

describe("expandUseCaseNodes: a Clip Pack (one clip per planned clip)", () => {
  const pack = (data: Record<string, unknown> = {}) => ({ id: "cp", type: "clip-pack", data: { label: "Clip Pack", ...data } })
  const fmt = { id: "fmt", type: "social-media-format", data: {} }
  const recWire = { source: "rec", target: "cp", sourceHandle: "video", targetHandle: "media" }
  const clipsWire = { source: "cp", target: "fmt", sourceHandle: "clips", targetHandle: "media" }

  it("a wire out of its clips starts at the last per-clip step (the captions), on an Each wire (priced once per clip)", () => {
    const x = expandUseCaseNodes([rec, pack(), fmt], [recWire, clipsWire])
    expect(x.edges).toContainEqual({ ...clipsWire, source: "cp::uc-captions", sourceHandle: "video-out", data: { outputMode: "each" } })
    // The per-clip render is read by the captions on an Each wire too: the chain's own.
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "cp::uc-render", sourceHandle: "video", target: "cp::uc-captions", targetHandle: "in", data: { outputMode: "each" } }))
    expect(x.fees).toEqual([{ nodeId: "cp", creditId: "use-case-fee:clip-pack" }])
  })
  it("a wire naming no pip reads the clips too; its json is the plan, one value", () => {
    const x = expandUseCaseNodes([rec, pack(), fmt], [recWire, { ...clipsWire, sourceHandle: null }])
    expect(x.edges).toContainEqual({ ...clipsWire, sourceHandle: "video-out", source: "cp::uc-captions", data: { outputMode: "each" } })
    const j = expandUseCaseNodes([rec, pack(), fmt], [recWire, { ...clipsWire, sourceHandle: "json" }])
    expect(j.edges).toContainEqual({ ...clipsWire, sourceHandle: "edl", source: "cp::uc-plan", data: { outputMode: "last" } })
  })
  it("review on: its consumers read the per-clip previews until its Render final", () => {
    const x = expandUseCaseNodes([rec, pack({ reviewBeforeRender: true }), fmt], [recWire, clipsWire])
    expect(x.nodes.map((n) => n.id)).not.toContain("cp::uc-captions")
    expect(x.edges).toContainEqual({ ...clipsWire, source: "cp::uc-render", sourceHandle: "video", data: { outputMode: "each" } })
  })
  it("no framing, no captions: the wire starts at the Apply EDL render", () => {
    const x = expandUseCaseNodes([rec, pack({ framing: null, captions: false }), fmt], [recWire, clipsWire])
    expect(x.edges).toContainEqual({ ...clipsWire, source: "cp::uc-render", sourceHandle: "media", data: { outputMode: "each" } })
  })
})

describe("usecaseMediaKindOf: what the recording wired into `media` is", () => {
  const node = (type: string, data: Record<string, unknown> = {}) => ({ id: "rec", type, data })

  it("an audio producer, or a render set to audio, is audio", () => {
    expect(usecaseMediaKindOf(node("upload-audio"), "audio")).toBe("audio")
    expect(usecaseMediaKindOf(node("apply-edl", { output: "audio" }), "media")).toBe("audio")
  })

  it("anything uncertain is video (the pricier chain never under-quotes)", () => {
    expect(usecaseMediaKindOf(undefined, null)).toBe("video")
    expect(usecaseMediaKindOf(node("upload-video"), "video")).toBe("video")
    expect(usecaseMediaKindOf(node("apply-edl"), "media")).toBe("video")
  })
})

describe("the expansion maps every recording (decided 2026-10-17)", () => {
  it("renames ids named inside data: sourceOrder, sourceConfig keys, reference, speakerMapByOrder values, masterSourceId, wideSourceId", () => {
    const rename = (id: string) => (id === "uc-source" ? "rec-a" : `uc::${id}`)
    expect(usecaseRenameInnerIds({
      sourceOrder: ["uc-master", "uc-source"],
      sourceConfig: { "uc-master": { role: "master-audio" }, "uc-source": { role: "camera" } },
      reference: "uc-master",
      speakerMapByOrder: { "1": "uc-source", "2": "" },
      masterSourceId: "uc-master",
      wideSourceId: "uc-cam-2",
      other: "uc-source",
    }, rename)).toEqual({
      sourceOrder: ["uc::uc-master", "rec-a"],
      sourceConfig: { "uc::uc-master": { role: "master-audio" }, "rec-a": { role: "camera" } },
      reference: "uc::uc-master",
      speakerMapByOrder: { "1": "rec-a", "2": "" },
      masterSourceId: "uc::uc-master",
      wideSourceId: "uc::uc-cam-2",
      other: "uc-source",
    })
  })
  it("keeps the renaming P1 and P2 data has always had: lists by Array.isArray, duckUnder whenever it is a string (empty too)", () => {
    const rename = (id: string) => `uc::${id}`
    expect(usecaseRenameInnerIds({ trackOrder: ["a", "b"], clipOrder: ["c"], duckUnder: "", sourceOrder: "x" }, rename))
      .toEqual({ trackOrder: ["uc::a", "uc::b"], clipOrder: ["uc::c"], duckUnder: "uc::", sourceOrder: "x" })
    expect(Object.keys(usecaseRenameInnerIds({ b: 1, sourceConfig: {}, a: 2 }, rename))).toEqual(["b", "sourceConfig", "a"])
    expect(usecaseRenameInnerIds({ reference: "", masterSourceId: 3, wideSourceId: null }, rename)).toEqual({ reference: "", masterSourceId: 3, wideSourceId: null })
  })
  it("reference is renamed only when it names a built node (given the built ids): a URL or a mode there is kept", () => {
    const rename = (id: string) => `uc::${id}`
    const ids = new Set(["uc-source", "uc-master"])
    expect(usecaseRenameInnerIds({ reference: "uc-master" }, rename, ids)).toEqual({ reference: "uc::uc-master" })
    expect(usecaseRenameInnerIds({ reference: "https://r2/ref.wav" }, rename, ids)).toEqual({ reference: "https://r2/ref.wav" })
    expect(usecaseRenameInnerIds({ reference: "" }, rename, ids)).toEqual({ reference: "" })
  })
  it("a key absent from the data stays absent", () => {
    expect(usecaseRenameInnerIds({ label: "x" }, (id) => `uc::${id}`)).toEqual({ label: "x" })
  })
  it("with several media wires and one recording allowed, the first in mediaOrder replaces the source (today: the first wire)", () => {
    const nodes = [
      { id: "a", type: "upload-video", data: {} }, { id: "b", type: "upload-video", data: {} },
      { id: "t", type: "tighten-episode", data: { mediaOrder: ["b", "a"] } },
    ]
    const edges = [
      { source: "a", target: "t", sourceHandle: "video", targetHandle: "media" },
      { source: "b", target: "t", sourceHandle: "video", targetHandle: "media" },
    ]
    const x = expandUseCaseNodes(nodes, edges)
    expect(x.edges.some((e) => e.source === "b" && e.target === "t::uc-transcribe")).toBe(true)
    expect(x.edges.some((e) => e.source === "a" && String(e.target).startsWith("t::"))).toBe(false)
    expect(x.nodes.find((n) => n.id === "t::uc-plan")!.data).toMatchObject({ sourceOrder: ["b"] })
  })
  it("with no mediaOrder the first wire is the recording, as before", () => {
    const nodes = [
      { id: "a", type: "upload-video", data: {} }, { id: "b", type: "upload-video", data: {} },
      { id: "t", type: "tighten-episode", data: {} },
    ]
    const edges = [
      { source: "a", target: "t", sourceHandle: "video", targetHandle: "media" },
      { source: "b", target: "t", sourceHandle: "video", targetHandle: "media" },
    ]
    const x = expandUseCaseNodes(nodes, edges)
    expect(x.edges.some((e) => e.source === "a" && e.target === "t::uc-transcribe")).toBe(true)
    expect(x.edges.some((e) => e.source === "b" && String(e.target).startsWith("t::"))).toBe(false)
  })
  it("the recording's kind is the first ordered wire's", () => {
    const nodes = [
      { id: "v", type: "upload-video", data: {} }, { id: "au", type: "upload-audio", data: {} },
      { id: "t", type: "tighten-episode", data: { mediaOrder: ["au"] } },
    ]
    const edges = [
      { source: "v", target: "t", sourceHandle: "video", targetHandle: "media" },
      { source: "au", target: "t", sourceHandle: "audio", targetHandle: "media" },
    ]
    const x = expandUseCaseNodes(nodes, edges)
    // An audio episode renders no captions node.
    expect(x.nodes.some((n) => n.id === "t::uc-captions")).toBe(false)
    expect(x.edges.some((e) => e.source === "au" && e.target === "t::uc-transcribe")).toBe(true)
  })
  it("a mediaOrder that is not a list of ids is read as none (written by hand, an import or an agent)", () => {
    const nodes = [
      { id: "a", type: "upload-video", data: {} }, { id: "b", type: "upload-video", data: {} },
      { id: "t", type: "tighten-episode", data: { mediaOrder: "b" } },
      { id: "t2", type: "tighten-episode", data: { mediaOrder: [7, "b", null] } },
    ]
    const edges = [
      { source: "a", target: "t", sourceHandle: "video", targetHandle: "media" },
      { source: "b", target: "t", sourceHandle: "video", targetHandle: "media" },
      { source: "a", target: "t2", sourceHandle: "video", targetHandle: "media" },
      { source: "b", target: "t2", sourceHandle: "video", targetHandle: "media" },
    ]
    const x = expandUseCaseNodes(nodes, edges)
    expect(x.edges.some((e) => e.source === "a" && e.target === "t::uc-transcribe")).toBe(true)
    expect(x.edges.some((e) => e.source === "b" && e.target === "t2::uc-transcribe")).toBe(true)
  })
})

/**
 * Master audio, before any node lists it (each node's multicam work adds it to
 * its unit.json): Tighten's descriptor is widened for the duration of a test —
 * it takes `masterAudio`, built as `uc-master` feeding its render — and its
 * resolver and builder are watched. Restored after every test.
 */
describe("expandUseCaseNodes: Master audio", () => {
  const mic = { id: "mic", type: "upload-audio", data: { url: "https://r2/master.wav" } }
  const recWire = { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }
  const micWire = { source: "mic", target: "t1", sourceHandle: "audio", targetHandle: "masterAudio" }
  type Writable = { -readonly [K in keyof UseCaseDescriptor]: UseCaseDescriptor[K] }

  function withMasterAudio<T>(fn: (seen: { shapes: Array<UseCaseSourcesShape | undefined>; sources: UseCaseSources[] }) => T): T {
    const d = usecaseDescriptor("tighten-episode") as Writable
    const saved = { inputs: d.inputs, inputNodeIds: d.inputNodeIds, resolveSettings: d.resolveSettings, build: d.build }
    const seen = { shapes: [] as Array<UseCaseSourcesShape | undefined>, sources: [] as UseCaseSources[] }
    d.inputs = [...saved.inputs, "masterAudio"]
    d.inputNodeIds = { ...saved.inputNodeIds, masterAudio: "uc-master" }
    d.resolveSettings = (raw, kind, shape) => {
      seen.shapes.push(shape)
      return saved.resolveSettings(raw, kind, shape)
    }
    d.build = (settings, sources) => {
      seen.sources.push(sources)
      const g = saved.build(settings, sources)
      if (!sources.masterAudio) return g
      return {
        ...g,
        nodes: [...g.nodes, { id: "uc-master", type: "upload-audio", position: { x: 0, y: 0 }, data: { url: sources.masterAudio.url } }],
        edges: [...g.edges, { id: "uc-master-render", source: "uc-master", sourceHandle: "audio", target: "uc-render", targetHandle: "sources" }],
      }
    }
    try {
      return fn(seen)
    } finally {
      Object.assign(d, saved)
    }
  }

  it("a wired master is built as an AUDIO source and the settings are resolved knowing it is there", () => {
    withMasterAudio((seen) => {
      expandUseCaseNodes([rec, mic, tighten], [recWire, micWire])
      expect(seen.sources).toHaveLength(1)
      expect(seen.sources[0]!.masterAudio).toEqual({ url: expect.any(String), kind: "audio" })
      expect(seen.shapes).toEqual([{ recordings: 1, masterAudio: true }])
    })
  })
  it("its built stand-in (the spec's inputNodeIds.masterAudio) is replaced by the real master, on its own handle", () => {
    withMasterAudio(() => {
      const x = expandUseCaseNodes([rec, mic, tighten], [recWire, micWire])
      expect(x.nodes.map((n) => n.id)).not.toContain("t1::uc-master")
      expect(x.edges).toContainEqual({ source: "mic", sourceHandle: "audio", target: "t1::uc-render", targetHandle: "sources" })
    })
  })
  it("no master wired: no master source, the shape says so, and the expansion is the plain one", () => {
    const plain = expandUseCaseNodes([rec, tighten], [recWire])
    withMasterAudio((seen) => {
      const x = expandUseCaseNodes([rec, tighten], [recWire])
      expect(seen.sources[0]).not.toHaveProperty("masterAudio")
      expect(seen.shapes).toEqual([{ recordings: 1, masterAudio: false }])
      expect(x).toEqual(plain)
    })
  })
  it("a type that does not take Master audio reads nothing from a master wire: the estimate is unchanged", () => {
    const plain = expandUseCaseNodes([rec, tighten], [recWire])
    const x = expandUseCaseNodes([rec, mic, tighten], [recWire, micWire])
    expect({ ...x, nodes: x.nodes.filter((n) => n.id !== "mic") }).toEqual(plain)
  })
})
