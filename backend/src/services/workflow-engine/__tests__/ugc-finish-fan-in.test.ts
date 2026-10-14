/**
 * One node takes every clip of UGC Clip's fan-out at once and hands the finished clips, in
 * order, to Join — on the server engine, through the shared registries only (UGC Finish is a
 * fan-in target and a video producer). The URLs are placeholders.
 */
import { describe, expect, it } from "vitest"
import { getListFanOutForNode, resolveNodeInputs } from "../input-resolver.js"
import { extractSavedNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data: { label: id, ...data } })
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string, data?: Record<string, unknown>): SimpleEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle, ...(data ? { data } : {}) })

const clips = node("clips", "ugc-clips")
const clip = node("clip", "ugc-clip", { rerender: {} })
const finish = node("finish", "ugc-finish-clips")
const join = node("join", "combine-videos", { transition: "cut" })
const ALL = [clips, clip, finish, join]
const RENDERED = ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4", "https://cdn.example/3.mp4"]
const FINISHED = ["https://cdn.example/f1.mp4", "https://cdn.example/f2.mp4", "https://cdn.example/f3.mp4"]
const PLAN_OUT = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
const STATES: Record<string, NodeExecutionState> = {
  clips: { status: "completed", output: { ugcOutputs: { clips: "t1", "plan-out": PLAN_OUT, transcript: "a" }, listResults: ["t1", "t2", "t3"] } },
  clip: { status: "completed", output: { listResults: RENDERED, listResultMeta: RENDERED.map(() => ({ warnings: [], durationSec: 7 })) } },
  finish: { status: "completed", output: { listResults: FINISHED, listResultMeta: FINISHED.map(() => ({ warnings: [], durationSec: 6 })), videoUrl: FINISHED[0] } },
}
const EDGES = [
  edge("clip", "finish", "video-out", "clips", { outputMode: "all" }),
  edge("clips", "finish", "plan-out", "plan"),
  edge("finish", "join", "video-out", "in", { outputMode: "all" }),
]

describe("UGC Finish takes every clip at once and hands them on in order (server engine)", () => {
  it("is never fanned out by the clip's list, whatever the edge's mode", () => {
    for (const mode of ["all", "each", undefined]) {
      const edges = [edge("clip", "finish", "video-out", "clips", mode ? { outputMode: mode } : undefined), EDGES[1]!]
      expect(getListFanOutForNode(finish, edges, STATES, ALL), String(mode)).toBeUndefined()
    }
  })
  it("receives every rendered clip, in clip order, as one list, and its plan by its handle", () => {
    const r = resolveNodeInputs(finish, EDGES.slice(0, 2), STATES, ALL)
    expect(r.inputs).toEqual(RENDERED)
    expect(r.ugc?.plan).toBe(PLAN_OUT)
  })
  it("a clip that never fanned out arrives as a one-clip list", () => {
    const single = { ...STATES, clip: { status: "completed", output: { videoUrl: RENDERED[0] } } as NodeExecutionState }
    expect(resolveNodeInputs(finish, EDGES.slice(0, 2), single, ALL).inputs).toEqual([RENDERED[0]])
  })
  it("Join receives the finished clips, in order, as videos (a Bundle edge into Combine Videos)", () => {
    const r = resolveNodeInputs(join, [EDGES[2]!], STATES, ALL)
    expect(r.videoUrls).toEqual(FINISHED)
  })
})

describe("a video of one clip, the clip read from its saved data (not run this run)", () => {
  it("UGC Finish receives exactly the take the clip shows — never its earlier takes", () => {
    const one = node("clip", "ugc-clip", { rerender: {}, activeResultIndex: 0, generatedResults: [{ url: RENDERED[1] }, { url: RENDERED[0] }] })
    const states = { clips: STATES.clips! }
    expect(resolveNodeInputs(finish, EDGES.slice(0, 2), states, [clips, one, finish, join]).inputs).toEqual([RENDERED[1]])
  })
})

describe("a wire that is not a Bundle carries the clip UGC Finish shows (decided 2026-10-13)", () => {
  const saved = (data: Record<string, unknown>) => node("finish", "ugc-finish-clips", { __listResults: FINISHED, ...data })
  const handedOn = (n: SimpleNode) => getPrimaryOutput(extractSavedNodeOutput(n)!, "ugc-finish-clips", "video-out")

  it("the active result, not the first clip", () => {
    const n = saved({ generatedVideoUrl: FINISHED[1], activeResultIndex: 1, generatedResults: FINISHED.map((url) => ({ url })) })
    expect(handedOn(n)).toBe(FINISHED[1])
    // A Bundle edge still reads every finished clip, in order.
    expect(extractSavedNodeOutput(n)?.listResults).toEqual(FINISHED)
  })

  it("after the shown clip is deleted from the node, the clip it then shows — never the deleted one", () => {
    // What deleting result 1 writes (computeDeleteResultUpdates): the list without it, the active index reset, the synced URL.
    const n = saved({ generatedVideoUrl: FINISHED[0], activeResultIndex: 0, generatedResults: [{ url: FINISHED[0] }, { url: FINISHED[2] }] })
    expect(handedOn(n)).toBe(FINISHED[0])
    const n2 = saved({ generatedVideoUrl: FINISHED[2], activeResultIndex: 1, generatedResults: [{ url: FINISHED[0] }, { url: FINISHED[2] }] })
    expect(handedOn(n2)).toBe(FINISHED[2])
  })
})
