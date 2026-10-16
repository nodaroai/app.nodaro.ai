/**
 * The one expansion every estimator prices a use-case node with: the chain it
 * builds, wired to the node's real upstream source (decided 2026-10-13).
 */
import { describe, it, expect } from "vitest"
import { expandUseCaseNodes, usecaseMediaKindOf, withUseCaseMembers } from "@nodaro/render-rules"

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
