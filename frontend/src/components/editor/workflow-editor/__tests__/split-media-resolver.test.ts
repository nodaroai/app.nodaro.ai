// Split into Chunks in the editor engine: a wire set to Each runs the next node
// once per part on its pip; a wire in no list mode — every wire saved before
// the node fanned out — reads the part "Output Chunk" names. Mirror of the
// backend's input-resolver-split-media.test.ts, so the two engines agree.
import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

import { extractNodeOutputAsList, getListFanOutForNode, resolveLoopColumnValues, resolveNodeInputs } from "../node-input-resolver"
import { isValidWorkflowConnection } from "@/lib/connection-validation"
import { isValidLoopColumnConnection } from "@/lib/data-handles"
import { extractNodeOutput } from "../execution-graph"
import { initialEdgeData } from "@/lib/initial-edge-data"

const V = ["https://cdn/v0.mp4", "https://cdn/v1.mp4", "https://cdn/v2.mp4"]
const A = ["https://cdn/a0.mp3", "https://cdn/a1.mp3", "https://cdn/a2.mp3"]

const node = (id: string, type: string, data: Record<string, unknown> = {}): any =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string, outputMode?: string): any =>
  ({ id: `${source}->${target}:${sourceHandle}`, source, target, sourceHandle, targetHandle, ...(outputMode ? { data: { outputMode } } : {}) })

const split = (data: Record<string, unknown> = {}) =>
  node("split", "split-media", { chunkDuration: 10, generatedVideoUrls: V, generatedAudioUrls: A, ...data })
const trim = node("trim", "trim-video")
const vc = node("vc", "voice-changer")

describe("Split into Chunks — editor engine", () => {
  it("lists its parts by pip", () => {
    expect(extractNodeOutputAsList(split(), "video")).toEqual(V)
    expect(extractNodeOutputAsList(split(), "audio")).toEqual(A)
    expect(extractNodeOutputAsList(split({ generatedVideoUrls: undefined }), undefined)).toEqual(A)
  })

  it("a plain wire reads the part Output Chunk names, on its pip", () => {
    const s = split({ outputChunkIndex: 2 })
    expect(extractNodeOutput(s, "video")).toBe(V[2])
    expect(resolveNodeInputs(trim, [s, trim], [edge("split", "trim", "video", "video")]).videoUrl).toBe(V[2])
    expect(resolveNodeInputs(vc, [s, vc], [edge("split", "vc", "audio", "audio")]).audioUrl).toBe(A[2])
  })

  it("a plain wire does not fan out", () => {
    expect(getListFanOutForNode(trim, [split(), trim], [edge("split", "trim", "video", "video")])).toBeUndefined()
  })

  it("an Each wire fans out once per part, each run reading its own part", () => {
    const edges = [edge("split", "trim", "video", "video", "each")]
    expect(getListFanOutForNode(trim, [split(), trim], edges)?.items).toEqual(V)
    V.forEach((url, i) => expect(resolveNodeInputs(trim, [split(), trim], edges, i).videoUrl).toBe(url))
    const audio = [edge("split", "vc", "audio", "audio", "each")]
    expect(resolveNodeInputs(vc, [split(), vc], audio, 1).audioUrl).toBe(A[1])
  })
})

describe("Split into Chunks → Mix Audio (parity with the backend)", () => {
  const bed = node("bed", "upload-audio", { url: "https://r2/bed.mp3" })
  const mix = node("mix", "mix-audio", { trackCount: 2, trackVolumes: {} })
  it("a video part is a track (its audio), not the dropped videoUrl", () => {
    const r = resolveNodeInputs(mix, [split(), bed, mix], [edge("split", "mix", "video", "in"), edge("bed", "mix", "audio", "in")])
    expect(r.audioUrlsWithSourceIds).toEqual([{ nodeId: "split", url: V[0] }, { nodeId: "bed", url: "https://r2/bed.mp3" }])
    expect(r.videoUrl).toBeUndefined()
  })
  it("an audio part is a track too, not the single audioUrl", () => {
    const r = resolveNodeInputs(mix, [split(), bed, mix], [edge("split", "mix", "audio", "in"), edge("bed", "mix", "audio", "in")])
    expect(r.audioUrls).toEqual([A[0], "https://r2/bed.mp3"])
    expect(r.audioUrl).toBeUndefined()
  })
})

describe("a new wire out of Split into Chunks", () => {
  it("starts in Each, except into a List (which collects every value)", () => {
    expect(initialEdgeData("split-media", "video", "trim-video", "video")).toEqual({ outputMode: "each" })
    expect(initialEdgeData("split-media", "audio", "voice-changer", "audio")).toEqual({ outputMode: "each" })
    expect(initialEdgeData("split-media", "video", "list", "in")).toBeUndefined()
  })

  it("leaves other producers' wires as they were", () => {
    expect(initialEdgeData("social-search", "json", "video-analysis", "video")).toEqual({ outputMode: "each" })
    expect(initialEdgeData("trim-video", "video", "split-media", "video")).toBeUndefined()
  })
})

describe("Split into Chunks → List", () => {
  const types: Record<string, string> = { split: "split-media", list: "list" }
  const connects = (sourceHandle: string, targetHandle: string) =>
    isValidWorkflowConnection({ source: "split", target: "list", sourceHandle, targetHandle }, (id) => types[id])
  const list = (type: "video-url" | "audio-url") =>
    node("list", "list", { columns: [{ id: "c1", name: "Parts", type, handleId: "col_c1" }], rows: [] })

  it("connects from either pip, to the add-column pip and to a video or audio column", () => {
    expect(connects("video", "col_add")).toBe(true)
    expect(connects("audio", "col_add")).toBe(true)
    expect(connects("video", "col_c1_in")).toBe(true)
    expect(isValidLoopColumnConnection("video-url", "split-media", () => false)).toBe(true)
    expect(isValidLoopColumnConnection("audio-url", "split-media", () => false)).toBe(true)
  })

  it("the column holds every part of the pip it is wired to", () => {
    const s = split()
    const videoList = list("video-url")
    expect(resolveLoopColumnValues(videoList, "col_c1", [edge("split", "list", "video", "col_c1_in")], [s, videoList])).toEqual(V)
    const audioList = list("audio-url")
    expect(resolveLoopColumnValues(audioList, "col_c1", [edge("split", "list", "audio", "col_c1_in")], [s, audioList])).toEqual(A)
  })
})
