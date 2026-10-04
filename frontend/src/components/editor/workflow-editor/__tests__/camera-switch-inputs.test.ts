/**
 * camera-switch (B5) on the editor's own engine: the edit and the transcript
 * reach `inputs.edl` / `inputs.transcript` (mirror of the backend resolver),
 * and the node's two output handles carry the switched edit and the named
 * transcript off its { edl, transcript } pair.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({ getCachedCredits: vi.fn(), getCachedVideoProCredits: vi.fn() }))

import { resolveNodeInputs } from "../node-input-resolver"
import { extractNodeOutput } from "../execution-graph"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle }) as WorkflowEdge

const edl = { version: 1, clock: "master", sources: [{ id: "camA", url: "https://m/a.mp4", kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: 1000, video: "camA" }] }
const transcript = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "speaker_0" }] }

describe("camera-switch (editor engine)", () => {
  it("routes the edit and the transcript by handle, never into the prompt", () => {
    const nodes = [node("ep", "edit-plan", { generatedJson: edl }), node("tx", "transcribe", { generatedJson: transcript }), node("cs", "camera-switch")]
    const edges = [edge("ep", "cs", "edl", "edl"), edge("tx", "cs", "json", "transcript")]
    const inputs = resolveNodeInputs(nodes[2]!, nodes, edges)
    expect(JSON.parse(inputs.edl!)).toEqual(edl)
    expect(JSON.parse(inputs.transcript!)).toEqual(transcript)
    expect(inputs.prompt).toBeUndefined()
  })

  it("its `edl` handle carries the switched edit, its `transcript` handle the named transcript", () => {
    const named = { ...transcript, words: [{ ...transcript.words[0]!, speaker: "Dana" }] }
    const cs = node("cs", "camera-switch", { generatedJson: { edl, transcript: named } })
    expect(JSON.parse(extractNodeOutput(cs, "edl")!)).toEqual(edl)
    expect(JSON.parse(extractNodeOutput(cs, "transcript")!)).toEqual(named)
    expect(JSON.parse(extractNodeOutput(cs)!)).toEqual(edl)
  })
})
