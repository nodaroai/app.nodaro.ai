/**
 * text-to-dialogue gains a `json` output handle: the Transcript built from the
 * model's timings (words + one segment per line, speaker = the line's voice).
 * The three handle registries move together, the canvas engine resolves the
 * handle to the stringified transcript (audio unchanged), and Add Captions'
 * transcript input reads it — or nothing, on a model without timings, so the
 * node auto-transcribes as today. Mirror of the server test
 * (backend dialogue-json-handle.test.ts) and of transcribe's dual output.
 */
import { describe, it, expect } from "vitest"
import type { Transcript } from "@nodaro/shared"
import { NODE_DEF_MAP, type WorkflowNode, type WorkflowEdge } from "@/types/nodes"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { ACCEPTS_JSON } from "@/lib/data-handles"
import { extractNodeOutput, detectPreviewItemType } from "../execution-graph"
import { resolveNodeInputs } from "../node-input-resolver"

const AUDIO = "https://cdn.example.com/dialogue.mp3"
const transcript: Transcript = { version: 1, words: [{ text: "Hi", startMs: 0, endMs: 200, speaker: "Rachel" }] }
const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle }) as unknown as WorkflowEdge

describe("text-to-dialogue json handle — registries", () => {
  it("declares, renders and colours the json pip beside audio; the json pip is accepted at a json input", () => {
    expect([...NODE_DEF_MAP.get("text-to-dialogue")!.outputs].sort()).toEqual(["audio", "json"])
    expect(HANDLE_OUTPUT_TYPES["text-to-dialogue"]).toEqual({ audio: "audio", json: "look" })
    expect(ACCEPTS_JSON("text-to-dialogue")).toBe(true)
  })
})

describe("text-to-dialogue json handle — extractNodeOutput / preview type", () => {
  const withTimings = node("D", "text-to-dialogue", {
    generatedAudioUrl: AUDIO,
    generatedJson: transcript,
    generatedResults: [{ url: AUDIO, jobId: "j1", timestamp: "t", transcript }],
    activeResultIndex: 0,
  })
  it("json → the stringified transcript; audio / no handle → the audio URL unchanged", () => {
    expect(extractNodeOutput(withTimings, "json")).toBe(JSON.stringify(transcript))
    expect(extractNodeOutput(withTimings, "audio")).toBe(AUDIO)
    expect(extractNodeOutput(withTimings)).toBe(AUDIO)
  })
  it("follows the active result's transcript, not the bare field", () => {
    const other: Transcript = { version: 1, words: [{ text: "second", startMs: 0, endMs: 100 }] }
    const n = node("D", "text-to-dialogue", {
      generatedJson: other,
      generatedResults: [{ url: "https://x/2.mp3", jobId: "j2", timestamp: "t2", transcript: other }, { url: AUDIO, jobId: "j1", timestamp: "t1", transcript }],
      activeResultIndex: 1,
    })
    expect(extractNodeOutput(n, "json")).toBe(JSON.stringify(transcript))
  })
  it("json with no timings → undefined (never the audio URL)", () => {
    const n = node("D", "text-to-dialogue", { generatedAudioUrl: AUDIO, generatedResults: [{ url: AUDIO, jobId: "j1", timestamp: "t" }], activeResultIndex: 0 })
    expect(extractNodeOutput(n, "json")).toBeUndefined()
    expect(extractNodeOutput(n, "audio")).toBe(AUDIO)
  })
  it("the json pip previews as data, the audio pip as audio", () => {
    expect(detectPreviewItemType("text-to-dialogue", JSON.stringify(transcript), "json")).toBe("data")
    expect(detectPreviewItemType("text-to-dialogue", AUDIO, "audio")).toBe("audio")
  })
})

describe("text-to-dialogue json → add-captions transcript (canvas resolver)", () => {
  const video = node("V", "upload-video", { videoUrl: "https://cdn.example.com/in.mp4" })
  const captions = node("C", "add-captions", {})
  const edges = [edge("V", "video", "C", "in"), edge("D", "json", "C", "transcript")]
  it("with timings the transcript arrives as a string and the audio never lands in audioUrl", () => {
    const d = node("D", "text-to-dialogue", { generatedAudioUrl: AUDIO, generatedJson: transcript, generatedResults: [{ url: AUDIO, jobId: "j", timestamp: "t", transcript }], activeResultIndex: 0 })
    const inputs = resolveNodeInputs(captions, [d, video, captions], edges)
    expect(inputs.transcript).toBe(JSON.stringify(transcript))
    expect(inputs.audioUrl).toBeUndefined()
  })
  it("without timings the transcript input is empty, so Add Captions auto-transcribes as today", () => {
    const d = node("D", "text-to-dialogue", { generatedAudioUrl: AUDIO, generatedResults: [{ url: AUDIO, jobId: "j", timestamp: "t" }], activeResultIndex: 0 })
    const inputs = resolveNodeInputs(captions, [d, video, captions], edges)
    expect(inputs.transcript).toBeUndefined()
    expect(inputs.audioUrl).toBeUndefined()
  })
})
