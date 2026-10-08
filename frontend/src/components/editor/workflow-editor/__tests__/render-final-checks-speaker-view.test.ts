import { describe, it, expect, vi } from "vitest"
import { finalIsUnchanged, renderRuleVerdict } from "../render-final-checks"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Render final on a Speaker View (C3.4): the prechecks ask the render's OWN
 * rule (TA1 a) — the plugin's, mirrored — never Apply EDL's, which refuses
 * every layout Speaker View exists to draw. "Nothing changed since the last
 * final" (TA15 a) cannot compare a Speaker View request, so it answers
 * "changed" and never asks.
 */
const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string) =>
  ({ id: `${source}->${target}`, source, target, targetHandle }) as unknown as WorkflowEdge
const MIC = { id: "mic", url: "https://cdn/mic.wav", kind: "audio", role: "master-audio" }
const cam = (id: string) => ({ id, url: `https://cdn/${id}.mp4`, kind: "video" })
const seg = (id: string, inS: number, video: string, speaker?: string, extra: Record<string, unknown> = {}) =>
  ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video, ...(speaker ? { speaker } : {}), ...extra })
const edl = (segments: unknown[]) => ({ version: 1, clock: "master", sources: [MIC, cam("a"), cam("b")], segments })
const SIDE_BY_SIDE = { mode: "side-by-side", slots: [{ source: "a", speaker: "Host" }, { source: "b", speaker: "Guest" }] }
const HINTED = edl([seg("s0", 0, "a", "Host"), seg("s1", 5, "b", "Guest", { layout: SIDE_BY_SIDE })])

const canvas = (type: string, edit: unknown, data: Record<string, unknown> = {}) => ({
  nodes: [node("p", "edit-plan", { generatedJson: edit }), node("r", type, data)],
  edges: [edge("p", "r", "edl")],
})

describe("renderRuleVerdict on a Speaker View", () => {
  it("passes a hinted layout Speaker View draws (Apply EDL's rule refuses the same edit)", () => {
    const sv = canvas("speaker-view", HINTED)
    expect(renderRuleVerdict("r", sv.nodes, sv.edges)).toEqual({ ok: true })
    const ae = canvas("apply-edl", HINTED)
    expect(renderRuleVerdict("r", ae.nodes, ae.edges).ok).toBe(false)
  })

  it("refuses what Speaker View's rule refuses, in its words (SV24: no speaker on a multicam edit)", () => {
    const sv = canvas("speaker-view", edl([seg("s0", 0, "a"), seg("s1", 5, "b")]))
    const verdict = renderRuleVerdict("r", sv.nodes, sv.edges)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.issues[0]).toMatch(/Wire Camera Switch between Edit Plan and Speaker View/)
  })

  it("no edit wired is a refusal, not a pass", () => {
    expect(renderRuleVerdict("r", [node("r", "speaker-view")], []).ok).toBe(false)
  })
})

describe("finalIsUnchanged on a Speaker View", () => {
  it("answers changed (fails open) even when a final take and its stored request exist", async () => {
    const sv = canvas("speaker-view", HINTED, {
      generatedResults: [{ url: "f.mp4", jobId: "j1", quality: "final" }],
    })
    const getJob = vi.fn().mockResolvedValue({ input_data: { edl: HINTED } })
    expect(await finalIsUnchanged("r", sv.nodes, sv.edges, getJob)).toBe(false)
    expect(getJob).not.toHaveBeenCalled()
  })
})
