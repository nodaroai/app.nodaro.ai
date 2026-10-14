/**
 * One node takes every clip of UGC Clip's fan-out at once and hands the finished clips, in
 * order, to Join — on the editor's engine, through the shared registries only (UGC Finish is a
 * fan-in target and a video producer). The twin of the server engine's ugc-finish-fan-in.test.ts.
 * The URLs are placeholders.
 */
import { describe, expect, it } from "vitest"
import { getListFanOutForNode, resolveNodeInputs } from "../node-input-resolver"
import { extractNodeOutput } from "../execution-graph"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string, data?: Record<string, unknown>) =>
  ({ id: `${source}.${sourceHandle}->${target}.${targetHandle}`, source, sourceHandle, target, targetHandle, ...(data ? { data } : {}) }) as unknown as WorkflowEdge

const RENDERED = ["https://cdn.example/1.mp4", "https://cdn.example/2.mp4", "https://cdn.example/3.mp4"]
const FINISHED = ["https://cdn.example/f1.mp4", "https://cdn.example/f2.mp4", "https://cdn.example/f3.mp4"]
const PLAN_OUT = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
const clips = node("clips", "ugc-clips", { ugcOutputs: { clips: "t1", "plan-out": PLAN_OUT, transcript: "a" }, __listResults: ["t1", "t2", "t3"] })
const clip = node("clip", "ugc-clip", { rerender: {}, generatedVideoUrl: RENDERED[2], __listResults: RENDERED })
const finish = node("finish", "ugc-finish-clips", { generatedVideoUrl: FINISHED[0], __listResults: FINISHED })
const join = node("join", "combine-videos", { transition: "cut" })
const NODES = [clips, clip, finish, join]
const EDGES = [
  edge("clip", "video-out", "finish", "clips", { outputMode: "all" }),
  edge("clips", "plan-out", "finish", "plan"),
  edge("finish", "video-out", "join", "in", { outputMode: "all" }),
]

describe("UGC Finish takes every clip at once and hands them on in order (editor engine)", () => {
  it("is never fanned out by the clip's list, whatever the edge's mode", () => {
    for (const mode of ["all", "each", undefined]) {
      const edges = [edge("clip", "video-out", "finish", "clips", mode ? { outputMode: mode } : undefined), EDGES[1]!]
      expect(getListFanOutForNode(finish, NODES, edges), String(mode)).toBeUndefined()
    }
  })
  it("receives every rendered clip, in clip order, as one list, and its plan by its handle", () => {
    const r = resolveNodeInputs(finish, NODES, EDGES.slice(0, 2))
    expect(r.inputs).toEqual(RENDERED)
    expect(r.ugc?.plan).toBe(PLAN_OUT)
  })
  it("Join receives the finished clips, in order, as videos (a Bundle edge into Combine Videos)", () => {
    expect(resolveNodeInputs(join, NODES, [EDGES[2]!]).videoUrls).toEqual(FINISHED)
  })
})

describe("a video of one clip (one ticket, so UGC Clip ran once)", () => {
  it("UGC Finish receives exactly the take the clip shows — never its earlier takes", () => {
    const one = node("clip", "ugc-clip", { rerender: {}, generatedVideoUrl: RENDERED[1], activeResultIndex: 0, generatedResults: [{ url: RENDERED[1] }, { url: RENDERED[0] }] })
    expect(resolveNodeInputs(finish, [clips, one, finish, join], EDGES.slice(0, 2)).inputs).toEqual([RENDERED[1]])
  })
})

describe("a wire that is not a Bundle carries the clip UGC Finish shows (decided 2026-10-13)", () => {
  const saved = (data: Record<string, unknown>) => node("finish", "ugc-finish-clips", { __listResults: FINISHED, ...data })

  it("the active result, not the first clip", () => {
    const n = saved({ generatedVideoUrl: FINISHED[1], activeResultIndex: 1, generatedResults: FINISHED.map((url) => ({ url })) })
    expect(extractNodeOutput(n, "video-out")).toBe(FINISHED[1])
  })

  it("after the shown clip is deleted from the node, the clip it then shows — never the deleted one", () => {
    const shown = { generatedResults: FINISHED.map((url) => ({ url })), activeResultIndex: 1, generatedVideoUrl: FINISHED[1] }
    const n = saved({ ...shown, ...computeDeleteResultUpdates(shown.generatedResults, 1, 1, "generatedVideoUrl") })
    expect(extractNodeOutput(n, "video-out")).toBe(FINISHED[0])
  })
})
