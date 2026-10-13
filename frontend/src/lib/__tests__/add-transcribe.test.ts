/**
 * "Add Transcribe" on Speaker View's Video input (D3): Transcribe with speaker
 * detection inserted, the video wired into it and its transcript into Speaker
 * View — pure, so the canvas applies it as one step.
 */
import { describe, expect, it } from "vitest"
import { speakerViewVideoModeLive } from "@nodaro/render-rules"
import { planAddTranscribe, ADD_TRANSCRIBE_OFFSET } from "../add-transcribe"
import { isValidWorkflowConnection } from "../connection-validation"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** Video mode open (R15): Speaker View and Speaker Frames priced. */
const LIVE = { viewPriced: true, framesPriced: true }

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 1000, y: 600 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string) =>
  ({ id, source, sourceHandle, target, targetHandle }) as unknown as WorkflowEdge

const GRAPH = { nodes: [node("up", "upload-video"), node("sv", "speaker-view")], edges: [edge("e1", "up", "video", "sv", "video")] }
const TRANSCRIBE = { id: "node_9", data: { label: "Transcribe", provider: "whisper", language: "auto", fieldMappings: {} } }

describe("planAddTranscribe", () => {
  it("R15: refuses while video mode is not open (either price flag off), and with the real flags today", () => {
    for (const flags of [{ viewPriced: true, framesPriced: false }, { viewPriced: false, framesPriced: true }]) {
      expect(planAddTranscribe(GRAPH, "sv", TRANSCRIBE, flags)).toEqual({ ok: false, reason: "video-mode-not-live" })
    }
    expect(planAddTranscribe(GRAPH, "sv", TRANSCRIBE).ok).toBe(speakerViewVideoModeLive())
  })

  it("adds Transcribe with speaker detection on the same video, and wires its transcript into Speaker View", () => {
    const out = planAddTranscribe(GRAPH, "sv", TRANSCRIBE, LIVE)
    if (!out.ok) throw new Error(out.reason)
    const added = out.nodes.find((n) => n.id === "node_9")!
    expect(added.type).toBe("transcribe")
    expect(added.position).toEqual({ x: 1000 + ADD_TRANSCRIBE_OFFSET.x, y: 600 + ADD_TRANSCRIBE_OFFSET.y })
    // Speaker labels come only from ElevenLabs: the node is written with it whatever the default is.
    expect(added.data).toMatchObject({ provider: "elevenlabs-stt", diarize: true })
    const fresh = out.edges.slice(GRAPH.edges.length).map(({ source, sourceHandle, target, targetHandle }) => ({ source, sourceHandle, target, targetHandle }))
    expect(fresh).toEqual([
      { source: "up", sourceHandle: "video", target: "node_9", targetHandle: "audio" },
      { source: "node_9", sourceHandle: "json", target: "sv", targetHandle: "transcript" },
    ])
    expect(out.transcribeId).toBe("node_9")
  })

  it("wires only connections the canvas itself would accept", () => {
    const types: Record<string, string> = { up: "upload-video", node_9: "transcribe", sv: "speaker-view" }
    const typeOf = (id: string) => types[id]
    expect(isValidWorkflowConnection({ source: "up", target: "node_9", sourceHandle: "video", targetHandle: "audio" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "node_9", target: "sv", sourceHandle: "json", targetHandle: "transcript" }, typeOf)).toBe(true)
    expect(isValidWorkflowConnection({ source: "up", target: "sv", sourceHandle: "video", targetHandle: "video" }, typeOf)).toBe(true)
    // a video straight into the transcript lane is not a connection the canvas makes
    expect(isValidWorkflowConnection({ source: "up", target: "sv", sourceHandle: "video", targetHandle: "transcript" }, typeOf)).toBe(false)
  })

  it("refuses when a transcript is already wired, when no video is wired, and on any other node", () => {
    const wired = { ...GRAPH, edges: [...GRAPH.edges, edge("e2", "x", "json", "sv", "transcript")] }
    expect(planAddTranscribe(wired, "sv", TRANSCRIBE, LIVE)).toEqual({ ok: false, reason: "already-wired" })
    expect(planAddTranscribe({ nodes: [node("sv", "speaker-view")], edges: [] }, "sv", TRANSCRIBE, LIVE)).toEqual({ ok: false, reason: "no-video" })
    expect(planAddTranscribe(GRAPH, "up", TRANSCRIBE, LIVE)).toEqual({ ok: false, reason: "not-speaker-view" })
  })

  it("never changes the graph it is given", () => {
    const before = JSON.stringify(GRAPH)
    planAddTranscribe(GRAPH, "sv", TRANSCRIBE, LIVE)
    expect(JSON.stringify(GRAPH)).toBe(before)
  })
})
