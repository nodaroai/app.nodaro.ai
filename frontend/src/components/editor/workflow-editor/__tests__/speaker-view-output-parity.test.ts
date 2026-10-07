/**
 * Speaker View's outputs and inputs through the EDITOR's engine (audit-dag
 * parity with backend/.../speaker-view-dag.test.ts): the video comes on its
 * default handle, `json` is the EDL as drawn (never a Transcript), a consumer's
 * input lane resolves from them, and Speaker View's own `edl` / `transcript`
 * lanes resolve the way the server's resolver routes them.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }))

import { extractNodeOutput } from "../execution-graph"
import { resolveNodeInputs } from "../node-input-resolver"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, sourceHandle: string | undefined, targetHandle: string | undefined) => ({ id: `${source}-${target}-${targetHandle ?? ""}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge

const EDL = { version: 1, clock: "master", sources: [{ id: "a", url: "https://x/a.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "a", speaker: "Host" }], meta: { targetAspect: "9:16" } }
const VIDEO = "https://r2.test/sv.mp4"
const sv = () => node("sv", "speaker-view", { generatedVideoUrl: VIDEO, generatedJson: EDL, generatedResults: [{ url: VIDEO, jobId: "j", timestamp: "t", quality: "proxy" }] })

describe("extractNodeOutput of a Speaker View node", () => {
  it("hands the video on its default handle and on `video`", () => {
    expect(extractNodeOutput(sv())).toBe(VIDEO)
    expect(extractNodeOutput(sv(), "video")).toBe(VIDEO)
  })

  it("hands the EDL as drawn — never the video url — on `json`", () => {
    const out = extractNodeOutput(sv(), "json")
    expect(out).toBe(JSON.stringify(EDL))
    expect(out).not.toContain("sv.mp4")
  })

  it("has nothing on json before the first render", () => {
    expect(extractNodeOutput(node("sv", "speaker-view"), "json")).toBeUndefined()
  })
})

describe("the lanes around a Speaker View node, in the editor's resolver", () => {
  it("a video consumer receives the render as video", () => {
    const nodes = [sv(), node("combine", "combine-videos")]
    const inputs = resolveNodeInputs(nodes[1]!, nodes, [edge("sv", "combine", "video", "in")])
    expect(inputs.videoUrl ?? inputs.videoUrls?.[0]).toBe(VIDEO)
  })

  it("an Apply EDL `edl` input receives the drawn EDL from its json handle", () => {
    const nodes = [sv(), node("cut", "apply-edl")]
    const inputs = resolveNodeInputs(nodes[1]!, nodes, [edge("sv", "cut", "json", "edl")])
    expect(inputs.edl).toBe(JSON.stringify(EDL))
  })

  it("Speaker View's own edl and transcript lanes take an Edit Plan's EDL and a transcript, as stringified json", () => {
    const words = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 1, speaker: "speaker_0" }] }
    const nodes = [node("plan", "edit-plan", { generatedJson: EDL }), node("tx", "transcribe", { generatedJson: words }), node("sv", "speaker-view")]
    const inputs = resolveNodeInputs(nodes[2]!, nodes, [edge("plan", "sv", "edl", "edl"), edge("tx", "sv", "json", "transcript")])
    expect(JSON.parse(inputs.edl as string)).toEqual(EDL)
    expect(JSON.parse(inputs.transcript as string)).toEqual(words)
  })
})
