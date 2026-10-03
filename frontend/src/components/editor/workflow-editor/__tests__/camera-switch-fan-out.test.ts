import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ characterDefinitions: [], nodes: [], edges: [] }) },
}))

import { extractNodeOutputAsList, getListInputForNode, resolveNodeInputs } from "../node-input-resolver"

// Clips mode on the canvas (decided 2026-10-04): Camera Switch run once per clip
// fans its EDL out to one Apply EDL render per clip by default; its transcript —
// the same for every clip — stays one value in any mode. Mirror of the backend's
// camera-switch-dag "Clips mode" cases.

/* eslint-disable @typescript-eslint/no-explicit-any */
const node = (id: string, type: string, data: Record<string, unknown> = {}): any => ({ id, type, position: { x: 0, y: 0 }, data: { label: type, ...data } })
const edge = (id: string, sourceHandle: string, targetHandle: string, data?: Record<string, unknown>): any =>
  ({ id, source: "cs", sourceHandle, target: "ae", targetHandle, ...(data ? { data } : {}) })

const clip = (k: number) => JSON.stringify({ version: 1, clock: "master", sources: [{ id: "camA", url: "https://x/a.mp4", kind: "video" }], segments: [{ id: `c${k}`, inMs: k, outMs: k + 5_000, video: "camA" }] })
const named = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 400, speaker: "Dana" }] }
const cameraSwitch = (extra: Record<string, unknown> = {}) =>
  node("cs", "camera-switch", { generatedJson: { edl: JSON.parse(clip(0)), transcript: named }, __listResults: [clip(0), clip(1), clip(2)], ...extra })
const EDGES = [edge("e-edl", "edl", "edl"), edge("e-tr", "transcript", "transcript")]

describe("Camera Switch's per-clip EDLs on the canvas (B5)", () => {
  it("the EDL handle lists the LAST batch — never the accumulated history; the transcript never lists", () => {
    const cs = cameraSwitch({ generatedResults: [clip(7), clip(8), clip(0), clip(1), clip(2)].map((url) => ({ url })) })
    expect(extractNodeOutputAsList(cs, "edl")).toEqual([clip(0), clip(1), clip(2)])
    expect(extractNodeOutputAsList(cs, undefined)).toEqual([clip(0), clip(1), clip(2)])
    expect(extractNodeOutputAsList(cs, "transcript")).toBeUndefined()
  })

  it("Apply EDL fans out once per clip with no outputMode set; iteration k gets clip k and the one transcript", () => {
    const nodes = [cameraSwitch(), node("ae", "apply-edl")]
    expect(getListInputForNode(nodes[1], nodes, EDGES)).toEqual([clip(0), clip(1), clip(2)])
    const inputs = resolveNodeInputs(nodes[1], nodes, EDGES, 2) as unknown as Record<string, unknown>
    expect(inputs.edl).toBe(clip(2))
    expect(JSON.parse(String(inputs.transcript))).toEqual(named)
  })

  it("an \"each\" set by hand on the transcript edge still delivers the transcript", () => {
    const nodes = [cameraSwitch(), node("ae", "apply-edl")]
    const edges = [edge("e-edl", "edl", "edl"), edge("e-tr", "transcript", "transcript", { outputMode: "each" })]
    const inputs = resolveNodeInputs(nodes[1], nodes, edges, 1) as unknown as Record<string, unknown>
    expect(inputs.edl).toBe(clip(1))
    expect(JSON.parse(String(inputs.transcript))).toEqual(named)
  })

  it("after a single run (no batch) the EDL edge is one value — no fan-out", () => {
    const nodes = [cameraSwitch({ __listResults: undefined }), node("ae", "apply-edl")]
    expect(getListInputForNode(nodes[1], nodes, EDGES)).toBeUndefined()
  })
})
