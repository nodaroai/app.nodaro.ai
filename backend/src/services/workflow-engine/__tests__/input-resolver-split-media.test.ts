import { describe, it, expect } from "vitest"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { buildNodeOutputFromJobData } from "../output-extractor.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

/**
 * Split into Chunks on the server engine: its job output carries both part
 * lists (a split of a video used to hand on nothing and fail the node), a wire
 * set to Each runs the next node once per part on its pip, and a wire in no
 * list mode — every wire saved before the node fanned out — reads the part the
 * node's "Output Chunk" names. Mirrors the editor resolver.
 */
function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data: { label: id, ...data } }
}
function edge(source: string, target: string, sourceHandle: string, targetHandle: string, outputMode?: string): SimpleEdge {
  return { id: `${source}->${target}:${sourceHandle}`, source, target, sourceHandle, targetHandle, ...(outputMode ? { data: { outputMode } } : {}) }
}

const V = ["https://cdn/v0.mp4", "https://cdn/v1.mp4", "https://cdn/v2.mp4"]
const A = ["https://cdn/a0.mp3", "https://cdn/a1.mp3", "https://cdn/a2.mp3"]

describe("split-media job output", () => {
  it("carries both part lists and the first part of each", () => {
    const out = buildNodeOutputFromJobData({ videoUrls: V, audioUrls: A, chunkCount: 3 }, "split-media")
    expect(out.videoUrls).toEqual(V)
    expect(out.audioUrls).toEqual(A)
    expect(out.videoUrl).toBe(V[0])
    expect(out.audioUrl).toBe(A[0])
  })

  it("a split of a video alone is an output (it used to be empty and fail the node)", () => {
    const out = buildNodeOutputFromJobData({ videoUrls: V, chunkCount: 3 }, "split-media")
    expect(out.videoUrl).toBe(V[0])
    expect(out.audioUrls).toBeUndefined()
  })
})

describe("backend input-resolver — Split into Chunks", () => {
  const split = (data: Record<string, unknown> = {}) => node("split", "split-media", { chunkDuration: 10, ...data })
  const trim = node("trim", "trim-video")
  const tts = node("tts", "voice-changer")
  const ran: Record<string, NodeExecutionState> = {
    split: { status: "completed", output: buildNodeOutputFromJobData({ videoUrls: V, audioUrls: A, chunkCount: 3 }, "split-media") },
  }

  it("a plain wire (an older one) reads the part Output Chunk names, on its pip", () => {
    const s = split({ outputChunkIndex: 2 })
    expect(resolveNodeInputs(trim, [edge("split", "trim", "video", "video")], ran, [s, trim]).videoUrl).toBe(V[2])
    expect(resolveNodeInputs(tts, [edge("split", "tts", "audio", "audio")], ran, [s, tts]).audioUrl).toBe(A[2])
  })

  it("a plain wire with no Output Chunk reads the first part; one past the end reads the last", () => {
    expect(resolveNodeInputs(trim, [edge("split", "trim", "video", "video")], ran, [split(), trim]).videoUrl).toBe(V[0])
    expect(resolveNodeInputs(trim, [edge("split", "trim", "video", "video")], ran, [split({ outputChunkIndex: 9 }), trim]).videoUrl).toBe(V[2])
  })

  it("does not fan out on a plain wire", () => {
    expect(getListFanOutForNode(trim, [edge("split", "trim", "video", "video")], ran, [split(), trim])).toBeUndefined()
  })

  it("an Each wire fans the next node out once per part on its pip, each run reading its own part", () => {
    const edges = [edge("split", "trim", "video", "video", "each")]
    const fan = getListFanOutForNode(trim, edges, ran, [split(), trim])
    expect(fan?.items).toEqual(V)
    V.forEach((url, i) => {
      expect(resolveNodeInputs(trim, edges, ran, [split(), trim], undefined, i).videoUrl).toBe(url)
    })
    const audioEdges = [edge("split", "tts", "audio", "audio", "each")]
    expect(getListFanOutForNode(tts, audioEdges, ran, [split(), tts])?.items).toEqual(A)
    expect(resolveNodeInputs(tts, audioEdges, ran, [split(), tts], undefined, 1).audioUrl).toBe(A[1])
  })

  it("reads its saved parts when this run did not run it", () => {
    const saved = split({ generatedVideoUrls: V, outputChunkIndex: 1 })
    expect(resolveNodeInputs(trim, [edge("split", "trim", "video", "video")], {}, [saved, trim]).videoUrl).toBe(V[1])
    expect(getListFanOutForNode(trim, [edge("split", "trim", "video", "video", "each")], {}, [saved, trim])?.items).toEqual(V)
  })

  it("never reads saved parts for a node this run ran (it hands on this run's)", () => {
    const stale = split({ generatedVideoUrls: ["https://cdn/old.mp4", "https://cdn/old2.mp4"] })
    const fresh = { split: { status: "completed", output: buildNodeOutputFromJobData({ videoUrls: V.slice(0, 2), chunkCount: 2 }, "split-media") } } as Record<string, NodeExecutionState>
    expect(getListFanOutForNode(trim, [edge("split", "trim", "video", "video", "each")], fresh, [stale, trim])?.items).toEqual(V.slice(0, 2))
  })
})
